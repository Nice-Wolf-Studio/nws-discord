import { Client, GatewayIntentBits, TextChannel, Message } from 'discord.js';

let client: Client | null = null;
let isReady = false;

export function getClient(): Client {
  if (!client) {
    client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    client.on('ready', () => {
      console.log(`Discord bot logged in as ${client?.user?.tag}`);
      isReady = true;
    });

    client.on('error', (error) => {
      console.error('Discord client error:', error);
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
