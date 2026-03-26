import { Hono } from 'hono';
import { adminAuthMiddleware } from '../middleware/auth.js';
import { db } from '../../db/index.js';
import {
  getSession, getUserSessions, getSessionMessages, getSessionContext,
  updateSessionStatus, addSessionMessage, DmSession
} from '../../db/queries.js';
import { discordService } from '../../discord/service.js';

export const sessionRoutes = new Hono();

sessionRoutes.use('/*', adminAuthMiddleware);

// Get sessions ready for execution
sessionRoutes.get('/pending', (c) => {
  const sessions = db.prepare(`
    SELECT * FROM dm_sessions
    WHERE status = 'executed'
    ORDER BY updated_at ASC
  `).all() as DmSession[];

  return c.json({ success: true, data: sessions });
});

// Get a specific session with messages
sessionRoutes.get('/:sessionId', (c) => {
  const sessionId = c.req.param('sessionId');
  const session = getSession(sessionId);

  if (!session) {
    return c.json({ success: false, error: 'Session not found' }, 404);
  }

  const messages = getSessionMessages(sessionId);
  const context = getSessionContext(sessionId);

  return c.json({
    success: true,
    data: {
      session,
      messages,
      context,
    },
  });
});

// Get user's session history
sessionRoutes.get('/user/:userId', (c) => {
  const userId = c.req.param('userId');
  const limit = parseInt(c.req.query('limit') || '20', 10);

  const sessions = getUserSessions(userId, limit);
  return c.json({ success: true, data: sessions });
});

// Add bot response to session
sessionRoutes.post('/:sessionId/respond', async (c) => {
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json();
  const { content, keepOpen = true } = body;

  if (!content) {
    return c.json({ success: false, error: 'content is required' }, 400);
  }

  const session = getSession(sessionId);
  if (!session) {
    return c.json({ success: false, error: 'Session not found' }, 404);
  }

  // Add bot message to session
  const msg = addSessionMessage(sessionId, session.user_id, 'bot', content);

  // Send DM to user
  const dmResult = await discordService.sendDm(session.user_id, content);

  // Set to 'waiting' so we can continue the conversation when user replies
  if (keepOpen) {
    updateSessionStatus(sessionId, 'waiting');
  }

  return c.json({
    success: true,
    data: { message: msg, dmSent: dmResult.success, status: keepOpen ? 'waiting' : 'executed' },
  });
});

// Mark session as complete (after processing)
sessionRoutes.post('/:sessionId/complete', (c) => {
  const sessionId = c.req.param('sessionId');

  const session = getSession(sessionId);
  if (!session) {
    return c.json({ success: false, error: 'Session not found' }, 404);
  }

  updateSessionStatus(sessionId, 'stopped');
  return c.json({ success: true });
});
