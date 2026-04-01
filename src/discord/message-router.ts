/**
 * Message Router
 * Determines when a personality should respond to a message
 * Implements the 5 rules for bot-to-bot communication
 */

import type { Message } from 'discord.js';
import type { ChannelAcl } from '../ai/types.js';

export interface RouteDecision {
  shouldRespond: boolean;
  reason: string;
}

/**
 * Determine if a personality should respond to a message
 *
 * Rules:
 * 1. @mention       → ALWAYS respond
 * 2. DM             → ALWAYS respond (it's 1:1)
 * 3. Human in channel → Respond (if ACL allows respond_to_all)
 * 4. Bot in channel → Respond ONLY if:
 *                     - @mentioned, OR
 *                     - Random chance (default 30%), AND
 *                     - Cooldown elapsed (default 10s)
 * 5. Own message    → NEVER respond
 */
export function shouldRespond(
  botUserId: string,
  message: Message,
  channelAcl: ChannelAcl | null,
  authorIsBot: boolean
): RouteDecision {
  // Rule 5: Never respond to self
  if (message.author.id === botUserId) {
    return { shouldRespond: false, reason: 'self' };
  }

  // Rule 1: Always respond to @mentions
  if (message.mentions.has(botUserId)) {
    return { shouldRespond: true, reason: 'mentioned' };
  }

  // Rule 2: DMs - always respond (user access checked elsewhere)
  if (message.channel.isDMBased()) {
    return { shouldRespond: true, reason: 'dm' };
  }

  // Channel messages need ACL
  if (!channelAcl) {
    return { shouldRespond: false, reason: 'no_acl' };
  }

  if (!channelAcl.can_respond) {
    return { shouldRespond: false, reason: 'channel_disabled' };
  }

  // Rule 3: Human in channel
  if (!authorIsBot) {
    if (channelAcl.respond_to_all) {
      return { shouldRespond: true, reason: 'human_respond_all' };
    }
    // Only respond to mentions for humans when respond_to_all is false
    if (channelAcl.respond_to_mentions) {
      return { shouldRespond: false, reason: 'human_not_mentioned' };
    }
    return { shouldRespond: false, reason: 'human_no_trigger' };
  }

  // Rule 4: Bot in channel
  const now = Date.now();
  const cooldownMs = (channelAcl.bot_cooldown_seconds || 10) * 1000;
  const lastResponse = channelAcl.last_response_at || 0;

  // Check cooldown
  if (now - lastResponse < cooldownMs) {
    return { shouldRespond: false, reason: 'cooldown' };
  }

  // Roll probability
  const chance = channelAcl.bot_response_chance ?? 0.3;
  if (Math.random() < chance) {
    return { shouldRespond: true, reason: 'bot_random' };
  }

  return { shouldRespond: false, reason: 'bot_probability_fail' };
}

/**
 * Check if we're in cooldown for a channel
 */
export function isInCooldown(channelAcl: ChannelAcl): boolean {
  const now = Date.now();
  const cooldownMs = (channelAcl.bot_cooldown_seconds || 10) * 1000;
  const lastResponse = channelAcl.last_response_at || 0;
  return now - lastResponse < cooldownMs;
}

/**
 * Calculate remaining cooldown time in seconds
 */
export function getRemainingCooldown(channelAcl: ChannelAcl): number {
  const now = Date.now();
  const cooldownMs = (channelAcl.bot_cooldown_seconds || 10) * 1000;
  const lastResponse = channelAcl.last_response_at || 0;
  const remaining = (lastResponse + cooldownMs) - now;
  return Math.max(0, Math.ceil(remaining / 1000));
}
