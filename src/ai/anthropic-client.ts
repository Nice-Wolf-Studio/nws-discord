/**
 * Anthropic Client
 * Direct SDK wrapper for Claude API calls
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Brain, AnthropicMessage } from './types.js';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface CompletionRequest {
  brain: Brain;
  system: string;
  messages: AnthropicMessage[];
}

export interface CompletionResult {
  success: boolean;
  content?: string;
  input_tokens: number;
  output_tokens: number;
  error?: string;
}

/**
 * Call Claude API with the given brain config and messages
 * Each call is completely isolated - no shared state
 */
export async function complete(request: CompletionRequest): Promise<CompletionResult> {
  try {
    const response = await client.messages.create({
      model: request.brain.model,
      max_tokens: request.brain.max_tokens,
      system: request.system,
      messages: request.messages,
      ...(request.brain.temperature && { temperature: request.brain.temperature }),
      ...(request.brain.top_p && { top_p: request.brain.top_p }),
      ...(request.brain.top_k && { top_k: request.brain.top_k }),
    });

    // Extract text content from response
    const textContent = response.content.find(c => c.type === 'text');
    const content = textContent?.type === 'text' ? textContent.text : '';

    return {
      success: true,
      content,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AnthropicClient] API error:', errorMessage);

    return {
      success: false,
      content: undefined,
      input_tokens: 0,
      output_tokens: 0,
      error: errorMessage,
    };
  }
}
