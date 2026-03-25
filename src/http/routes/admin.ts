import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { adminAuthMiddleware } from '../middleware/auth.js';
import {
  createApiKey,
  listApiKeys,
  deleteApiKey,
  addChannelPermission,
  removeChannelPermission,
  getChannelPermissions,
} from '../../db/queries.js';

export const adminRoutes = new Hono();

adminRoutes.use('/*', adminAuthMiddleware);

// Create API key
adminRoutes.post('/keys', async (c) => {
  const body = await c.req.json();
  const { name, rateLimit } = body;

  if (!name) {
    return c.json({ success: false, error: 'name is required' }, 400);
  }

  const id = nanoid(12);
  const rawKey = `nws_${nanoid(32)}`;

  createApiKey(id, rawKey, name, rateLimit);

  // Return the raw key only once - it won't be retrievable later
  return c.json({
    success: true,
    data: {
      id,
      name,
      apiKey: rawKey,
      note: 'Save this API key - it cannot be retrieved later',
    },
  });
});

// List API keys
adminRoutes.get('/keys', (c) => {
  const keys = listApiKeys();
  return c.json({ success: true, data: keys });
});

// Delete API key
adminRoutes.delete('/keys/:id', (c) => {
  const id = c.req.param('id');
  const deleted = deleteApiKey(id);

  if (!deleted) {
    return c.json({ success: false, error: 'API key not found' }, 404);
  }

  return c.json({ success: true });
});

// Get channel permissions for a key
adminRoutes.get('/keys/:id/channels', (c) => {
  const id = c.req.param('id');
  const permissions = getChannelPermissions(id);
  return c.json({ success: true, data: permissions });
});

// Add channel permission
adminRoutes.post('/keys/:id/channels', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { channelId, canRead = true, canWrite = true } = body;

  if (!channelId) {
    return c.json({ success: false, error: 'channelId is required' }, 400);
  }

  addChannelPermission(id, channelId, canRead, canWrite);
  return c.json({ success: true });
});

// Remove channel permission
adminRoutes.delete('/keys/:id/channels/:channelId', (c) => {
  const id = c.req.param('id');
  const channelId = c.req.param('channelId');

  const deleted = removeChannelPermission(id, channelId);

  if (!deleted) {
    return c.json({ success: false, error: 'Permission not found' }, 404);
  }

  return c.json({ success: true });
});
