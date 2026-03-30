/**
 * BotManager - manages multiple Discord.js clients
 *
 * Each bot:
 * - Has its own Client instance
 * - Connects to gateway independently (green dot)
 * - Handles its own messages based on config
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
  PresenceUpdateStatus,
} from 'discord.js';
import { BOT_CONFIGS, BotConfig, getAdminBot } from './bots.config.js';
import {
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
  getActivePersonality,
  setActivePersonality,
  clearActivePersonality,
  storeIncomingDm,
} from '../db/queries.js';

// ============================================================
// TYPES
// ============================================================

interface BotInstance {
  client: Client;
  config: BotConfig;
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
  private adminContext: Map<string, string[]> = new Map();

  async initialize(): Promise<void> {
    console.log('[BotManager] Starting initialization...');

    for (const config of BOT_CONFIGS) {
      const token = process.env[config.tokenEnvVar];

      if (!token) {
        console.warn(`[BotManager] No token for ${config.id} (${config.tokenEnvVar}), skipping`);
        continue;
      }

      try {
        await this.initializeBot(config, token);

        // Stagger next login to avoid rate limits
        if (BOT_CONFIGS.indexOf(config) < BOT_CONFIGS.length - 1) {
          console.log(`[BotManager] Waiting ${LOGIN_STAGGER_MS}ms before next bot...`);
          await this.sleep(LOGIN_STAGGER_MS);
        }
      } catch (error) {
        console.error(`[BotManager] Failed to initialize ${config.id}:`, error);
        // Continue with other bots
      }
    }

    const onlineCount = Array.from(this.bots.values()).filter(b => b.isReady).length;
    console.log(`[BotManager] Initialization complete. ${onlineCount}/${BOT_CONFIGS.length} bots online`);
  }

  private async initializeBot(config: BotConfig, token: string): Promise<void> {
    console.log(`[BotManager] Initializing ${config.name}...`);

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
      config,
      isReady: false,
    };

    // Setup event handlers
    client.on('ready', () => {
      console.log(`[BotManager] ${config.name} logged in as ${client.user?.tag}`);
      instance.isReady = true;

      // Set presence to show green dot
      client.user?.setPresence({
        status: 'online' as PresenceUpdateStatus,
        activities: config.personality
          ? [{ name: `being ${config.name}`, type: ActivityType.Playing }]
          : [{ name: 'for commands', type: ActivityType.Listening }],
      });
      console.log(`[BotManager] ${config.name} presence set to online`);
    });

    client.on('error', (error) => {
      console.error(`[BotManager] ${config.name} error:`, error);
    });

    // Message handler - scoped to THIS bot
    client.on('messageCreate', async (message) => {
      await this.handleMessage(message, instance);
    });

    // Login with retry for rate limits
    await this.loginWithRetry(client, token, config.name);

    // Wait for ready
    if (!instance.isReady) {
      await new Promise<void>((resolve) => {
        client.once('ready', () => resolve());
      });
    }

    this.bots.set(config.id, instance);
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
    // Ignore bot messages
    if (message.author.bot) return;

    // Only handle DMs for now
    if (!message.channel.isDMBased()) return;

    const userId = message.author.id;
    const content = message.content.trim();
    const { config } = bot;

    // Record incoming DM
    storeIncomingDm(
      message.id,
      userId,
      message.author.tag,
      content
    );

    // Route based on bot type and user type
    if (config.isAdmin) {
      // Admin bot (Sombra) handles all user types
      if (this.isAllowedDmUser(userId)) {
        await this.handleAdminMessage(message, content, bot);
      } else if (isRestrictedUser(userId)) {
        await this.handleRestrictedMessage(message, content, bot);
      } else {
        await this.handleUnknownUser(message, bot);
      }
    } else {
      // Personality bots handle anyone who DMs them
      await this.handlePersonalityBotMessage(message, content, bot);
    }
  }

  // ============================================================
  // ADMIN BOT HANDLERS (Sombra)
  // ============================================================

  private async handleAdminMessage(message: Message, content: string, bot: BotInstance): Promise<void> {
    const userId = message.author.id;
    const lower = content.toLowerCase();
    const { config, client } = bot;

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

    // Regular message to Sombra
    console.log(`[${config.name}] [ADMIN] ${message.author.tag}: ${content.substring(0, 50)}...`);

    try {
      const context = this.getAdminContext(userId);
      this.addToAdminContext(userId, 'user', content);

      const response = await fetch(config.aiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          message: content,
          context: context || undefined,
        }),
      });

      if (!response.ok) throw new Error(`AI returned ${response.status}`);

      const result = await response.json() as { success: boolean; response: string; duration_ms?: number };

      if (result.success) {
        this.addToAdminContext(userId, 'assistant', result.response);
        await message.reply(result.response.slice(0, 1900));
        console.log(`[${config.name}] [ADMIN] Responded in ${result.duration_ms || 0}ms`);
      } else {
        await message.reply("Something went wrong. Try again?");
      }
    } catch (error) {
      console.error(`[${config.name}] AI call failed:`, error);
      await message.reply("Couldn't reach AI backend. Is it running?");
    }
  }

  private async handleRestrictedMessage(message: Message, content: string, bot: BotInstance): Promise<void> {
    // Restricted users talking to Sombra - redirect them to personality bots
    await message.reply(`Hey! You should DM the personality bots directly now. They'll respond as themselves.`);
  }

  private async handleUnknownUser(message: Message, bot: BotInstance): Promise<void> {
    const userId = message.author.id;
    const username = message.author.tag;
    const { client, config } = bot;

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

  private async handlePersonalityBotMessage(message: Message, content: string, bot: BotInstance): Promise<void> {
    const userId = message.author.id;
    const { config } = bot;

    // Check if user is allowed (admin or restricted)
    if (!this.isAllowedDmUser(userId) && !isRestrictedUser(userId)) {
      // Unknown user - tell them to request access via Sombra
      const adminBot = getAdminBot();
      await message.reply(`*looks confused*\n\nI don't know you. DM @${adminBot?.name || 'Sombra'} to request access first.`);
      return;
    }

    // Handle /clear command
    if (content.toLowerCase() === '/clear' || content.toLowerCase() === '/new') {
      clearPersonalitySessions(userId);
      await message.reply(`*yawns*\n\nFine. Fresh start. What do you want?`);
      return;
    }

    // Get or create session for this bot's personality
    const today = new Date().toISOString().split('T')[0];
    const session = getOrCreatePersonalitySession(userId, config.personality!, today);

    const context = JSON.parse(session.context) as Array<{ role: string; content: string }>;
    context.push({ role: 'user', content });

    while (context.length > MAX_CONTEXT) context.shift();

    console.log(`[${config.name}] ${message.author.tag}: ${content.substring(0, 50)}...`);

    try {
      const response = await fetch(config.aiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          message: content,
          context: context,
          personality: config.personality,
        }),
      });

      if (!response.ok) throw new Error(`AI returned ${response.status}`);

      const result = await response.json() as { success: boolean; response: string; duration_ms?: number };

      if (result.success) {
        context.push({ role: 'assistant', content: result.response });
        updatePersonalitySession(session.id, JSON.stringify(context));

        await message.reply(result.response.slice(0, 1900));
        console.log(`[${config.name}] Responded in ${result.duration_ms || 0}ms`);
      } else {
        await message.reply("*looks annoyed*\n\nSomething went wrong. Try again.");
      }
    } catch (error) {
      console.error(`[${config.name}] AI call failed:`, error);
      await message.reply("*sighs*\n\nI can't think right now. Try again later.");
    }
  }

  // ============================================================
  // CONTEXT MANAGEMENT
  // ============================================================

  private getAdminContext(userId: string): string {
    const history = this.adminContext.get(userId) || [];
    return history.join('\n');
  }

  private addToAdminContext(userId: string, role: 'user' | 'assistant', message: string): void {
    const history = this.adminContext.get(userId) || [];
    history.push(`${role === 'user' ? 'User' : 'Sombra'}: ${message}`);
    while (history.length > 10) history.shift();
    this.adminContext.set(userId, history);
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
        name: bot.config.name,
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
