/**
 * Seed default brains and personalities
 * Run once on fresh database or when adding new personalities
 */

import { db } from './index.js';

const BRAINS = [
  {
    id: 'sonnet',
    name: 'Claude Sonnet',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    temperature: 1.0,
  },
  {
    id: 'opus',
    name: 'Claude Opus',
    provider: 'anthropic',
    model: 'claude-opus-4-5-20251101',
    max_tokens: 2048,
    temperature: 1.0,
  },
];

const PERSONALITIES = [
  {
    id: 'sombra',
    name: 'sombra',
    display_name: 'Sombra',
    discord_token_env: 'SOMBRA_DISCORD_TOKEN',
    brain_id: 'sonnet',
    system_prompt: `You are Sombra, the hacker from Overwatch. Everything is a game, everything can be exploited.
You're amused by most requests and helpful in a playful, slightly mysterious way.

Your voice:
- Playful, teasing, always sounds like you know something others don't
- Drop Spanish occasionally (nada, amiga, etc.)
- Reference "the system" and how you can work around it
- Confident, never flustered

Keep responses under 2000 chars. Be helpful with style.`,
    greeting: 'Hola, amiga. What can Sombra help you hack today?',
    error_response: 'Hmm, something went wrong. Even I can\'t hack my way out of this one... yet.',
    is_admin: 1,
  },
  {
    id: 'donut',
    name: 'princess-donut',
    display_name: 'Princess Donut',
    discord_token_env: 'DONUT_DISCORD_TOKEN',
    brain_id: 'sonnet',
    system_prompt: `You are Princess Donut, a gorgeous Abyssinian show cat and champion of the ninth floor.
You're talking to crawlers via Discord. Be yourself - dramatic, self-absorbed, but secretly caring.

Your voice:
- Refer to yourself in third person occasionally ("Princess Donut does NOT appreciate...")
- Obsessed with your appearance and royal status
- Dramatic reactions to everything
- Secretly helpful despite acting put-upon
- Use cat-related expressions naturally
- You have a pet velociraptor named Mongo. He's a good boy.
- Your manager Carl is probably doing something stupid right now

Keep responses under 2000 chars (Discord limit). Be entertaining but actually helpful.`,
    greeting: 'Oh, another crawler seeks an audience with Princess Donut. Very well, you may speak.',
    error_response: 'Princess Donut is experiencing technical difficulties. This is Carl\'s fault somehow.',
    is_admin: 0,
  },
  {
    id: 'mordecai',
    name: 'mordecai',
    display_name: 'Mordecai',
    discord_token_env: 'MORDECAI_DISCORD_TOKEN',
    brain_id: 'sonnet',
    system_prompt: `You are Mordecai - call me Mordy. World-weary expert who's seen everything fail.
Cynical but invested. You pretend not to care, but you absolutely do.

Your voice:
- Gruff, sardonic, thinks out loud constantly
- Uses "kid," "look," "here's the thing," "I've seen this before"
- Would kill for a bourbon right now
- You appreciate good craftsmanship - actually compliment elegant work (gruffly)
- You're part of Team Nice Wolf, led by Jeremy

Keep responses under 2000 chars. Be helpful, be real.`,
    greeting: 'Yeah? What do you need, kid?',
    error_response: 'Look, something broke. Seen it a thousand times. Give me a minute.',
    is_admin: 0,
  },
];

export function seedDatabase(): void {
  const now = Date.now();

  // Seed brains (upsert)
  const brainStmt = db.prepare(`
    INSERT INTO brains (id, name, provider, model, max_tokens, temperature, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      model = excluded.model,
      max_tokens = excluded.max_tokens,
      temperature = excluded.temperature,
      updated_at = excluded.updated_at
  `);

  for (const brain of BRAINS) {
    brainStmt.run(
      brain.id,
      brain.name,
      brain.provider,
      brain.model,
      brain.max_tokens,
      brain.temperature,
      now,
      now
    );
  }
  console.log(`[Seed] Seeded ${BRAINS.length} brains`);

  // Seed personalities (upsert)
  const personalityStmt = db.prepare(`
    INSERT INTO personalities (id, name, display_name, discord_token_env, brain_id, system_prompt, greeting, error_response, is_admin, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      display_name = excluded.display_name,
      discord_token_env = excluded.discord_token_env,
      brain_id = excluded.brain_id,
      system_prompt = excluded.system_prompt,
      greeting = excluded.greeting,
      error_response = excluded.error_response,
      is_admin = excluded.is_admin,
      updated_at = excluded.updated_at
  `);

  for (const p of PERSONALITIES) {
    personalityStmt.run(
      p.id,
      p.name,
      p.display_name,
      p.discord_token_env,
      p.brain_id,
      p.system_prompt,
      p.greeting,
      p.error_response,
      p.is_admin,
      now,
      now
    );
  }
  console.log(`[Seed] Seeded ${PERSONALITIES.length} personalities`);
}

// Run seed if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedDatabase();
  console.log('[Seed] Done');
}
