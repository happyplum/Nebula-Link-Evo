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
            '你负责压缩对话历史，供后续对话使用。' +
            '请保留以下关键信息：用户目标、关键决策、工具调用名称及结果摘要、遇到的阻碍、以及继续会话所需的事实。' +
            '工具调用结果已被精简（显示为 [工具调用结果 xxx]），请根据工具名称和提示推断其作用。' +
            '保持简洁、基于事实，用中文输出。',
        },
        {
          role: 'user',
          content: [
            '请对以下完整对话历史进行摘要压缩，保留关键上下文供后续对话使用。',
            '仅输出摘要文本，不要输出其他内容。',
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
