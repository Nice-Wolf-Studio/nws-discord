import { Context, Next } from 'hono';
import { validateApiKey, ApiKey } from '../../db/queries.js';

declare module 'hono' {
  interface ContextVariableMap {
    apiKey: ApiKey;
  }
}

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Missing or invalid Authorization header', errorCode: 'INVALID_API_KEY' }, 401);
  }

  const rawKey = authHeader.slice(7);
  const apiKey = validateApiKey(rawKey);

  if (!apiKey) {
    return c.json({ success: false, error: 'Invalid API key', errorCode: 'INVALID_API_KEY' }, 401);
  }

  c.set('apiKey', apiKey);
  await next();
}

export async function adminAuthMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  const adminKey = process.env.ADMIN_API_KEY;

  if (!adminKey) {
    return c.json({ success: false, error: 'Admin API not configured', errorCode: 'SERVER_ERROR' }, 500);
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Missing or invalid Authorization header', errorCode: 'INVALID_API_KEY' }, 401);
  }

  const providedKey = authHeader.slice(7);
  if (providedKey !== adminKey) {
    return c.json({ success: false, error: 'Invalid admin API key', errorCode: 'INVALID_API_KEY' }, 401);
  }

  await next();
}
