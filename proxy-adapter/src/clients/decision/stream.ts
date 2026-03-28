/**
 * @deprecated Legacy SSE stream processor for old DecisionClient-based streaming.
 *
 * The chat-handler now uses Vercel AI SDK `streamText()` + `fullStream` directly.
 * This module is retained only because `base-impl.ts` (task-execution path) still
 * references `StreamProcessor`, `ToolCall`, and `UsageStats` types.
 *
 * Do NOT import this module from any new code.
 * TODO: Remove once the task-execution path is fully migrated to AI SDK streaming.
 */
import type { AxiosResponse } from 'axios';

export interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface UsageStats {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface StreamChunk {
  usage?: UsageStats;
  choices?: Array<{
    delta?: {
      reasoning_content?: string;
      content?: string;
      tool_calls?: ToolCall[];
    };
    message?: {
      content?: string;
    };
  }>;
}

export interface StreamCallbacks {
  onToken: (text: string) => void;
  onThinking: (text: string) => void;
  onToolCall: (call: ToolCall) => void;
  onUsage: (usage: UsageStats) => void;
  onDone: () => void;
}

export class StreamProcessor {
  async processSSEStream(response: AxiosResponse, callbacks: StreamCallbacks): Promise<void> {
    const { onToken, onThinking, onToolCall, onUsage, onDone } = callbacks;
    let doneCalled = false;
    let bufferStr = '';
    let receivedDone = false;
    let hasError = false;
    const triggerDone = (): void => {
      if (doneCalled) {
        return;
      }
      doneCalled = true;
      onDone();
    };
    const processLine = (line: string): void => {
      if (receivedDone) {
        return;
      }
      if (!line.trim() || !line.startsWith('data:')) {
        return;
      }
      const data = line.substring(5).trim();
      if (!data) {
        return;
      }
      if (data === '[DONE]') {
        receivedDone = true;
        return;
      }
      try {
        const parsed = JSON.parse(data);
        this.processChunk(parsed, onToken, onThinking, onToolCall, onUsage);
      } catch (parseError) {
        console.warn('Failed to parse SSE chunk:', data, parseError);
      }
    };
    const processChunkText = (chunkText: string): void => {
      if (!chunkText || receivedDone) {
        return;
      }
      bufferStr += chunkText;
      const lines = bufferStr.split(/\r?\n/);
      bufferStr = lines.pop() ?? '';
      for (const line of lines) {
        processLine(line);
      }
    };
    const flushBuffer = (): void => {
      if (bufferStr) {
        processLine(bufferStr);
        bufferStr = '';
      }
    };
    try {
      const status = response.status ?? 200;
      let errorData = '';
      await this.consumeData(response.data, (chunkText) => {
        if (status !== 200) {
          errorData += chunkText;
          return;
        }
        processChunkText(chunkText);
      });
      if (status !== 200) {
        const errorMessage = `Stream API returned status ${status}${errorData ? `: ${errorData}` : ''}`;
        console.error(errorMessage);
        throw new Error(errorMessage);
      }
      flushBuffer();
    } catch (error) {
      hasError = true;
      console.error('Error processing SSE stream:', error);
      throw error;
    } finally {
      if (!hasError) {
        triggerDone();
      }
    }
  }
  private async consumeData(data: unknown, onChunk: (chunkText: string) => void): Promise<void> {
    if (typeof data === 'string') {
      onChunk(data);
      return;
    }
    if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
      onChunk(Buffer.from(data).toString('utf-8'));
      return;
    }
    if (this.isAsyncIterable(data)) {
      for await (const chunk of data) {
        onChunk(this.chunkToText(chunk));
      }
      return;
    }
    if (this.isReadableLike(data)) {
      await new Promise<void>((resolve, reject) => {
        data.on('data', (chunk: unknown) => {
          onChunk(this.chunkToText(chunk));
        });
        data.on('end', () => resolve());
        data.on('error', (error: Error) => reject(error));
      });
      return;
    }
    throw new Error('Unsupported stream response data type');
  }
  private chunkToText(chunk: unknown): string {
    if (typeof chunk === 'string') {
      return chunk;
    }
    if (Buffer.isBuffer(chunk)) {
      return chunk.toString('utf-8');
    }
    if (chunk instanceof Uint8Array) {
      return Buffer.from(chunk).toString('utf-8');
    }
    return String(chunk);
  }
  private isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
    return (
      typeof value === 'object' &&
      value !== null &&
      Symbol.asyncIterator in value &&
      typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
    );
  }
  private isReadableLike(value: unknown): value is {
    on(event: 'data', listener: (chunk: unknown) => void): unknown;
    on(event: 'end', listener: () => void): unknown;
    on(event: 'error', listener: (error: Error) => void): unknown;
  } {
    return typeof value === 'object' && value !== null && 'on' in value && typeof value.on === 'function';
  }

  private processChunk(
    chunk: StreamChunk,
    onToken: (text: string) => void,
    onThinking: (text: string) => void,
    onToolCall: (call: ToolCall) => void,
    onUsage: (usage: UsageStats) => void
  ): void {
    if (chunk.usage) {
      onUsage(chunk.usage);
    }

    const delta = chunk.choices?.[0]?.delta;
    
    // Some providers might return content directly in the choice object instead of delta
    // But they might also return empty content, so we need to check if it exists
    if (chunk.choices?.[0]?.message?.content) {
      onToken(chunk.choices[0].message.content);
    }
    
    if (!delta) {
      return;
    }

    if (delta.reasoning_content) {
      onThinking(delta.reasoning_content);
    }

    if (delta.content) {
      onToken(delta.content);
    }

    if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
      for (const toolCall of delta.tool_calls) {
        onToolCall(toolCall);
      }
    }
  }
}
