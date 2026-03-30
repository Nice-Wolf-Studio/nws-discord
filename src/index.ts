import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createApp } from './http/server.js';
import { botManager } from './discord/bot-manager.js';
import { cleanupDedup, cleanupAuditLog, cleanupOldPersonalitySessions } from './db/queries.js';

// Import db to initialize it
import './db/index.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const DEDUP_WINDOW = parseInt(process.env.DEDUP_WINDOW_SECONDS || '300', 10);

async function main() {
  console.log('Starting nws-discord service...');

  // Initialize Discord bots
  console.log('Connecting Discord bots...');
  await botManager.initialize();
  console.log('Discord bots connected!');

  // Start HTTP server
  const app = createApp();
  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`HTTP server running on port ${info.port}`);
  });

  // Periodic cleanup
  setInterval(() => {
    const dedupCleaned = cleanupDedup(DEDUP_WINDOW);
    if (dedupCleaned > 0) {
      console.log(`Cleaned ${dedupCleaned} expired dedup entries`);
    }
  }, 60_000); // Every minute

  setInterval(() => {
    const auditCleaned = cleanupAuditLog(30); // 30 day retention
    if (auditCleaned > 0) {
      console.log(`Cleaned ${auditCleaned} old audit log entries`);
    }

    const sessionsCleaned = cleanupOldPersonalitySessions(7); // 7 day retention
    if (sessionsCleaned > 0) {
      console.log(`Cleaned ${sessionsCleaned} old personality sessions`);
    }
  }, 3600_000); // Every hour
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
