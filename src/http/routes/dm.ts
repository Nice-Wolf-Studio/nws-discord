import { Hono } from 'hono';
import { z } from 'zod';
import { discordService } from '../../discord/service.js';
import { authMiddleware } from '../middleware/auth.js';

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

// Read DMs from allowed user
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
