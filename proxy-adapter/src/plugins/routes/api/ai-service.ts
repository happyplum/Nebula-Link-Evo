import { generateText } from 'ai';
import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { AppService } from '../../../services/index.js';
import { ProviderError, parseProviderModel } from '../../../services/provider/errors.js';

interface GenerateBody {
  prompt: string;
  temperature?: number;
  maxTokens?: number;
}

interface DecisionSelector {
  provider: string;
  model: string;
}

function resolveDecisionSelector(decision: unknown): DecisionSelector {
  if (typeof decision === 'string') {
    return parseProviderModel(decision);
  }

  if (
    decision &&
    typeof decision === 'object' &&
    typeof (decision as { provider?: unknown }).provider === 'string' &&
    typeof (decision as { model?: unknown }).model === 'string'
  ) {
    return {
      provider: (decision as { provider: string }).provider,
      model: (decision as { model: string }).model,
    };
  }

  throw new Error('Decision provider is not configured');
}

function getTokenUsage(usage: unknown) {
  const usageRecord = usage && typeof usage === 'object' ? (usage as Record<string, unknown>) : {};

  return {
    promptTokens:
      typeof usageRecord.inputTokens === 'number'
        ? usageRecord.inputTokens
        : typeof usageRecord.promptTokens === 'number'
          ? usageRecord.promptTokens
          : 0,
    completionTokens:
      typeof usageRecord.outputTokens === 'number'
        ? usageRecord.outputTokens
        : typeof usageRecord.completionTokens === 'number'
          ? usageRecord.completionTokens
          : 0,
  };
}

const aiServiceRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
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
            properties: {
              error: { type: 'string' },
            },
          },
          503: {
            type: 'object',
            required: ['error'],
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const appService = AppService.getInstance();
      const config = appService.getConfig();
      const registry = appService.getRegistry();

      if (!config) {
        return reply.status(503).send({ error: 'AI configuration is unavailable' });
      }

      if (!registry) {
        return reply.status(503).send({ error: 'AI provider registry is unavailable' });
      }

      let provider: string;
      let model: string;
      try {
        ({ provider, model } = resolveDecisionSelector(config.defaults?.decision));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Decision provider is not configured';
        return reply.status(503).send({ error: message });
      }

      if (!config.providers?.[provider]?.enabled) {
        return reply.status(503).send({ error: `Decision provider '${provider}' is not enabled` });
      }

      if (!registry.isAvailable(provider)) {
        const detail = registry.getAvailabilityError(provider);
        return reply.status(503).send({
          error: detail
            ? `Decision provider '${provider}' is unavailable: ${detail}`
            : `Decision provider '${provider}' is unavailable`,
        });
      }

      try {
        const languageModel = await registry.resolve(provider, model);
        const result = await generateText({
          model: languageModel,
          prompt: request.body.prompt,
          temperature: request.body.temperature ?? config.settings.temperature,
          ...(request.body.maxTokens !== undefined ? { maxOutputTokens: request.body.maxTokens } : {}),
        });

        return reply.send({
          success: true,
          text: result.text,
          tokenUsage: getTokenUsage(result.usage),
          model: `${provider}/${model}`,
        });
      } catch (error) {
        if (error instanceof ProviderError) {
          const detail = error.details ?? error.message;
          return reply.status(503).send({
            error: `Decision provider '${provider}' is unavailable: ${String(detail)}`,
          });
        }

        const message = error instanceof Error ? error.message : 'Unknown text generation error';
        fastify.log.error({ err: error, provider, model }, 'AI text generation failed');
        return reply.status(502).send({
          error: `Text generation failed for '${provider}/${model}': ${message}`,
        });
      }
    }
  );
};

export default aiServiceRoutes;
