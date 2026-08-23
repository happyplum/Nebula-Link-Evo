import { createHmac } from 'node:crypto';
import { createParser } from 'eventsource-parser';
import {
  CallId,
  EMPTY_RESPONSE_CODE,
  LlmAdapter,
  LlmError,
  attributionHeaders,
  resolveRetryPolicy,
} from '@deepseek-ai/dsh-llm';
import type {
  ContentBlock,
  FinishReason,
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  PreparedAdapterCall,
  ResolvedRetryPolicy,
  StreamChunk,
  TokenUsage,
} from '@deepseek-ai/dsh-llm';
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment';
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout';

const GLM_TIMEOUT_CODE = 'GLM_LLM_DEADLINE';
const MAX_SSE_BUFFER_CHARS = 4 * 1024 * 1024;
const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';

export interface NebulaGlmModel {
  id: string;
  contextWindow: number;
  maxTokens: number;
  acceptsImages: boolean;
}

export interface NebulaGlmAdapterOptions {
  provider: string;
  apiKeyEnv: string;
  baseUrl?: string;
  timeoutMs: number;
  retryPolicy: { mode: 'normal'; maxRetries: number };
  models: readonly NebulaGlmModel[];
  env?: Readonly<Record<string, string | undefined>>;
  attachments?: () => AttachmentStore | undefined;
  fetch?: typeof globalThis.fetch;
}

interface WireToolCall {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface WireChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: WireToolCall[];
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

interface OpenBlock {
  index: number;
  kind: 'text' | 'reasoning' | 'tool-call';
  text: string;
  callId?: string;
  name?: string;
}

/** GLM uses an OpenAI-compatible stream but requires a short-lived HS256 JWT per request. */
export class NebulaGlmLlmAdapter extends LlmAdapter {
  private readonly baseUrl: string;
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly request: typeof globalThis.fetch;
  private readonly retry: ResolvedRetryPolicy;

  constructor(private readonly options: NebulaGlmAdapterOptions) {
    super();
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.env = options.env ?? process.env;
    this.request = options.fetch ?? globalThis.fetch;
    this.retry = resolveRetryPolicy(options.retryPolicy, `providers.${options.provider}.retryPolicy`);
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: '智谱 GLM' };
  }

  override providerRetryPolicy(): ResolvedRetryPolicy {
    return this.retry;
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.options.models.map((model) => modelInfo(provider, model)));
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve(this.resolveModelInfo(provider, model));
  }

  override prepareCall(provider: string, model: string): Promise<PreparedAdapterCall> {
    const resolved = this.resolveModelInfo(provider, model);
    return Promise.resolve({ model: resolved, stream: (options) => this.stream(options) });
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const model = this.resolveConfiguredModel(options.model);
    const hasImages = options.messages.some((message) => hasImage(message.content));
    const attachments = hasImages ? this.options.attachments?.() : undefined;
    if (hasImages && !model.acceptsImages) {
      throw new LlmError(`GLM model "${options.model}" does not accept image input.`, 'UNSUPPORTED_CONTENT');
    }
    if (hasImages && !attachments) {
      throw new LlmError('GLM image input requires the durable attachment service.', 'UNSUPPORTED_CONTENT');
    }

    const rawApiKey = this.env[this.options.apiKeyEnv]?.trim();
    if (!rawApiKey) {
      throw new LlmError(
        `GLM credential environment variable ${this.options.apiKeyEnv} is unavailable.`,
        'MISSING_CREDENTIAL'
      );
    }
    const bearer = createGlmJwt(rawApiKey);
    const requestDeadline = deadline(options.signal, this.options.timeoutMs, GLM_TIMEOUT_CODE);
    try {
      const response = await this.request(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          ...attributionHeaders({
            product: 'nebula-link-evo',
            version: '0.1.0',
            url: 'https://github.com/nebula-link-evo/nebula-link-evo',
          }),
          authorization: `Bearer ${bearer}`,
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        body: JSON.stringify(await serializeRequest(options, attachments, requestDeadline.signal)),
        signal: requestDeadline.signal,
      });
      if (!response.ok) throw await providerError(response);
      if (!response.body) throw new LlmError('GLM response has no stream body.', 'MALFORMED_RESPONSE');
      yield* translateSse(response.body, requestDeadline.signal);
    } catch (error) {
      const timedOut = timeoutOf(requestDeadline.signal, GLM_TIMEOUT_CODE);
      if (timedOut) {
        throw new LlmError(`GLM request exceeded ${timedOut.timeoutMs}ms.`, 'TIMEOUT', { cause: error });
      }
      if (options.signal?.aborted || requestDeadline.signal.aborted) {
        throw new LlmError('GLM request was aborted.', 'ABORTED', { cause: error });
      }
      throw error;
    } finally {
      requestDeadline[Symbol.dispose]();
    }
  }

  private resolveConfiguredModel(modelId: string): NebulaGlmModel {
    return (
      this.options.models.find((model) => model.id === modelId) ?? {
        id: modelId,
        contextWindow: 131_072,
        maxTokens: 1_000,
        acceptsImages: false,
      }
    );
  }

  private resolveModelInfo(provider: string, modelId: string): LlmResolvedModelInfo {
    const model = this.resolveConfiguredModel(modelId);
    return {
      ...modelInfo(provider, model),
      context: { contextWindow: model.contextWindow },
      defaultMaxTokens: model.maxTokens,
    };
  }
}

