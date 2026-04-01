/**
 * Personality Engine
 * Main orchestrator for AI responses
 * Each call is completely isolated - no shared state between personalities
 */

import { complete } from './anthropic-client.js';
import { getPersonality, getBrain, logUsage } from '../db/queries.js';
import type { EngineRequest, EngineResponse, ConversationMessage, AnthropicMessage } from './types.js';

const DISCORD_CHAR_LIMIT = 2000;
const TRUNCATE_AT = 1900; // Leave room for "..." indicator

/**
 * Execute a personality response
 * This is the main entry point for all AI interactions
 */
export async function execute(request: EngineRequest): Promise<EngineResponse> {
  const startTime = Date.now();

  // 1. Load personality
  const personality = getPersonality(request.personality_id);
  if (!personality) {
    console.warn(`[PersonalityEngine] Personality not found: ${request.personality_id}`);
    return fail('Personality not found', startTime);
  }

  // 2. Load brain
  const brain = getBrain(personality.brain_id);
  if (!brain) {
    console.warn(`[PersonalityEngine] Brain not found: ${personality.brain_id}`);
    return fail(personality.error_response || 'Configuration error', startTime);
  }

  // 3. Build messages array
  const messages = buildMessages(request.context || [], request.message);

  // 4. Call Claude API (completely isolated - no shared state)
  const result = await complete({
    brain,
    system: personality.system_prompt,
    messages,
  });

  const latency_ms = Date.now() - startTime;

  // 5. Log usage
  logUsage({
    user_id: request.user_id,
    personality_id: request.personality_id,
    brain_id: brain.id,
    channel_id: request.channel_id || null,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
    latency_ms,
    success: result.success ? 1 : 0,
    error: result.error || null,
  });

  // 6. Handle failure
  if (!result.success || !result.content) {
    console.error(`[PersonalityEngine] API error for ${request.personality_id}:`, result.error);
    return {
      success: false,
      response: personality.error_response || 'Something went wrong.',
      latency_ms,
      error: result.error,
    };
  }

  // 7. Truncate if needed (Discord limit)
  let response = result.content;
  if (response.length > DISCORD_CHAR_LIMIT) {
    response = response.slice(0, TRUNCATE_AT) + '...';
  }

  return {
    success: true,
    response,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
    latency_ms,
  };
}

/**
 * Build messages array for Anthropic API
 * Converts our conversation format to Anthropic format
 */
function buildMessages(
  context: ConversationMessage[],
  newMessage: string
): AnthropicMessage[] {
  const messages: AnthropicMessage[] = [];

  // Add conversation history
  for (const msg of context) {
    messages.push({
      role: msg.role,
      content: msg.content,
    });
  }

  // Add new user message
  messages.push({
    role: 'user',
    content: newMessage,
  });

  return messages;
}

/**
 * Create a failure response
 */
function fail(message: string, startTime: number): EngineResponse {
  return {
    success: false,
    response: message,
    latency_ms: Date.now() - startTime,
    error: message,
  };
}

/**
 * Get a greeting message for a new session
 * Returns the personality's configured greeting or a default
 */
export function getGreeting(personalityId: string): string | null {
  const personality = getPersonality(personalityId);
  return personality?.greeting || null;
}
