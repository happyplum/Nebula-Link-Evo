import type { ModelMessage } from 'ai';

/**
 * Lightweight token estimator for context window budgeting.
 *
 * Uses a conservative chars-per-token ratio so we *overestimate* input size,
 * which is safe — we'd rather trigger compression a bit early than blow the limit.
 *
 * No external deps (tiktoken etc.) needed — we only need an upper bound.
 */

/** Conservative chars-per-token ratio. 3 chars/token overestimates by ~15–25%
 *  for typical English/Chinese mixed content. */
const CHARS_PER_TOKEN = 3;

/** Per-message overhead: role markers, separators, structural JSON. */
const MESSAGE_OVERHEAD_TOKENS = 6;

/** Safety margin to account for tokenizer drift and hidden prompt formatting. */
const SAFETY_MARGIN_TOKENS = 512;

/**
 * Rough token count for a string.
 */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate total input tokens for an array of model messages.
 */
export function estimateMessagesTokens(messages: ModelMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += MESSAGE_OVERHEAD_TOKENS;
    total += estimateContentTokens(msg);
  }
  return total;
}

/**
 * Estimate token cost of tool definitions (names, descriptions, JSON schemas).
 */
export function estimateToolsTokens(tools: Record<string, unknown>): number {
  try {
    const json = JSON.stringify(tools);
    return estimateTextTokens(json);
  } catch {
    return Object.keys(tools).length * 100;
  }
}

/**
 * Estimate the total prompt tokens that will be sent to the model:
 *   system prompt + messages + tool definitions + overhead + safety margin
 */
export function estimateTotalInputTokens(
  systemPrompt: string,
  messages: ModelMessage[],
  tools: Record<string, unknown>,
): number {
  return (
    estimateTextTokens(systemPrompt) +
    estimateMessagesTokens(messages) +
    estimateToolsTokens(tools) +
    SAFETY_MARGIN_TOKENS
  );
}

function estimateContentTokens(msg: ModelMessage): number {
  if (typeof msg.content === 'string') {
    return estimateTextTokens(msg.content);
  }
  if (Array.isArray(msg.content)) {
    let t = 0;
    for (const part of msg.content) {
      if (typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
        t += estimateTextTokens(part.text);
      } else if (typeof part === 'object' && 'image' in part) {
        t += 1000;
      }
    }
    return t;
  }
  return 0;
}