function modelInfo(provider: string, model: NebulaGlmModel): LlmModelInfo {
  return {
    provider,
    id: model.id,
    name: model.id,
    inputModalities: model.acceptsImages ? ['text', 'image'] : ['text'],
  };
}

export function createGlmJwt(apiKey: string, nowSeconds = Math.floor(Date.now() / 1_000)): string {
  const separator = apiKey.indexOf('.');
  if (separator <= 0 || separator === apiKey.length - 1) {
    throw new LlmError('GLM API key must use id.secret format.', 'INVALID_CREDENTIAL');
  }
  const id = apiKey.slice(0, separator);
  const secret = apiKey.slice(separator + 1);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', sign_type: 'SIGN' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ api_key: id, exp: nowSeconds + 3_600, timestamp: nowSeconds })
  ).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

async function serializeRequest(
  options: GenerateOptions,
  attachments: AttachmentStore | undefined,
  signal: AbortSignal
): Promise<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  if (options.system !== undefined) messages.push({ role: 'system', content: options.system });
  for (const message of options.messages) {
    if (message.role === 'assistant') {
      const content = textOf(message.content);
      const reasoning = message.content
        .filter((block) => block.type === 'reasoning')
        .map((block) => block.text)
        .join('');
      const toolCalls = message.content
        .filter((block) => block.type === 'tool-call')
        .map((block) => ({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: block.arguments },
        }));
      messages.push({
        role: 'assistant',
        content,
        ...(reasoning ? { reasoning_content: reasoning } : {}),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    const regular = message.content.filter((block) => block.type !== 'tool-result');
    const toolResults = message.content.filter((block) => block.type === 'tool-result');
    if (regular.length > 0 || toolResults.length === 0) {
      messages.push({ role: message.role, content: await userContent(regular, attachments, signal) });
    }
    for (const result of toolResults) {
      messages.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        content: textOf(result.content) || '(no output)',
      });
    }
  }

  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(options.tools?.length
      ? {
          tools: options.tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
        }
      : {}),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
    ...(options.stop === undefined ? {} : { stop: options.stop }),
  };
}

