import { Client, GatewayIntentBits, Partials, TextChannel, DMChannel, Message, User } from 'discord.js';
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
} from '../db/queries.js';

let client: Client | null = null;
let isReady = false;

// ============================================================
// CONFIGURATION
// ============================================================

// Admin user IDs - full access (comma-separated in env)
const ALLOWED_DM_USERS = new Set(
  (process.env.ALLOWED_DM_USERS || '').split(',').map(id => id.trim()).filter(Boolean)
);

// Sombra endpoints
const SOMBRA_URL = process.env.SOMBRA_URL || 'http://localhost:3001/execute';
const SOMBRA_RESTRICTED_URL = process.env.SOMBRA_RESTRICTED_URL;

// Available personalities for restricted users
const AVAILABLE_PERSONALITIES = new Set(
  (process.env.AVAILABLE_PERSONALITIES || 'donut,mordecai')
    .split(',').map(p => p.trim().toLowerCase()).filter(Boolean)
);

// Max context messages per session
const MAX_CONTEXT = 20;

export function isAllowedDmUser(userId: string): boolean {
  return ALLOWED_DM_USERS.has(userId);
}

// ============================================================
// ADMIN CONTEXT (in-memory for full-access users)
// ============================================================

const adminContext = new Map<string, string[]>();

function getAdminContext(userId: string): string {
  const history = adminContext.get(userId) || [];
  return history.join('\n');
}

function addToAdminContext(userId: string, role: 'user' | 'assistant', message: string): void {
  const history = adminContext.get(userId) || [];
  history.push(`${role === 'user' ? 'User' : 'Sombra'}: ${message}`);
  while (history.length > 10) history.shift();
  adminContext.set(userId, history);
}

// ============================================================
// COMMAND PARSER (for restricted users)
// ============================================================

interface ParsedCommand {
  type: 'msg' | 'help' | 'personalities' | 'clear' | 'chat' | 'invalid';
  personality?: string;
  message?: string;
  error?: string;
}

function parseRestrictedCommand(content: string, activePersonality: string | null): ParsedCommand {
  const trimmed = content.trim();
  const lower = trimmed.toLowerCase();

  if (lower === '/help') {
    return { type: 'help' };
  }
  if (lower === '/personalities' || lower === '/list') {
    return { type: 'personalities' };
  }
  if (lower === '/clear' || lower === '/new') {
    return { type: 'clear' };
  }

  // /msg @personality message
  const msgMatch = trimmed.match(/^\/msg\s+@(\w+)(?:\s+(.*))?$/i);
  if (msgMatch) {
    const personality = msgMatch[1].toLowerCase();
    const message = msgMatch[2]?.trim();

    if (!AVAILABLE_PERSONALITIES.has(personality)) {
      return { type: 'invalid', error: `I don't know **${personality}**. Try /personalities to see who's available.` };
    }
    if (!message) {
      return { type: 'invalid', error: `What do you want to say to **${personality}**?` };
    }
    return { type: 'msg', personality, message };
  }

  // If they have an active session, treat bare messages as continuation
  if (activePersonality) {
    return { type: 'chat', personality: activePersonality, message: trimmed };
  }

  // No active session, no valid command
  return { type: 'invalid', error: 'Use `/msg @personality message` to start chatting. Try `/help` for commands.' };
}

// ============================================================
// MESSAGE HANDLERS
// ============================================================

