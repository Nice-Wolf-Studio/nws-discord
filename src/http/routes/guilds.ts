import { Hono } from 'hono';
import { discordService } from '../../discord/service.js';
import { authMiddleware } from '../middleware/auth.js';

export const guildRoutes = new Hono();

guildRoutes.use('/*', authMiddleware);

guildRoutes.get('/', (c) => {
  const guilds = discordService.listGuilds();
  return c.json({ success: true, data: guilds });
});
