import { EmbedBuilder, TextChannel } from 'discord.js';
import { botManager } from './bot-manager.js';
import { checkDedup, setDedup, logAction, canAccessChannel, getChannelPermissions } from '../db/queries.js';

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  url?: string;
  timestamp?: string;
  footer?: { text: string; icon_url?: string };
  thumbnail?: { url: string };
  image?: { url: string };
  author?: { name: string; url?: string; icon_url?: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

export interface SendMessageOptions {
  botId?: string; // Which bot sends - defaults to 'sombra'
  channelId: string;
  content?: string;
  embed?: DiscordEmbed;
  idempotencyKey?: string;
  apiKeyId: string;
}

export interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
}

// Default bot for backward compatibility
const DEFAULT_BOT = 'sombra';

export class DiscordService {
  async sendMessage(options: SendMessageOptions): Promise<ServiceResult<{ messageId: string }>> {
    const { botId = DEFAULT_BOT, channelId, content, embed, idempotencyKey, apiKeyId } = options;

    // Check permissions
    if (!canAccessChannel(apiKeyId, channelId, true)) {
      return { success: false, error: 'API key does not have write access to this channel', errorCode: 'CHANNEL_NOT_ALLOWED' };
    }

    // Check dedup
    if (idempotencyKey) {
      const existingMessageId = checkDedup(apiKeyId, idempotencyKey);
      if (existingMessageId) {
        return { success: true, data: { messageId: existingMessageId } };
      }
    }

    // Get channel via bot
    const channel = await botManager.getChannel(botId, channelId);
    if (!channel) {
      return { success: false, error: 'Channel not found or bot cannot access it', errorCode: 'BOT_MISSING_ACCESS' };
    }

    // Build message
    const messageOptions: { content?: string; embeds?: EmbedBuilder[] } = {};
    if (content) messageOptions.content = content;
    if (embed) {
      const embedBuilder = new EmbedBuilder();
      if (embed.title) embedBuilder.setTitle(embed.title);
      if (embed.description) embedBuilder.setDescription(embed.description);
      if (embed.color !== undefined) embedBuilder.setColor(embed.color);
      if (embed.url) embedBuilder.setURL(embed.url);
      if (embed.timestamp) embedBuilder.setTimestamp(new Date(embed.timestamp));
      if (embed.footer) embedBuilder.setFooter(embed.footer);
      if (embed.thumbnail) embedBuilder.setThumbnail(embed.thumbnail.url);
      if (embed.image) embedBuilder.setImage(embed.image.url);
      if (embed.author) embedBuilder.setAuthor(embed.author);
      if (embed.fields) embedBuilder.addFields(embed.fields);
      messageOptions.embeds = [embedBuilder];
    }

    if (!messageOptions.content && !messageOptions.embeds) {
      return { success: false, error: 'Message must have content or embed', errorCode: 'INVALID_EMBED' };
    }

    try {
      const message = await channel.send(messageOptions);

      // Store dedup
      if (idempotencyKey) {
        setDedup(apiKeyId, idempotencyKey, message.id);
      }

      // Audit log
      logAction(apiKeyId, 'send_message', channelId, message.id);

      return { success: true, data: { messageId: message.id } };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error, errorCode: 'DISCORD_ERROR' };
    }
  }

  async editMessage(
    apiKeyId: string,
    channelId: string,
    messageId: string,
    content?: string,
    embed?: DiscordEmbed,
    botId: string = DEFAULT_BOT
  ): Promise<ServiceResult<{ messageId: string }>> {
    if (!canAccessChannel(apiKeyId, channelId, true)) {
      return { success: false, error: 'API key does not have write access to this channel', errorCode: 'CHANNEL_NOT_ALLOWED' };
    }

    const channel = await botManager.getChannel(botId, channelId);
    if (!channel) {
      return { success: false, error: 'Channel not found', errorCode: 'BOT_MISSING_ACCESS' };
    }

    try {
      const message = await channel.messages.fetch(messageId);

      const editOptions: { content?: string; embeds?: EmbedBuilder[] } = {};
      if (content) editOptions.content = content;
      if (embed) {
        const embedBuilder = new EmbedBuilder();
        if (embed.title) embedBuilder.setTitle(embed.title);
        if (embed.description) embedBuilder.setDescription(embed.description);
        if (embed.color !== undefined) embedBuilder.setColor(embed.color);
        if (embed.fields) embedBuilder.addFields(embed.fields);
        editOptions.embeds = [embedBuilder];
      }

      await message.edit(editOptions);
      logAction(apiKeyId, 'edit_message', channelId, messageId);

      return { success: true, data: { messageId } };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error, errorCode: 'DISCORD_ERROR' };
    }
  }

  async deleteMessage(
    apiKeyId: string,
    channelId: string,
    messageId: string,
    botId: string = DEFAULT_BOT
  ): Promise<ServiceResult<void>> {
    if (!canAccessChannel(apiKeyId, channelId, true)) {
      return { success: false, error: 'API key does not have write access to this channel', errorCode: 'CHANNEL_NOT_ALLOWED' };
    }

    const channel = await botManager.getChannel(botId, channelId);
    if (!channel) {
      return { success: false, error: 'Channel not found', errorCode: 'BOT_MISSING_ACCESS' };
    }

    try {
      const message = await channel.messages.fetch(messageId);
      await message.delete();
      logAction(apiKeyId, 'delete_message', channelId, messageId);

      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error, errorCode: 'DISCORD_ERROR' };
    }
  }

  async readMessages(
    apiKeyId: string,
    channelId: string,
    limit = 50,
    botId: string = DEFAULT_BOT
  ): Promise<ServiceResult<Array<{ id: string; content: string; author: string; timestamp: string }>>> {
    if (!canAccessChannel(apiKeyId, channelId, false)) {
      return { success: false, error: 'API key does not have read access to this channel', errorCode: 'CHANNEL_NOT_ALLOWED' };
    }

    const channel = await botManager.getChannel(botId, channelId);
    if (!channel) {
      return { success: false, error: 'Channel not found', errorCode: 'BOT_MISSING_ACCESS' };
    }

    try {
      const messages = await channel.messages.fetch({ limit: Math.min(limit, 100) });
      const result = Array.from(messages.values()).map((m) => ({
        id: m.id,
        content: m.content,
        author: m.author.username,
        timestamp: m.createdAt.toISOString(),
      }));

      logAction(apiKeyId, 'read_messages', channelId);
      return { success: true, data: result };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error, errorCode: 'DISCORD_ERROR' };
    }
  }

  async addReaction(
    apiKeyId: string,
    channelId: string,
    messageId: string,
    emoji: string,
    botId: string = DEFAULT_BOT
  ): Promise<ServiceResult<void>> {
    if (!canAccessChannel(apiKeyId, channelId, true)) {
      return { success: false, error: 'API key does not have write access to this channel', errorCode: 'CHANNEL_NOT_ALLOWED' };
    }

    const channel = await botManager.getChannel(botId, channelId);
    if (!channel) {
      return { success: false, error: 'Channel not found', errorCode: 'BOT_MISSING_ACCESS' };
    }

    try {
      const message = await channel.messages.fetch(messageId);
      await message.react(emoji);
      logAction(apiKeyId, 'add_reaction', channelId, messageId);

      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error, errorCode: 'DISCORD_ERROR' };
    }
  }

  listChannels(apiKeyId: string) {
    // For now, return empty - channels would need to be collected across all bots
    // This is a Phase B concern
    const permissions = getChannelPermissions(apiKeyId);
    return permissions.map(p => ({
      id: p.channel_id,
      name: 'unknown', // Would need channel fetch
      type: 0,
      guildId: 'unknown',
      guildName: 'unknown',
    }));
  }

  listGuilds() {
    return botManager.getGuilds();
  }

  // DM Methods
  async sendDm(
    userId: string,
    content?: string,
    embed?: DiscordEmbed,
    botId: string = DEFAULT_BOT
  ): Promise<ServiceResult<{ messageId: string }>> {
    if (!botManager.canReceiveDm(userId)) {
      return { success: false, error: 'User not allowed for DMs', errorCode: 'DM_NOT_ALLOWED' };
    }

    const dmChannel = await botManager.getDmChannel(botId, userId);
    if (!dmChannel) {
      return { success: false, error: 'Could not create DM channel', errorCode: 'DM_FAILED' };
    }

    const messageOptions: { content?: string; embeds?: EmbedBuilder[] } = {};
    if (content) messageOptions.content = content;
    if (embed) {
      const embedBuilder = new EmbedBuilder();
      if (embed.title) embedBuilder.setTitle(embed.title);
      if (embed.description) embedBuilder.setDescription(embed.description);
      if (embed.color !== undefined) embedBuilder.setColor(embed.color);
      if (embed.fields) embedBuilder.addFields(embed.fields);
      messageOptions.embeds = [embedBuilder];
    }

    if (!messageOptions.content && !messageOptions.embeds) {
      return { success: false, error: 'Message must have content or embed', errorCode: 'INVALID_EMBED' };
    }

    try {
      const message = await dmChannel.send(messageOptions);
      return { success: true, data: { messageId: message.id } };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error, errorCode: 'DISCORD_ERROR' };
    }
  }

  async readDms(
    userId: string,
    limit = 50,
    botId: string = DEFAULT_BOT
  ): Promise<ServiceResult<Array<{ id: string; content: string; author: string; timestamp: string; fromBot: boolean }>>> {
    if (!botManager.canReceiveDm(userId)) {
      return { success: false, error: 'User not allowed for DMs', errorCode: 'DM_NOT_ALLOWED' };
    }

    const dmChannel = await botManager.getDmChannel(botId, userId);
    if (!dmChannel) {
      return { success: false, error: 'Could not create DM channel', errorCode: 'DM_FAILED' };
    }

    try {
      const messages = await dmChannel.messages.fetch({ limit: Math.min(limit, 100) });
      const result = Array.from(messages.values()).map((m) => ({
        id: m.id,
        content: m.content,
        author: m.author.username,
        timestamp: m.createdAt.toISOString(),
        fromBot: m.author.bot,
      }));

      return { success: true, data: result };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error, errorCode: 'DISCORD_ERROR' };
    }
  }

  isAllowedDmUser(userId: string): boolean {
    return botManager.isAllowedDmUser(userId);
  }

  canReceiveDm(userId: string): boolean {
    return botManager.canReceiveDm(userId);
  }

  getHealth() {
    const onlineBots = botManager.getOnlineBots();
    return {
      discordReady: botManager.isReady(),
      bots: onlineBots,
      timestamp: new Date().toISOString(),
    };
  }
}

export const discordService = new DiscordService();
