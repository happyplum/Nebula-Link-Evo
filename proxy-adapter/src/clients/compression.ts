import axios, { AxiosRequestConfig } from 'axios';
import type { DecisionClient } from './types.js';
import type { AIClient as CompressorAIClient } from '../conversation/compressor.js';
import type { Message } from '../conversation/types.js';

interface SummaryCapableDecisionClient extends DecisionClient {
  getApiEndpoint(): string;
  getHeaders(): Record<string, string>;
  getRequestBody(messages: unknown[], options?: AxiosRequestConfig): Record<string, unknown>;
}

function isSummaryCapableDecisionClient(
  client: DecisionClient | null
): client is SummaryCapableDecisionClient {
  if (!client) {
    return false;
  }

  const candidate = client as Partial<SummaryCapableDecisionClient>;
  return (
    typeof candidate.getApiEndpoint === 'function' &&
    typeof candidate.getHeaders === 'function' &&
    typeof candidate.getRequestBody === 'function'
  );
}

function formatMessagesForSummary(messages: Message[]): string {
  return messages
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join('\n\n');
}

export function createCompressionClient(
  decisionClient: DecisionClient | null
): CompressorAIClient | null {
  if (!isSummaryCapableDecisionClient(decisionClient)) {
    return null;
  }

  return {
    async generateSummary(messages: Message[]): Promise<string> {
      const requestMessages = [
        {
          role: 'system',
          content:
            'You compress chat history for future turns. Preserve user goals, key decisions, tool results, blockers, and any facts needed to continue the session. Keep it concise and factual.',
        },
        {
          role: 'user',
          content: [
            'Summarize the following conversation history for future context.',
            'Return plain text only.',
            '',
            formatMessagesForSummary(messages),
          ].join('\n'),
        },
      ];

      const options: AxiosRequestConfig = {
        headers: decisionClient.getHeaders(),
        timeout: 30000,
      };
      const requestBody = decisionClient.getRequestBody(requestMessages, options);
      const response = await axios.post(decisionClient.getApiEndpoint(), requestBody, options);
      const summary = response.data?.choices?.[0]?.message?.content;

      if (typeof summary !== 'string' || summary.trim().length === 0) {
        throw new Error(
          `Compression client for provider '${decisionClient.provider}' returned an empty summary`
        );
      }

      return summary.trim();
    },
  };
}
