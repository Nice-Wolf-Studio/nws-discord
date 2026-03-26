import { Client, GatewayIntentBits, Partials, TextChannel, DMChannel, Message, User } from 'discord.js';

let client: Client | null = null;
let isReady = false;

// Allowed DM user IDs (comma-separated in env)
const ALLOWED_DM_USERS = new Set(
  (process.env.ALLOWED_DM_USERS || '').split(',').map(id => id.trim()).filter(Boolean)
);

export function isAllowedDmUser(userId: string): boolean {
  return ALLOWED_DM_USERS.has(userId);
}

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
      // Required for receiving DMs
      partials: [Partials.Channel, Partials.Message],
    });

    client.on('ready', () => {
      console.log(`Discord bot logged in as ${client?.user?.tag}`);
      isReady = true;
    });

    client.on('error', (error) => {
      console.error('Discord client error:', error);
    });

    // Listen for incoming DMs from allowed users
    client.on('messageCreate', async (message) => {
      // Ignore bot messages
      if (message.author.bot) return;

      // Only handle DMs
      if (!message.channel.isDMBased()) return;

      // Only from allowed users
      if (!isAllowedDmUser(message.author.id)) {
        console.log(`Ignored DM from non-allowed user: ${message.author.tag}`);
        return;
      }

      const content = message.content.trim();
      const userId = message.author.id;
      const {
        createSession, getActiveSession, getWaitingSession, updateSessionStatus,
        addSessionMessage, getSessionMessages, getUserSessions,
        storeIncomingDm
      } = await import('../db/queries.js');

      // Handle commands
      const cmd = content.toLowerCase();

      // START - Begin new session
      if (cmd === 'start' || cmd === '/start') {
        // Stop any existing active session
        const existing = getActiveSession(userId);
        if (existing) {
          updateSessionStatus(existing.id, 'stopped');
        }

        const session = createSession(userId);
        await message.reply(`Session started (ID: ${session.id})\n\nTell me what you want to do. Say **execute** when ready, or **stop** to cancel.`);
        console.log(`Session started for ${message.author.tag}: ${session.id}`);
        return;
      }

      // STOP - End current session (active or waiting)
      if (cmd === 'stop' || cmd === '/stop') {
        const active = getActiveSession(userId);
        const waiting = getWaitingSession(userId);
        const session = active || waiting;
        if (!session) {
          await message.reply('No active session. Say **start** to begin.');
          return;
        }
        updateSessionStatus(session.id, 'stopped');
        await message.reply(`Session stopped (ID: ${session.id})`);
        console.log(`Session stopped for ${message.author.tag}: ${session.id}`);
        return;
      }

      // EXECUTE - Mark session ready for execution
      if (cmd === 'execute' || cmd === '/execute' || cmd === 'run' || cmd === '/run') {
        const session = getActiveSession(userId);
        if (!session) {
          await message.reply('No active session. Say **start** to begin.');
          return;
        }

        const messages = getSessionMessages(session.id);
        if (messages.length === 0) {
          await message.reply('Session is empty. Tell me what you want to do first.');
          return;
        }

        updateSessionStatus(session.id, 'executed');
        await message.reply(`Session marked for execution (ID: ${session.id})\n\nClaude Code will pick this up and respond.`);
        console.log(`Session executed for ${message.author.tag}: ${session.id}`);
        return;
      }

      // HISTORY - Show past sessions
      if (cmd === 'history' || cmd === '/history') {
        const sessions = getUserSessions(userId, 10);
        if (sessions.length === 0) {
          await message.reply('No sessions yet. Say **start** to begin.');
          return;
        }

        const list = sessions.map((s, i) => {
          const date = new Date(s.created_at).toLocaleString();
          const title = s.title || '(untitled)';
          return `${i + 1}. [${s.status}] ${title} - ${date} (${s.id})`;
        }).join('\n');

        await message.reply(`**Your Sessions:**\n\`\`\`\n${list}\n\`\`\``);
        return;
      }

      // HELP
      if (cmd === 'help' || cmd === '/help') {
        await message.reply(`**Commands:**
• **start** - Begin a new session
• **stop** - End current session
• **execute** / **run** - Send session to Claude Code
• **history** - View past sessions
• **help** - Show this message

During a session, just type normally. I'll save your messages until you say **execute**.`);
        return;
      }

      // Regular message - add to session or store as inbox
      const activeSession = getActiveSession(userId);
      const waitingSession = getWaitingSession(userId);

      if (activeSession) {
        // Add to active session (user is building up messages before execute)
        addSessionMessage(activeSession.id, userId, 'user', content, message.id);
        await message.reply(`Got it. Continue, or say **execute** when ready.`);
        console.log(`Session message from ${message.author.tag}: ${content.substring(0, 50)}...`);
      } else if (waitingSession) {
        // Bot responded and is waiting for user reply - auto-execute
        addSessionMessage(waitingSession.id, userId, 'user', content, message.id);
        updateSessionStatus(waitingSession.id, 'executed');
        await message.reply(`Got it, processing...`);
        console.log(`Waiting session reply from ${message.author.tag}: ${content.substring(0, 50)}...`);
      } else {
        // No active session - store in inbox and prompt
        storeIncomingDm(message.id, userId, message.author.tag, content);
        await message.reply(`No active session. Say **start** to begin, or **help** for commands.`);
        console.log(`DM (no session) from ${message.author.tag}: ${content.substring(0, 50)}...`);
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

  // Wait for ready event
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
  if (!isAllowedDmUser(userId)) return null;

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
