import { Hono } from 'hono';
import { z } from 'zod';
import { discordService } from '../../discord/service.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  getPendingSessions,
  getSession,
  getSessionMessages,
  addSessionMessage,
  updateSessionStatus,
  DmSession,
} from '../../db/queries.js';

export const sessionRoutes = new Hono();

sessionRoutes.use('/*', authMiddleware);

// GET /sessions/pending - Get all sessions waiting for bot response
sessionRoutes.get('/pending', (c) => {
  const sessions = getPendingSessions();
  return c.json({ success: true, data: sessions });
});

// GET /sessions/:id - Get a specific session with all messages
sessionRoutes.get('/:id', (c) => {
  const sessionId = c.req.param('id');
  const session = getSession(sessionId);

  if (!session) {
    return c.json({ success: false, error: 'Session not found', errorCode: 'SESSION_NOT_FOUND' }, 404);
  }

  const messages = getSessionMessages(sessionId);

  return c.json({
    success: true,
    data: {
      ...session,
      messages,
    },
  });
});

const respondSchema = z.object({
  content: z.string().min(1),
  keepOpen: z.boolean().optional().default(true),
});

// POST /sessions/:id/respond - Respond to a session (sends DM to user)
sessionRoutes.post('/:id/respond', async (c) => {
  const sessionId = c.req.param('id');
  const session = getSession(sessionId);

  if (!session) {
    return c.json({ success: false, error: 'Session not found', errorCode: 'SESSION_NOT_FOUND' }, 404);
  }

  // Only allow responding to waiting sessions
  if (session.status !== 'waiting') {
    return c.json({
      success: false,
      error: `Cannot respond to session with status '${session.status}'. Session must be 'waiting'.`,
      errorCode: 'INVALID_SESSION_STATE',
    }, 400);
  }

  const body = await c.req.json();
  const parsed = respondSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'Invalid request body', errorCode: 'INVALID_REQUEST' }, 400);
  }

  const { content } = parsed.data;

  // Send DM first - only record message if DM succeeds
  const dmResult = await discordService.sendDm(session.user_id, content);

  if (!dmResult.success) {
    return c.json({
      success: false,
      error: dmResult.error || 'Failed to send DM',
      errorCode: dmResult.errorCode || 'DM_FAILED',
    }, 500);
  }

  // DM sent successfully, now record the message
  const message = addSessionMessage(sessionId, session.user_id, 'bot', content, dmResult.data?.messageId);

  // Status stays 'waiting' - only complete() changes to 'executed'

  return c.json({
    success: true,
    data: {
      messageId: message.id,
      discordMessageId: dmResult.data?.messageId,
      sessionId,
    },
  });
});

// POST /sessions/:id/complete - Mark session as executed
sessionRoutes.post('/:id/complete', (c) => {
  const sessionId = c.req.param('id');
  const session = getSession(sessionId);

  if (!session) {
    return c.json({ success: false, error: 'Session not found', errorCode: 'SESSION_NOT_FOUND' }, 404);
  }

  // Can only complete waiting or active sessions
  if (session.status === 'executed') {
    return c.json({
      success: false,
      error: 'Session already executed',
      errorCode: 'ALREADY_EXECUTED',
    }, 400);
  }

  if (session.status === 'stopped') {
    return c.json({
      success: false,
      error: 'Session was stopped by user',
      errorCode: 'SESSION_STOPPED',
    }, 400);
  }

  const updated = updateSessionStatus(sessionId, 'executed');

  if (!updated) {
    return c.json({ success: false, error: 'Failed to update session', errorCode: 'UPDATE_FAILED' }, 500);
  }

  return c.json({
    success: true,
    data: {
      sessionId,
      status: 'executed',
    },
  });
});
