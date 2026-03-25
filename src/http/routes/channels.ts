import { Hono } from 'hono';
import { z } from 'zod';
import { discordService } from '../../discord/service.js';
import { authMiddleware } from '../middleware/auth.js';

export const channelRoutes = new Hono();

channelRoutes.use('/*', authMiddleware);

// List channels this client can access
channelRoutes.get('/', (c) => {
  const apiKey = c.get('apiKey');
  const channels = discordService.listChannels(apiKey.id);
  return c.json({ success: true, data: channels });
});

// Get messages from a channel
channelRoutes.get('/:channelId/messages', async (c) => {
  const apiKey = c.get('apiKey');
  const channelId = c.req.param('channelId');
  const limit = parseInt(c.req.query('limit') || '50', 10);

  const result = await discordService.readMessages(apiKey.id, channelId, limit);

  if (!result.success) {
    const status = result.errorCode === 'CHANNEL_NOT_ALLOWED' ? 403 : 400;
    return c.json(result, status);
  }

  return c.json(result);
});

const sendMessageSchema = z.object({
  content: z.string().optional(),
  embed: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    color: z.number().optional(),
    url: z.string().url().optional(),
    timestamp: z.string().optional(),
    footer: z.object({
      text: z.string(),
      icon_url: z.string().optional(),
    }).optional(),
    thumbnail: z.object({ url: z.string() }).optional(),
    image: z.object({ url: z.string() }).optional(),
    author: z.object({
      name: z.string(),
      url: z.string().optional(),
      icon_url: z.string().optional(),
    }).optional(),
    fields: z.array(z.object({
      name: z.string(),
      value: z.string(),
      inline: z.boolean().optional(),
    })).optional(),
  }).optional(),
  idempotencyKey: z.string().optional(),
});

// Send a message
channelRoutes.post('/:channelId/messages', async (c) => {
  const apiKey = c.get('apiKey');
  const channelId = c.req.param('channelId');

  const body = await c.req.json();
  const parsed = sendMessageSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'Invalid request body', errorCode: 'INVALID_EMBED' }, 400);
  }

  const result = await discordService.sendMessage({
    channelId,
    content: parsed.data.content,
    embed: parsed.data.embed,
    idempotencyKey: parsed.data.idempotencyKey,
    apiKeyId: apiKey.id,
  });

  if (!result.success) {
    const status = result.errorCode === 'CHANNEL_NOT_ALLOWED' ? 403 : 400;
    return c.json(result, status);
  }

  return c.json({ success: true, messageId: result.data?.messageId, channelId });
});

const editMessageSchema = z.object({
  content: z.string().optional(),
  embed: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    color: z.number().optional(),
    fields: z.array(z.object({
      name: z.string(),
      value: z.string(),
      inline: z.boolean().optional(),
    })).optional(),
  }).optional(),
});

// Edit a message
channelRoutes.patch('/:channelId/messages/:messageId', async (c) => {
  const apiKey = c.get('apiKey');
  const channelId = c.req.param('channelId');
  const messageId = c.req.param('messageId');

  const body = await c.req.json();
  const parsed = editMessageSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'Invalid request body', errorCode: 'INVALID_EMBED' }, 400);
  }

  const result = await discordService.editMessage(
    apiKey.id,
    channelId,
    messageId,
    parsed.data.content,
    parsed.data.embed
  );

  if (!result.success) {
    const status = result.errorCode === 'CHANNEL_NOT_ALLOWED' ? 403 : 400;
    return c.json(result, status);
  }

  return c.json({ success: true, messageId, channelId });
});

// Delete a message
channelRoutes.delete('/:channelId/messages/:messageId', async (c) => {
  const apiKey = c.get('apiKey');
  const channelId = c.req.param('channelId');
  const messageId = c.req.param('messageId');

  const result = await discordService.deleteMessage(apiKey.id, channelId, messageId);

  if (!result.success) {
    const status = result.errorCode === 'CHANNEL_NOT_ALLOWED' ? 403 : 400;
    return c.json(result, status);
  }

  return c.json({ success: true });
});

// Add reaction
channelRoutes.post('/:channelId/reactions', async (c) => {
  const apiKey = c.get('apiKey');
  const channelId = c.req.param('channelId');

  const body = await c.req.json();
  const { messageId, emoji } = body;

  if (!messageId || !emoji) {
    return c.json({ success: false, error: 'messageId and emoji are required', errorCode: 'INVALID_EMBED' }, 400);
  }

  const result = await discordService.addReaction(apiKey.id, channelId, messageId, emoji);

  if (!result.success) {
    const status = result.errorCode === 'CHANNEL_NOT_ALLOWED' ? 403 : 400;
    return c.json(result, status);
  }

  return c.json({ success: true });
});
