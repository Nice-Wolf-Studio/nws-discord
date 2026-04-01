/**
 * AI Module
 * Public exports for the Personality Engine
 */

// Main engine
export { execute, getGreeting } from './personality-engine.js';

// Anthropic client (for direct use if needed)
export { complete } from './anthropic-client.js';

// Types
export type {
  Brain,
  Personality,
  ChannelAcl,
  UsageLogEntry,
  ConversationMessage,
  EngineRequest,
  EngineResponse,
  AnthropicMessage,
  AnthropicRequest,
  AnthropicResponse,
} from './types.js';
