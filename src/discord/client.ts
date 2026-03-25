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

      // Store the message
      const { storeIncomingDm } = await import('../db/queries.js');
      storeIncomingDm(message.id, message.author.id, message.author.tag, message.content);
      console.log(`DM received from ${message.author.tag}: ${message.content.substring(0, 50)}...`);
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
