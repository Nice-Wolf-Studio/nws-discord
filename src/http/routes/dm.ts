import { Hono } from 'hono';
import { z } from 'zod';
import { discordService } from '../../discord/service.js';
import { authMiddleware } from '../middleware/auth.js';
import { getIncomingDms, markDmsRead, getUnreadDmCount } from '../../db/queries.js';

export const dmRoutes = new Hono();

dmRoutes.use('/*', authMiddleware);

const sendDmSchema = z.object({
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

// Send DM to allowed user
dmRoutes.post('/:userId', async (c) => {
  const userId = c.req.param('userId');

  if (!discordService.isAllowedDmUser(userId)) {
    return c.json({ success: false, error: 'User not allowed for DMs', errorCode: 'DM_NOT_ALLOWED' }, 403);
  }

  const body = await c.req.json();
  const parsed = sendDmSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'Invalid request body', errorCode: 'INVALID_EMBED' }, 400);
  }

  const result = await discordService.sendDm(userId, parsed.data.content, parsed.data.embed);

  if (!result.success) {
    return c.json(result, 400);
  }

  return c.json({ success: true, messageId: result.data?.messageId, userId });
});

// Read DM history with allowed user (via Discord API)
dmRoutes.get('/:userId', async (c) => {
  const userId = c.req.param('userId');
  const limit = parseInt(c.req.query('limit') || '50', 10);

  if (!discordService.isAllowedDmUser(userId)) {
    return c.json({ success: false, error: 'User not allowed for DMs', errorCode: 'DM_NOT_ALLOWED' }, 403);
  }

  const result = await discordService.readDms(userId, limit);

  if (!result.success) {
    return c.json(result, 400);
  }

  return c.json(result);
});

// Get incoming DMs (inbox) - messages FROM users TO the bot
dmRoutes.get('/inbox/all', (c) => {
  const unreadOnly = c.req.query('unread') === 'true';
  const limit = parseInt(c.req.query('limit') || '50', 10);

  const messages = getIncomingDms(undefined, unreadOnly, limit);
  const unreadCount = getUnreadDmCount();

  return c.json({ success: true, data: messages, unreadCount });
});

// Get inbox for specific user
dmRoutes.get('/inbox/:userId', (c) => {
  const userId = c.req.param('userId');
  const unreadOnly = c.req.query('unread') === 'true';
  const limit = parseInt(c.req.query('limit') || '50', 10);

  if (!discordService.isAllowedDmUser(userId)) {
    return c.json({ success: false, error: 'User not allowed for DMs', errorCode: 'DM_NOT_ALLOWED' }, 403);
  }

  const messages = getIncomingDms(userId, unreadOnly, limit);
  const unreadCount = getUnreadDmCount(userId);

  return c.json({ success: true, data: messages, unreadCount });
});

// Mark messages as read
dmRoutes.post('/inbox/read', async (c) => {
  const body = await c.req.json();
  const { ids } = body;

  if (!Array.isArray(ids)) {
    return c.json({ success: false, error: 'ids must be an array' }, 400);
  }

  const marked = markDmsRead(ids);
  return c.json({ success: true, marked });
});
