import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { healthRoutes } from './routes/health.js';
import { channelRoutes } from './routes/channels.js';
import { guildRoutes } from './routes/guilds.js';
import { adminRoutes } from './routes/admin.js';
import { dmRoutes } from './routes/dm.js';
import { sessionRoutes } from './routes/sessions.js';

export function createApp() {
  const app = new Hono();

  // Middleware
  app.use('*', cors());
  app.use('*', logger());

  // Routes
  app.route('/health', healthRoutes);
  app.route('/channels', channelRoutes);
  app.route('/guilds', guildRoutes);
  app.route('/admin', adminRoutes);
  app.route('/dm', dmRoutes);
  app.route('/sessions', sessionRoutes);

  // Root
  app.get('/', (c) => {
    return c.json({
      name: 'nws-discord',
      version: '1.0.0',
      endpoints: ['/health', '/channels', '/guilds', '/admin'],
    });
  });

  return app;
}