async function userContent(
  content: readonly ContentBlock[],
  attachments: AttachmentStore | undefined,
  signal: AbortSignal
): Promise<string | Array<Record<string, unknown>>> {
  if (!hasImage(content)) return textOf(content);
  if (!attachments) throw new LlmError('GLM image attachment store is unavailable.', 'UNSUPPORTED_CONTENT');
  const parts: Array<Record<string, unknown>> = [];
  for (const block of content) {
    if (block.type === 'text' && block.text) parts.push({ type: 'text', text: block.text });
    if (block.type === 'image') {
      const image = await attachments.readImageRequest(
        block.attachment,
        { maxPixels: 4_000_000, maxBytes: 2 * 1024 * 1024 },
        signal
      );
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${image.mediaType};base64,${Buffer.from(image.data).toString('base64')}` },
      });
    }
  }
  return parts;
}

function hasImage(content: readonly ContentBlock[]): boolean {
  return content.some(
    (block) => block.type === 'image' || (block.type === 'tool-result' && hasImage(block.content))
  );
}

function textOf(content: readonly ContentBlock[]): string {
  return content
    .flatMap((block) => {
      if (block.type === 'text' || block.type === 'reasoning') return [block.text];
      if (block.type === 'tool-result') return [textOf(block.content)];
      return [];
    })
    .join('');
}

async function providerError(response: Response): Promise<LlmError> {
  const text = (await response.text()).slice(0, 2_000);
  let message = text || response.statusText;
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === 'string') message = parsed.error.message;
  } catch {
    // The bounded response text remains the diagnostic for non-JSON gateways.
  }
  const code =
    response.status === 401 || response.status === 403
      ? 'AUTH'
      : response.status === 429
        ? 'RATE_LIMIT'
        : response.status >= 500
          ? 'SERVER'
          : 'INVALID_REQUEST';
  return new LlmError(`GLM request failed: ${message}`, code, { status: response.status });
}

async function* ssePayloads(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal
): AsyncGenerator<string> {
  const queue: string[] = [];
  let parseFailure: Error | undefined;
  const parser = createParser({
    maxBufferSize: MAX_SSE_BUFFER_CHARS,
    onEvent: (event) => queue.push(event.data),
    onError: (error) => {
      parseFailure = error;
    },
  });
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let sawDone = false;
  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const next = await reader.read();
      if (next.done) break;
      parser.feed(decoder.decode(next.value, { stream: true }));
      if (parseFailure) throw new LlmError(parseFailure.message, 'MALFORMED_RESPONSE', { cause: parseFailure });
      while (queue.length) {
        const payload = queue.shift()!;
        yield payload;
        if (payload === '[DONE]') {
          sawDone = true;
          return;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (!sawDone) throw new LlmError('GLM SSE stream ended without [DONE].', 'STREAM_CLOSED');
}

async function* translateSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal
): AsyncGenerator<StreamChunk> {
  let nextIndex = 0;
  let textBlock: OpenBlock | undefined;
  let reasoningBlock: OpenBlock | undefined;
  const toolBlocks = new Map<number, OpenBlock>();
  const order: OpenBlock[] = [];
  let pendingFinish: FinishReason | undefined;
  let pendingUsage: TokenUsage | undefined;
  const open = (kind: OpenBlock['kind']): OpenBlock => {
    const block: OpenBlock = { index: nextIndex++, kind, text: '' };
    order.push(block);
    return block;
  };

  for await (const payload of ssePayloads(body, signal)) {
    if (payload === '[DONE]') {
      for (const block of order) {
        yield { type: 'block-end', index: block.index, block: closeBlock(block) };
      }
      if (pendingUsage) yield { type: 'usage', usage: pendingUsage };
      const reason = pendingFinish ?? { kind: 'stop' as const };
      yield {
        type: 'finish',
        reason:
          reason.kind === 'stop' && order.length === 0
            ? {
                kind: 'error',
                failure: { message: 'GLM returned no content.', code: EMPTY_RESPONSE_CODE },
              }
            : reason,
      };
      return;
    }

    let chunk: WireChunk;
    try {
      chunk = JSON.parse(payload) as WireChunk;
    } catch (error) {
      throw new LlmError(`Malformed GLM SSE payload: ${payload.slice(0, 120)}`, 'MALFORMED_RESPONSE', {
        cause: error,
      });
    }
    for (const choice of chunk.choices ?? []) {
      const reasoning = choice.delta?.reasoning_content;
      if (reasoning) {
        if (!reasoningBlock) {
          reasoningBlock = open('reasoning');
          yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' };
        }
        reasoningBlock.text += reasoning;
        yield { type: 'reasoning-delta', index: reasoningBlock.index, text: reasoning };
      }
      const text = choice.delta?.content;
      if (text) {
        if (!textBlock) {
          textBlock = open('text');
          yield { type: 'block-start', index: textBlock.index, blockType: 'text' };
        }
        textBlock.text += text;
        yield { type: 'text-delta', index: textBlock.index, text };
      }
      for (const call of choice.delta?.tool_calls ?? []) {
        let block = toolBlocks.get(call.index);
        if (!block) {
          block = open('tool-call');
          toolBlocks.set(call.index, block);
          yield { type: 'block-start', index: block.index, blockType: 'tool-call' };
        }
        if (call.id !== undefined) block.callId = call.id;
        if (call.function?.name !== undefined) block.name = call.function.name;
        const fragment = call.function?.arguments ?? '';
        block.text += fragment;
        yield {
          type: 'tool-call-delta',
          index: block.index,
          id: CallId(block.callId ?? ''),
          ...(block.name === undefined ? {} : { name: block.name }),
          argumentsDelta: fragment,
        };
      }
      if (choice.finish_reason) pendingFinish = finishReason(choice.finish_reason);
    }
    if (chunk.usage) {
      const cached = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
      pendingUsage = {
        inputTokens: Math.max(0, chunk.usage.prompt_tokens - cached),
        outputTokens: chunk.usage.completion_tokens,
        ...(cached ? { cacheReadTokens: cached } : {}),
        ...(chunk.usage.completion_tokens_details?.reasoning_tokens === undefined
          ? {}
          : { reasoningTokens: chunk.usage.completion_tokens_details.reasoning_tokens }),
      };
    }
  }
}

function closeBlock(block: OpenBlock): ContentBlock {
  if (block.kind === 'text') return { type: 'text', text: block.text };
  if (block.kind === 'reasoning') return { type: 'reasoning', text: block.text };
  return {
    type: 'tool-call',
    id: CallId(block.callId ?? ''),
    name: block.name ?? '',
    arguments: block.text,
  };
}

function finishReason(reason: string): FinishReason {
  if (reason === 'stop') return { kind: 'stop' };
  if (reason === 'tool_calls') return { kind: 'tool-calls' };
  if (reason === 'length') return { kind: 'max-tokens' };
  return {
    kind: 'error',
    failure: { message: `GLM stopped: ${reason}`, code: reason.toUpperCase() },
  };
}
