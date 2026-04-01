/**
 * BotManager - manages multiple Discord.js clients
 *
 * Each bot:
 * - Has its own Client instance (isolated Discord connection)
 * - Loads personality from database
 * - Uses PersonalityEngine for AI calls (no shared state)
 * - Handles DMs and channel messages with ACL
 */

import {
  Client,
  GatewayIntentBits,
  Partials,
  Message,
  TextChannel,
  DMChannel,
  User,
  ActivityType,
} from 'discord.js';
import { execute as executePersonality, getGreeting } from '../ai/index.js';
import type { Personality, ConversationMessage } from '../ai/types.js';
import { shouldRespond as checkShouldRespond } from './message-router.js';
import {
  listEnabledPersonalities,
  getPersonality,
  getChannelAcl,
  updateChannelLastResponse,
  isRestrictedUser,
  hasPendingRequest,
  createAccessRequest,
  approveAccessRequest,
  denyAccessRequest,
  getPendingRequests,
  getRestrictedUsers,
  getOrCreatePersonalitySession,
  updatePersonalitySession,
  clearPersonalitySessions,
  storeIncomingDm,
} from '../db/queries.js';
import { seedDatabase } from '../db/seed.js';

// ============================================================
// TYPES
// ============================================================

interface BotInstance {
  client: Client;
  personality: Personality;
  isReady: boolean;
}

// ============================================================
// CONFIGURATION
// ============================================================

const ALLOWED_DM_USERS = new Set(
  (process.env.ALLOWED_DM_USERS || '').split(',').map(id => id.trim()).filter(Boolean)
);

const MAX_CONTEXT = 20;
const LOGIN_STAGGER_MS = 5000;

// ============================================================
// BOT MANAGER CLASS
// ============================================================

class BotManager {
  private bots: Map<string, BotInstance> = new Map();
  private adminContext: Map<string, ConversationMessage[]> = new Map();

  async initialize(): Promise<void> {
    console.log('[BotManager] Starting initialization...');

    // Seed database with default brains and personalities
    seedDatabase();

    // Load personalities from database
    const personalities = listEnabledPersonalities();
    console.log(`[BotManager] Found ${personalities.length} enabled personalities`);

    for (const personality of personalities) {
      const token = process.env[personality.discord_token_env];

      if (!token) {
        console.warn(`[BotManager] No token for ${personality.name} (${personality.discord_token_env}), skipping`);
        continue;
      }

      try {
        await this.initializeBot(personality, token);

        // Stagger next login to avoid rate limits
        if (personalities.indexOf(personality) < personalities.length - 1) {
          console.log(`[BotManager] Waiting ${LOGIN_STAGGER_MS}ms before next bot...`);
          await this.sleep(LOGIN_STAGGER_MS);
        }
      } catch (error) {
        console.error(`[BotManager] Failed to initialize ${personality.name}:`, error);
        // Continue with other bots
      }
    }

    const onlineCount = Array.from(this.bots.values()).filter(b => b.isReady).length;
    console.log(`[BotManager] Initialization complete. ${onlineCount}/${personalities.length} bots online`);
  }

  private async initializeBot(personality: Personality, token: string): Promise<void> {
    console.log(`[BotManager] Initializing ${personality.display_name}...`);

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    const instance: BotInstance = {
      client,
      personality,
      isReady: false,
    };

    // Setup event handlers
    client.on('ready', () => {
      console.log(`[BotManager] ${personality.display_name} logged in as ${client.user?.tag}`);
      instance.isReady = true;

      // Set presence to show green dot
      client.user?.setPresence({
        status: 'online',
        activities: personality.is_admin
          ? [{ name: 'for commands', type: ActivityType.Listening }]
          : [{ name: `being ${personality.display_name}`, type: ActivityType.Playing }],
      });
      console.log(`[BotManager] ${personality.display_name} presence set to online`);
    });

    client.on('error', (error) => {
      console.error(`[BotManager] ${personality.display_name} error:`, error);
    });

    // Message handler - scoped to THIS bot
    client.on('messageCreate', async (message) => {
      await this.handleMessage(message, instance);
    });

    // Login with retry for rate limits
    await this.loginWithRetry(client, token, personality.display_name);

    // Wait for ready
    if (!instance.isReady) {
      await new Promise<void>((resolve) => {
        client.once('ready', () => resolve());
      });
    }

    this.bots.set(personality.id, instance);
  }

