/**
 * Bot configurations - hardcoded for simplicity
 * When you have 10+ bots, THEN we talk databases
 */

export interface BotConfig {
  id: string;
  name: string;
  tokenEnvVar: string;
  aiEndpoint: string;
  personality: string | null;
  allowTools: boolean;
  isAdmin: boolean; // Can this bot handle admin commands?
}

export const BOT_CONFIGS: BotConfig[] = [
  {
    id: 'sombra',
    name: 'Sombra',
    tokenEnvVar: 'SOMBRA_DISCORD_TOKEN',
    aiEndpoint: process.env.SOMBRA_AI_URL || 'http://localhost:3001/execute',
    personality: null, // Sombra is the "real" bot - no personality wrapper
    allowTools: true,
    isAdmin: true, // Sombra handles admin commands, access requests
  },
  {
    id: 'donut',
    name: 'Princess Donut',
    tokenEnvVar: 'DONUT_DISCORD_TOKEN',
    aiEndpoint: process.env.DONUT_AI_URL || 'http://localhost:3001/execute',
    personality: 'princess-donut',
    allowTools: false,
    isAdmin: false,
  },
  // Add mordecai when we have a token:
  // {
  //   id: 'mordecai',
  //   name: 'Mordecai',
  //   tokenEnvVar: 'MORDECAI_DISCORD_TOKEN',
  //   aiEndpoint: process.env.MORDECAI_AI_URL || 'http://localhost:3001/execute',
  //   personality: 'mordecai',
  //   allowTools: false,
  //   isAdmin: false,
  // },
];

export function getBotConfig(botId: string): BotConfig | undefined {
  return BOT_CONFIGS.find(b => b.id === botId);
}

export function getAdminBot(): BotConfig | undefined {
  return BOT_CONFIGS.find(b => b.isAdmin);
}