async function handleAdminMessage(message: Message, content: string): Promise<void> {
  const userId = message.author.id;
  const lower = content.toLowerCase();

  // Admin commands
  if (lower === '/clear' || lower === '/new') {
    adminContext.delete(userId);
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

  // /pending - List pending access requests
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

  // /users - List restricted users
  if (lower === '/users') {
    const users = getRestrictedUsers();
    if (users.length === 0) {
      await message.reply('No restricted users approved yet.');
      return;
    }
    const list = users.map(u =>
      `• **${u.username}** (\`${u.user_id}\`)`
    ).join('\n');
    await message.reply(`**Restricted Users:**\n${list}`);
    return;
  }

  // /approve {user_id}
  const approveMatch = content.match(/^\/approve\s+(\d+)$/i);
  if (approveMatch) {
    const targetId = approveMatch[1];
    const result = approveAccessRequest(targetId, userId);
    if (result) {
      await message.reply(`✅ Approved **${result.username}**. They can now chat with personalities.`);
      // Notify the user
      try {
        const targetUser = await client?.users.fetch(targetId);
        if (targetUser) {
          const dm = await targetUser.createDM();
          await dm.send(`You've been approved! Use \`/msg @personality message\` to start chatting. Try \`/personalities\` to see who's available.`);
        }
      } catch {
        // Couldn't DM them, no big deal
      }
    } else {
      await message.reply(`No pending request from user ID \`${targetId}\`.`);
    }
    return;
  }

  // /deny {user_id}
  const denyMatch = content.match(/^\/deny\s+(\d+)$/i);
  if (denyMatch) {
    const targetId = denyMatch[1];
    const denied = denyAccessRequest(targetId);
    if (denied) {
      await message.reply(`❌ Denied access for user \`${targetId}\`.`);
    } else {
      await message.reply(`No pending request from user ID \`${targetId}\`.`);
    }
    return;
  }

  // Regular message to Sombra
  console.log(`[Discord] [ADMIN] Message from ${message.author.tag}: ${content.substring(0, 50)}...`);

  try {
    const context = getAdminContext(userId);
    addToAdminContext(userId, 'user', content);

    const response = await fetch(SOMBRA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        message: content,
        context: context || undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(`Sombra returned ${response.status}`);
    }

    const result = await response.json() as {
      success: boolean;
      response: string;
      actions?: string[];
      duration_ms?: number;
    };

    if (result.success) {
      addToAdminContext(userId, 'assistant', result.response);
      const reply = result.response.slice(0, 1900);
      await message.reply(reply);
      console.log(`[Discord] [ADMIN] Responded in ${result.duration_ms || 0}ms`);
    } else {
      await message.reply("Something went wrong. Try again?");
    }
  } catch (error) {
    console.error('[Discord] Sombra call failed:', error);
    await message.reply("Couldn't reach Sombra. Is it running?");
  }
}

async function handleRestrictedMessage(message: Message, content: string): Promise<void> {
  const userId = message.author.id;

  // Check if restricted endpoint is configured
  if (!SOMBRA_RESTRICTED_URL) {
    await message.reply("Personality chat isn't set up yet. Check back later!");
    return;
  }

  // Get active personality for sticky sessions
  const activePersonality = getActivePersonality(userId);
  const cmd = parseRestrictedCommand(content, activePersonality);

  switch (cmd.type) {
    case 'help': {
      let helpText = `**Commands:**
\`/msg @personality message\` - Talk to a personality
\`/personalities\` - See who's available
\`/clear\` - Start fresh`;
      if (activePersonality) {
        helpText += `\n\n*Currently chatting with **${activePersonality}**. Just type to continue!*`;
      }
      await message.reply(helpText);
      return;
    }

    case 'personalities': {
      const list = [...AVAILABLE_PERSONALITIES].join(', ');
      await message.reply(`**Available personalities:** ${list}`);
      return;
    }

    case 'clear': {
      clearPersonalitySessions(userId);
      clearActivePersonality(userId);
      await message.reply("Cleared! Start a new conversation with `/msg @personality message`");
      return;
    }

    case 'invalid': {
      await message.reply(cmd.error || "Use `/msg @personality message` to chat.");
      return;
    }

    case 'msg':
    case 'chat': {
      await handlePersonalityMessage(message, userId, cmd.personality!, cmd.message!);
      return;
    }
  }
}

async function handlePersonalityMessage(
  message: Message,
  userId: string,
  personality: string,
  userMessage: string
): Promise<void> {
  // Set active personality for sticky sessions
  setActivePersonality(userId, personality);

  // Get or create today's session
  const today = new Date().toISOString().split('T')[0];
  const session = getOrCreatePersonalitySession(userId, personality, today);

  // Parse and update context
  const context = JSON.parse(session.context) as Array<{ role: string; content: string }>;
  context.push({ role: 'user', content: userMessage });

  // Cap context
  while (context.length > MAX_CONTEXT) context.shift();

  console.log(`[Discord] [RESTRICTED] ${message.author.tag} -> ${personality}: ${userMessage.substring(0, 50)}...`);

  try {
    const response = await fetch(SOMBRA_RESTRICTED_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        personality: personality,
        message: userMessage,
        context: context,
      }),
    });

    if (!response.ok) {
      throw new Error(`Sombra returned ${response.status}`);
    }

    const result = await response.json() as {
      success: boolean;
      response: string;
      duration_ms?: number;
    };

    if (result.success) {
      // Update context with response
      context.push({ role: 'assistant', content: result.response });
      updatePersonalitySession(session.id, JSON.stringify(context));

      const reply = result.response.slice(0, 1900);
      await message.reply(reply);
      console.log(`[Discord] [RESTRICTED] Responded as ${personality} in ${result.duration_ms || 0}ms`);
    } else {
      await message.reply("Something went wrong. Try again?");
    }
  } catch (error) {
    console.error('[Discord] Restricted Sombra call failed:', error);
    await message.reply("Couldn't reach the personality. Try again later.");
  }
}

