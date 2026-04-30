import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import { ConversationManager } from '../../../../../conversation/manager.js';
import { ChatHandler } from '../../../../../conversation/chat-handler.js';
import type { ResolvedConfig } from '../../../../../config/schema.js';
import apiChatRoutes from '../index.js';
import errorHandler from '../../../../03-error-handler.plugin.js';
import swaggerPlugin from '../../../../02-swagger.plugin.js';

const { mockConfig, mockGetConfig, mockRegistry } = vi.hoisted(() => {
  const config = {

    version: '1.0',
    providers: {
      kimi: {
        apiKey: 'test-key',
        baseUrl: 'https://api.moonshot.cn/v1',
        models: {},
        enabled: true,
      },
      openai: {
        apiKey: 'test-key',
        baseUrl: 'https://api.openai.com/v1',
        models: {},
        enabled: true,
      },
    },
    mcp: { enabled: false, servers: {} },
    defaults: {
      mode: 'separation',
      vision: { provider: 'kimi', model: 'moonshot-v1-vision-preview' },
      decision: { provider: 'kimi', model: 'moonshot-v1-vision-preview' },
    },
    settings: {
      timeout: 30000,
      maxRetries: 3,
      temperature: 0.4,
      maxTokens: 2000,
      maxSteps: 10,
    },
  } as unknown as ResolvedConfig;

  const registry = {
    isAvailable: vi.fn((key: string) => key === 'kimi' || key === 'openai'),
    listProviders: vi.fn(() => ['kimi', 'openai']),
    getAvailabilityError: vi.fn((key: string) => undefined as string | undefined),
  };

  return {
    mockConfig: config,
    mockGetConfig: vi.fn().mockReturnValue(config),
    mockRegistry: registry,
  };
});

vi.mock('../../../../../services/index.js', () => ({
  AppService: {
    getInstance: vi.fn().mockReturnValue({
      getConfig: mockGetConfig,
      getRegistry: vi.fn().mockReturnValue(mockRegistry),
    }),
  },
}));

describe('PATCH /api/chat/sessions/:id/models', () => {
  let app: ReturnType<typeof Fastify>;
  let manager: ConversationManager;
  let chatHandler: ChatHandler;

  beforeEach(async () => {
    app = Fastify();
    manager = new ConversationManager(':memory:');
    manager.initialize();

    chatHandler = new ChatHandler(manager, mockConfig);

    app.register(swaggerPlugin);
    app.register(errorHandler);
    app.decorate('conversationManager', manager);
    app.decorate('chatHandler', chatHandler);

    await app.register(apiChatRoutes, { prefix: '/api/chat' });
  });

  afterEach(async () => {
    await manager.close();
    await app.close();
    vi.restoreAllMocks();
  });

  /** Helper to create a session and return its id */
  function createSession(overrides?: { provider?: string; model?: string; vision_provider?: string; vision_model?: string }) {
    return manager.createSession({
      title: 'Test',
      provider: overrides?.provider ?? 'kimi',
      model: overrides?.model ?? 'moonshot-v1-vision-preview',
      vision_provider: overrides?.vision_provider,
      vision_model: overrides?.vision_model,
    });
  }

  it('updates decision model', async () => {
    const session = createSession();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/chat/sessions/${session.id}/models`,
      payload: { decision: { provider: 'openai', model: 'gpt-4o' } },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.session.provider).toBe('openai');
    expect(body.session.model).toBe('gpt-4o');
    // vision unchanged
    expect(body.session.vision_provider).toBeNull();
    expect(body.session.vision_model).toBeNull();
  });

  it('updates vision model', async () => {
    const session = createSession();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/chat/sessions/${session.id}/models`,
      payload: { vision: { provider: 'openai', model: 'gpt-4o-vision' } },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // decision unchanged
    expect(body.session.provider).toBe('kimi');
    expect(body.session.model).toBe('moonshot-v1-vision-preview');
    expect(body.session.vision_provider).toBe('openai');
    expect(body.session.vision_model).toBe('gpt-4o-vision');
  });

  it('updates both decision and vision models', async () => {
    const session = createSession();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/chat/sessions/${session.id}/models`,
      payload: {
        decision: { provider: 'openai', model: 'gpt-4o' },
        vision: { provider: 'openai', model: 'gpt-4o-vision' },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.session.provider).toBe('openai');
    expect(body.session.model).toBe('gpt-4o');
    expect(body.session.vision_provider).toBe('openai');
    expect(body.session.vision_model).toBe('gpt-4o-vision');
  });

  it('returns 400 when neither decision nor vision provided', async () => {
    const session = createSession();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/chat/sessions/${session.id}/models`,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('At least one');
  });

  it('returns 400 for unknown decision provider', async () => {
    const session = createSession();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/chat/sessions/${session.id}/models`,
      payload: { decision: { provider: 'unknown', model: 'x' } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Unknown decision provider');
  });

  it('returns 400 for unknown vision provider', async () => {
    const session = createSession();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/chat/sessions/${session.id}/models`,
      payload: { vision: { provider: 'nonexistent', model: 'x' } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Unknown vision provider');
  });

  it('returns 404 for non-existent session', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/chat/sessions/nonexistent-id/models',
      payload: { decision: { provider: 'kimi', model: 'moonshot-v1-vision-preview' } },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('not found');
  });

  it('returns 500 when registry is unavailable', async () => {
    // Override getRegistry for this test to return null
    const { AppService } = await import('../../../../../services/index.js');
    vi.mocked(AppService.getInstance).mockReturnValueOnce({
      getConfig: mockGetConfig,
      getRegistry: vi.fn().mockReturnValue(null),
    } as never);

    const session = createSession();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/chat/sessions/${session.id}/models`,
      payload: { decision: { provider: 'kimi', model: 'moonshot-v1-vision-preview' } },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toContain('registry');
  });

  it('returns 503 when provider exists but is unavailable', async () => {
    mockRegistry.isAvailable.mockImplementation((key: string) => key !== 'openai');
    mockRegistry.getAvailabilityError.mockImplementation((key: string) =>
      key === 'openai' ? 'Provider initialization failed: factory not found' : undefined
    );

    const session = createSession();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/chat/sessions/${session.id}/models`,
      payload: { decision: { provider: 'openai', model: 'gpt-4o' } },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toContain('unavailable');
    expect(res.json().error).toContain('openai');
  });

  it('returns 503 when vision provider exists but is unavailable', async () => {
    mockRegistry.isAvailable.mockImplementation((key: string) => key !== 'openai');
    mockRegistry.getAvailabilityError.mockImplementation((key: string) =>
      key === 'openai' ? 'Module load failed' : undefined
    );

    const session = createSession();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/chat/sessions/${session.id}/models`,
      payload: { vision: { provider: 'openai', model: 'gpt-4o-vision' } },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toContain('unavailable');
  });
});
