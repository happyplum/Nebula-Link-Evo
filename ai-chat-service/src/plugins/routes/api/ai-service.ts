import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { FinishReason, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { HarnessModelRoute, HarnessRuntime } from '../../../harness/index.js';

interface GenerateBody {
  prompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AiServiceRouteOptions {
  harness: HarnessRuntime;
  decision: HarnessModelRoute;
  timeoutMs: number;
}

const aiServiceRoutes: FastifyPluginAsyncTypebox<AiServiceRouteOptions> = async (
  fastify,
  routeOptions
) => {
  fastify.post<{ Body: GenerateBody }>(
    '/generate',
    {
      schema: {
        description: 'Generate plain text with the configured decision model',
        tags: ['AI'],
        body: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string', minLength: 1 },
            temperature: { type: 'number', minimum: 0, maximum: 2 },
            maxTokens: { type: 'integer', minimum: 1 },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['success', 'text', 'tokenUsage'],
            properties: {
              success: { type: 'boolean' },
              text: { type: 'string' },
              tokenUsage: {
                type: 'object',
                required: ['promptTokens', 'completionTokens'],
                properties: {
                  promptTokens: { type: 'number' },
                  completionTokens: { type: 'number' },
                },
              },
              model: { type: 'string' },
            },
          },
          502: {
            type: 'object',
            required: ['error'],
            properties: { error: { type: 'string' } },
          },
          503: {
            type: 'object',
            required: ['error'],
            properties: { error: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const route = routeOptions.decision;
      try {
        let text = '';
        let usage: TokenUsage | undefined;
        let finish: FinishReason | undefined;
        const chunks = routeOptions.harness.stream({
          provider: route.provider,
          model: route.model,
          messages: [
            createUserMessage({
              content: [{ type: 'text', text: request.body.prompt }],
              source: { kind: 'user' },
            }),
          ],
          temperature: request.body.temperature ?? route.temperature,
          maxTokens: request.body.maxTokens ?? route.maxTokens,
          signal: AbortSignal.timeout(routeOptions.timeoutMs),
        });
        for await (const chunk of chunks) {
          ({ text, usage, finish } = collectChunk(chunk, text, usage, finish));
        }
        if (!finish || finish.kind === 'error' || finish.kind === 'aborted') {
          const detail =
            finish?.kind === 'error' || finish?.kind === 'aborted'
              ? `${finish.failure.code}: ${finish.failure.message}`
              : 'model stream ended without a finish event';
          return reply.status(502).send({ error: `Text generation failed: ${detail}` });
        }
        return reply.send({
          success: true,
          text,
          tokenUsage: {
            promptTokens:
              (usage?.inputTokens ?? 0) +
              (usage?.cacheReadTokens ?? 0) +
              (usage?.cacheWriteTokens ?? 0),
            completionTokens: usage?.outputTokens ?? 0,
          },
          model: `${route.provider}/${route.model}`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown text generation error';
        const unavailable = /NO_ADAPTER|MISSING_CREDENTIAL|AUTH|credential|adapter/iu.test(message);
        fastify.log.error(
          { err: error, provider: route.provider, model: route.model },
          'Harness text generation failed'
        );
        return reply.status(unavailable ? 503 : 502).send({
          error: `Text generation failed for '${route.provider}/${route.model}': ${message}`,
        });
      }
    }
  );
};

function collectChunk(
  chunk: StreamChunk,
  text: string,
  usage: TokenUsage | undefined,
  finish: FinishReason | undefined
): { text: string; usage: TokenUsage | undefined; finish: FinishReason | undefined } {
  if (chunk.type === 'text-delta') return { text: text + chunk.text, usage, finish };
  if (chunk.type === 'usage') return { text, usage: chunk.usage, finish };
  if (chunk.type === 'finish') return { text, usage, finish: chunk.reason };
  return { text, usage, finish };
}

export default aiServiceRoutes;
