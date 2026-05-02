import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dotenv from 'dotenv';

vi.mock('dotenv');
vi.mock('@fastify/cors');
vi.mock('@fastify/websocket');
vi.mock('./plugins/02-swagger.plugin.js', () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./plugins/routes/browser.js', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./plugins/routes/action.js', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./plugins/routes/dom.js', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./plugins/routes/health.js', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./plugins/routes/stream.js', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./plugins/routes/cdp.js', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./plugins/routes/debug-stream.js', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./plugins/routes/livekit-token.js', () => ({ default: vi.fn().mockResolvedValue(undefined) }));

const mockSetOnStateChange = vi.fn();
const mockGetDebugStatus = vi.fn().mockResolvedValue({
  isOpen: false,
  url: null,
  title: null,
  status: 'unknown',
});
const mockPublishStatus = vi.fn();

vi.mock('./services/browser-service.js', () => ({
  BrowserService: {
    getInstance: vi.fn().mockReturnValue({
      setOnStateChange: mockSetOnStateChange,
      getDebugStatus: mockGetDebugStatus,
    }),
  },
}));

vi.mock('./services/debug-event-hub.js', () => ({
  DebugEventHub: {
    getInstance: vi.fn().mockReturnValue({
      publishStatus: mockPublishStatus,
    }),
  },
}));

const mockFastifyInstance = {
  register: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  log: {
    info: vi.fn(),
    error: vi.fn(),
  },
};

const mockFastifyConstructor = vi.fn().mockReturnValue(mockFastifyInstance);
vi.mock('fastify', () => ({ default: mockFastifyConstructor }));

describe('Server Initialization', () => {
  beforeEach(() => {
    process.env.PLAYWRIGHT_PORT = '3001';
    vi.clearAllMocks();
    vi.resetModules();
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads environment configuration', async () => {
    await import('../server.js');
    expect(dotenv.config).toHaveBeenCalled();
  });

  it('creates the Fastify instance', async () => {
    await import('../server.js');
    expect(mockFastifyConstructor).toHaveBeenCalledWith({
      logger: {
        level: 'warn',
      },
    });
  });

  it('registers plugins and routes including the internal debug stream', async () => {
    await import('../server.js');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockFastifyInstance.register).toHaveBeenCalled();

    const registerCalls = mockFastifyInstance.register.mock.calls;
    const prefixes = registerCalls
      .filter((call) => call[1] && typeof call[1] === 'object' && 'prefix' in call[1])
      .map((call) => (call[1] as { prefix: string }).prefix);

    expect(prefixes).toContain('/browser');
    expect(prefixes).toContain('/action');
    expect(prefixes).toContain('/dom');
    expect(prefixes).toContain('/execute');
    expect(prefixes).toContain('/health');
    expect(prefixes).toContain('/internal/debug');
    expect(registerCalls).toHaveLength(12);
  });

  it('starts listening on the configured port', async () => {
    await import('../server.js');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockFastifyInstance.listen).toHaveBeenCalledWith({ port: 3001, host: '0.0.0.0' });
  });

  it('handles startup errors', async () => {
    mockFastifyInstance.listen.mockRejectedValueOnce(new Error('Startup failed'));

    await import('../server.js');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockFastifyInstance.log.error).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
