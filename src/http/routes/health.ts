import { Hono } from 'hono';
import { discordService } from '../../discord/service.js';

export const healthRoutes = new Hono();

healthRoutes.get('/', (c) => {
  const health = discordService.getHealth();
  const status = health.discordReady ? 200 : 503;
  return c.json(health, status);
});