async function handleUnknownUser(message: Message): Promise<void> {
  const userId = message.author.id;
  const username = message.author.tag;

  // Check if they already have a pending request
  if (hasPendingRequest(userId)) {
    await message.reply("Your request is still pending. I'll let you know when you're approved!");
    return;
  }

  // Create access request
  const isNew = createAccessRequest(userId, username);

  if (isNew) {
    await message.reply("I'll ask if you can chat. Hang tight!");

    // Notify all admin users
    for (const adminId of ALLOWED_DM_USERS) {
      try {
        const admin = await client?.users.fetch(adminId);
        if (admin) {
          const dm = await admin.createDM();
          await dm.send(`🔔 **Access Request**\n**${username}** (\`${userId}\`) wants to chat.\n\nReply:\n\`/approve ${userId}\` to grant access\n\`/deny ${userId}\` to reject`);
        }
      } catch {
        // Couldn't DM admin
      }
    }
  } else {
    // They had a previous denied request or something
    await message.reply("Your previous request was processed. If you think this is a mistake, try again later.");
  }
}

// ============================================================
// MAIN CLIENT
// ============================================================

export function getClient(): Client {
  if (!client) {
    client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    client.on('ready', () => {
      console.log(`Discord bot logged in as ${client?.user?.tag}`);
      isReady = true;
    });

    client.on('error', (error) => {
      console.error('Discord client error:', error);
    });

    // Main message handler
    client.on('messageCreate', async (message) => {
      if (message.author.bot) return;
      if (!message.channel.isDMBased()) return;

      const userId = message.author.id;
      const content = message.content.trim();

      // Route based on user type
      if (isAllowedDmUser(userId)) {
        // Admin: full access
        await handleAdminMessage(message, content);
      } else if (isRestrictedUser(userId)) {
        // Restricted: personality mode
        await handleRestrictedMessage(message, content);
      } else {
        // Unknown: request access
        await handleUnknownUser(message);
      }
    });
  }
  return client;
}

export async function initDiscord(): Promise<void> {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error('DISCORD_TOKEN environment variable is required');
  }

  const discordClient = getClient();
  await discordClient.login(token);

  if (!isReady) {
    await new Promise<void>((resolve) => {
      discordClient.once('ready', () => resolve());
    });
  }
}

export function isDiscordReady(): boolean {
  return isReady && client?.isReady() === true;
}

export async function getChannel(channelId: string): Promise<TextChannel | null> {
  if (!client || !isReady) return null;

  try {
    const channel = await client.channels.fetch(channelId);
    if (channel?.isTextBased() && 'send' in channel) {
      return channel as TextChannel;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getDmChannel(userId: string): Promise<DMChannel | null> {
  if (!client || !isReady) return null;

  // Allow DMs to admin users and restricted users
  if (!isAllowedDmUser(userId) && !isRestrictedUser(userId)) return null;

  try {
    const user = await client.users.fetch(userId);
    const dmChannel = await user.createDM();
    return dmChannel;
  } catch {
    return null;
  }
}

export async function getUser(userId: string): Promise<User | null> {
  if (!client || !isReady) return null;

  try {
    return await client.users.fetch(userId);
  } catch {
    return null;
  }
}

export function getGuilds() {
  if (!client || !isReady) return [];
  return Array.from(client.guilds.cache.values()).map((g) => ({
    id: g.id,
    name: g.name,
    icon: g.iconURL(),
  }));
}

export function getChannelsInGuild(guildId: string) {
  if (!client || !isReady) return [];

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return [];

  return Array.from(guild.channels.cache.values())
    .filter((c) => c.isTextBased() && 'send' in c)
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      guildId: guild.id,
      guildName: guild.name,
    }));
}

export function getAllChannels() {
  if (!client || !isReady) return [];

  const channels: Array<{
    id: string;
    name: string;
    type: number;
    guildId: string;
    guildName: string;
  }> = [];

  for (const guild of client.guilds.cache.values()) {
    for (const channel of guild.channels.cache.values()) {
      if (channel.isTextBased() && 'send' in channel) {
        channels.push({
          id: channel.id,
          name: channel.name,
          type: channel.type,
          guildId: guild.id,
          guildName: guild.name,
        });
      }
    }
  }

  return channels;
}