  private async loginWithRetry(client: Client, token: string, name: string): Promise<void> {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await client.login(token);
        return;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes('Not enough sessions remaining')) {
          const resetMatch = errorMessage.match(/resets at ([^\s]+)/);
          let waitMs = 60000; // Default 1 minute

          if (resetMatch) {
            const resetTime = new Date(resetMatch[1]).getTime();
            const now = Date.now();
            if (resetTime > now) {
              waitMs = Math.min(resetTime - now + 5000, 5 * 60 * 1000);
            }
          }

          console.warn(`[BotManager] ${name} rate limited (attempt ${attempt}/${maxRetries}). Waiting ${Math.round(waitMs/1000)}s...`);

          if (attempt === maxRetries) {
            throw new Error(`${name} rate limited. Max retries exceeded.`);
          }

          await this.sleep(waitMs);
        } else {
          throw error;
        }
      }
    }
  }

  // ============================================================
  // MESSAGE ROUTING
  // ============================================================

  private async handleMessage(message: Message, bot: BotInstance): Promise<void> {
    const botUserId = bot.client.user?.id;
    if (!botUserId) return;

    const { personality } = bot;
    const userId = message.author.id;
    const content = message.content.trim();
    const isDm = message.channel.isDMBased();
    const authorIsBot = message.author.bot;

    // Get channel ACL for non-DM messages
    const channelAcl = isDm ? null : getChannelAcl(personality.id, message.channel.id);

    // Check if we should respond using MessageRouter
    const decision = checkShouldRespond(botUserId, message, channelAcl, authorIsBot);

    if (!decision.shouldRespond) {
      // Only log ignored messages in channels (not spam from other bots)
      if (!isDm && decision.reason !== 'self') {
        // Silent ignore for channel messages
      }
      return;
    }

    // Record incoming DM
    if (isDm && !authorIsBot) {
      storeIncomingDm(message.id, userId, message.author.tag, content);
    }

    // Route based on bot type and context
    if (personality.is_admin) {
      if (isDm) {
        // Admin bot DM handling
        if (this.isAllowedDmUser(userId)) {
          await this.handleAdminMessage(message, content, bot);
        } else if (isRestrictedUser(userId)) {
          await this.handleRestrictedMessage(message, content, bot);
        } else {
          await this.handleUnknownUser(message, bot);
        }
      } else {
        // Admin bot in channel - respond with personality
        await this.handleChannelMessage(message, content, bot);
      }
    } else {
      // Personality bot
      if (isDm) {
        await this.handlePersonalityDm(message, content, bot);
      } else {
        await this.handleChannelMessage(message, content, bot);
      }
    }

    // Update cooldown for channel messages
    if (!isDm && channelAcl) {
      updateChannelLastResponse(personality.id, message.channel.id);
    }
  }

  // ============================================================
  // ADMIN BOT HANDLERS (Sombra)
  // ============================================================

  private async handleAdminMessage(message: Message, content: string, bot: BotInstance): Promise<void> {
    const userId = message.author.id;
    const lower = content.toLowerCase();
    const { personality, client } = bot;

    // Admin commands
    if (lower === '/clear' || lower === '/new') {
      this.adminContext.delete(userId);
      await message.reply('Cleared. What do you need?');
      return;
    }

    if (lower === '/help') {
      await message.reply(`Just message me. I'll figure it out.

**Commands:**
/clear - fresh start
/pending - see access requests
/users - list restricted users
/approve {user_id} - approve access
/deny {user_id} - deny access`);
      return;
    }

    if (lower === '/pending') {
      const requests = getPendingRequests();
      if (requests.length === 0) {
        await message.reply('No pending access requests.');
        return;
      }
      const list = requests.map(r =>
        `• **${r.username}** (\`${r.user_id}\`) - ${new Date(r.requested_at).toLocaleString()}`
      ).join('\n');
      await message.reply(`**Pending Requests:**\n${list}\n\nUse \`/approve {user_id}\` or \`/deny {user_id}\``);
      return;
    }

    if (lower === '/users') {
      const users = getRestrictedUsers();
      if (users.length === 0) {
        await message.reply('No restricted users approved yet.');
        return;
      }
      const list = users.map(u => `• **${u.username}** (\`${u.user_id}\`)`).join('\n');
      await message.reply(`**Restricted Users:**\n${list}`);
      return;
    }

    const approveMatch = content.match(/^\/approve\s+(\d+)$/i);
    if (approveMatch) {
      const targetId = approveMatch[1];
      const result = approveAccessRequest(targetId, userId);
      if (result) {
        await message.reply(`✅ Approved **${result.username}**. They can now chat with personalities.`);
        try {
          const targetUser = await client?.users.fetch(targetId);
          if (targetUser) {
            const dm = await targetUser.createDM();
            await dm.send(`You've been approved! You can now DM the personality bots directly.`);
          }
        } catch { /* Couldn't DM them */ }
      } else {
        await message.reply(`No pending request from user ID \`${targetId}\`.`);
      }
      return;
    }

    const denyMatch = content.match(/^\/deny\s+(\d+)$/i);
    if (denyMatch) {
      const targetId = denyMatch[1];
      const denied = denyAccessRequest(targetId);
      await message.reply(denied
        ? `❌ Denied access for user \`${targetId}\`.`
        : `No pending request from user ID \`${targetId}\`.`
      );
      return;
    }

    // Regular message to admin bot - use PersonalityEngine
    console.log(`[${personality.display_name}] [ADMIN] ${message.author.tag}: ${content.substring(0, 50)}...`);

    try {
      const context = this.adminContext.get(userId) || [];

      const result = await executePersonality({
        user_id: userId,
        personality_id: personality.id,
        message: content,
        context,
        is_dm: true,
      });

      if (result.success) {
        // Update context
        const newContext = [...context, { role: 'user' as const, content }];
        newContext.push({ role: 'assistant' as const, content: result.response });
        while (newContext.length > MAX_CONTEXT) newContext.shift();
        this.adminContext.set(userId, newContext);

        await message.reply(result.response);
        console.log(`[${personality.display_name}] [ADMIN] Responded in ${result.latency_ms}ms`);
      } else {
        await message.reply(personality.error_response || "Something went wrong. Try again?");
      }
    } catch (error) {
      console.error(`[${personality.display_name}] PersonalityEngine failed:`, error);
      await message.reply(personality.error_response || "Couldn't process that. Try again?");
    }
  }

  private async handleRestrictedMessage(message: Message, content: string, bot: BotInstance): Promise<void> {
    await message.reply(`Hey! You should DM the personality bots directly now. They'll respond as themselves.`);
  }

  private async handleUnknownUser(message: Message, bot: BotInstance): Promise<void> {
    const userId = message.author.id;
    const username = message.author.tag;
    const { client, personality } = bot;

    if (hasPendingRequest(userId)) {
      await message.reply("Your request is still pending. I'll let you know when you're approved!");
      return;
    }

    const isNew = createAccessRequest(userId, username);

    if (isNew) {
      await message.reply("I'll ask if you can chat. Hang tight!");

      // Notify admins
      for (const adminId of ALLOWED_DM_USERS) {
        try {
          const admin = await client.users.fetch(adminId);
          if (admin) {
            const dm = await admin.createDM();
            await dm.send(`🔔 **Access Request**\n**${username}** (\`${userId}\`) wants to chat.\n\nReply:\n\`/approve ${userId}\` to grant access\n\`/deny ${userId}\` to reject`);
          }
        } catch { /* Couldn't DM admin */ }
      }
    } else {
      await message.reply("Your previous request was processed. If you think this is a mistake, try again later.");
    }
  }

  // ============================================================
  // PERSONALITY BOT HANDLERS (Donut, Mordecai, etc)
  // ============================================================

  private async handlePersonalityDm(message: Message, content: string, bot: BotInstance): Promise<void> {
    const userId = message.author.id;
    const { personality } = bot;

    // Check if user is allowed (admin or restricted)
    if (!this.isAllowedDmUser(userId) && !isRestrictedUser(userId)) {
      // Unknown user - tell them to request access via admin bot
      const adminBot = this.getAdminBot();
      await message.reply(`*looks confused*\n\nI don't know you. DM @${adminBot?.personality.display_name || 'Sombra'} to request access first.`);
      return;
    }

    // Handle /clear command
    if (content.toLowerCase() === '/clear' || content.toLowerCase() === '/new') {
      clearPersonalitySessions(userId);
      await message.reply(`*yawns*\n\nFine. Fresh start. What do you want?`);
      return;
    }

    // Get or create session
    const today = new Date().toISOString().split('T')[0];
    const session = getOrCreatePersonalitySession(userId, personality.name, today);

    const context = JSON.parse(session.context) as ConversationMessage[];
    const newContext = [...context, { role: 'user' as const, content }];

    while (newContext.length > MAX_CONTEXT) newContext.shift();

    console.log(`[${personality.display_name}] ${message.author.tag}: ${content.substring(0, 50)}...`);

    try {
      const result = await executePersonality({
        user_id: userId,
        personality_id: personality.id,
        message: content,
        context,
        is_dm: true,
      });

      if (result.success) {
        newContext.push({ role: 'assistant' as const, content: result.response });
        updatePersonalitySession(session.id, JSON.stringify(newContext));

        await message.reply(result.response);
        console.log(`[${personality.display_name}] Responded in ${result.latency_ms}ms`);
      } else {
        await message.reply(personality.error_response || "*looks annoyed*\n\nSomething went wrong. Try again.");
      }
    } catch (error) {
      console.error(`[${personality.display_name}] PersonalityEngine failed:`, error);
      await message.reply(personality.error_response || "*sighs*\n\nI can't think right now. Try again later.");
    }
  }

  private async handleChannelMessage(message: Message, content: string, bot: BotInstance): Promise<void> {
    const userId = message.author.id;
    const { personality } = bot;
    const channelId = message.channel.id;

    console.log(`[${personality.display_name}] [CHANNEL] ${message.author.tag}: ${content.substring(0, 50)}...`);

    try {
      // Channel messages are stateless (no session)
      const result = await executePersonality({
        user_id: userId,
        personality_id: personality.id,
        message: content,
        channel_id: channelId,
        is_dm: false,
      });

      if (result.success) {
        await message.reply(result.response);
        console.log(`[${personality.display_name}] [CHANNEL] Responded in ${result.latency_ms}ms`);
      } else {
        // Silent fail for channel messages to avoid spam
        console.error(`[${personality.display_name}] [CHANNEL] Failed:`, result.error);
      }
    } catch (error) {
      console.error(`[${personality.display_name}] [CHANNEL] PersonalityEngine failed:`, error);
    }
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  isAllowedDmUser(userId: string): boolean {
    return ALLOWED_DM_USERS.has(userId);
  }

  canReceiveDm(userId: string): boolean {
    return ALLOWED_DM_USERS.has(userId) || isRestrictedUser(userId);
  }

  getBot(botId: string): BotInstance | undefined {
    return this.bots.get(botId);
  }

  getAdminBot(): BotInstance | undefined {
    return Array.from(this.bots.values()).find(b => b.personality.is_admin === 1);
  }

  getClient(botId: string): Client | undefined {
    return this.bots.get(botId)?.client;
  }

  isReady(botId?: string): boolean {
    if (botId) {
      return this.bots.get(botId)?.isReady ?? false;
    }
    // Return true if ANY bot is ready
    return Array.from(this.bots.values()).some(b => b.isReady);
  }

  async getChannel(botId: string, channelId: string): Promise<TextChannel | null> {
    const bot = this.bots.get(botId);
    if (!bot?.isReady) return null;

    try {
      const channel = await bot.client.channels.fetch(channelId);
      if (channel?.isTextBased() && 'send' in channel) {
        return channel as TextChannel;
      }
      return null;
    } catch {
      return null;
    }
  }

  async getDmChannel(botId: string, userId: string): Promise<DMChannel | null> {
    const bot = this.bots.get(botId);
    if (!bot?.isReady) return null;
    if (!this.canReceiveDm(userId)) return null;

    try {
      const user = await bot.client.users.fetch(userId);
      return await user.createDM();
    } catch {
      return null;
    }
  }

  async getUser(botId: string, userId: string): Promise<User | null> {
    const bot = this.bots.get(botId);
    if (!bot?.isReady) return null;

    try {
      return await bot.client.users.fetch(userId);
    } catch {
      return null;
    }
  }

  // Get all guilds across all bots (deduplicated)
  getGuilds(): Array<{ id: string; name: string; icon: string | null }> {
    const seen = new Set<string>();
    const guilds: Array<{ id: string; name: string; icon: string | null }> = [];

    for (const bot of this.bots.values()) {
      if (!bot.isReady) continue;
      for (const guild of bot.client.guilds.cache.values()) {
        if (seen.has(guild.id)) continue;
        seen.add(guild.id);
        guilds.push({
          id: guild.id,
          name: guild.name,
          icon: guild.iconURL(),
        });
      }
    }

    return guilds;
  }

  // Get online bots
  getOnlineBots(): Array<{ id: string; name: string; tag: string }> {
    return Array.from(this.bots.entries())
      .filter(([_, bot]) => bot.isReady)
      .map(([id, bot]) => ({
        id,
        name: bot.personality.display_name,
        tag: bot.client.user?.tag || 'unknown',
      }));
  }

  // Utility
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const botManager = new BotManager();
