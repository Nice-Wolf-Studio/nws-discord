/**
 * AI Module Types
 * Types for the Personality Engine
 */

// Database row types

export interface Brain {
  id: string;
  name: string;
  provider: 'anthropic'; // Only anthropic for now
  model: string;
  max_tokens: number;
  temperature: number;
  top_p: number | null;
  top_k: number | null;
  enabled: number; // SQLite boolean
  created_at: number;
  updated_at: number;
}

export interface Personality {
  id: string;
  name: string;
  display_name: string;
  discord_token_env: string;
  brain_id: string;
  system_prompt: string;
  greeting: string | null;
  error_response: string | null;
  is_admin: number; // SQLite boolean
  enabled: number; // SQLite boolean
  created_at: number;
  updated_at: number;
}

export interface ChannelAcl {
  personality_id: string;
  channel_id: string;
  guild_id: string | null;
  can_respond: number;
  respond_to_mentions: number;
  respond_to_all: number;
  bot_response_chance: number;
  bot_cooldown_seconds: number;
  last_response_at: number | null;
  created_at: number;
}

export interface UsageLogEntry {
  id: string;
  user_id: string;
  personality_id: string;
  brain_id: string;
  channel_id: string | null;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  success: number;
  error: string | null;
  created_at: number;
}

// API types

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface EngineRequest {
  user_id: string;
  personality_id: string;
  message: string;
  context?: ConversationMessage[];
  channel_id?: string; // null = DM
  is_dm: boolean;
}

export interface EngineResponse {
  success: boolean;
  response: string;
  input_tokens?: number;
  output_tokens?: number;
  latency_ms: number;
  error?: string;
}

// Anthropic SDK types (subset we need)

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: AnthropicMessage[];
  temperature?: number;
  top_p?: number;
  top_k?: number;
}

export interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}
