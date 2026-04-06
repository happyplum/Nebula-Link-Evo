import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
vi.mock('./plugins/routes/livekit-token.js', () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

const mockFastifyInstance = {
  register: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  log: {
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
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should load environment configuration', async () => {
    await import('../server.js');
    expect(dotenv.config).toHaveBeenCalled();
  });

  it('should create Fastify instance', async () => {
    await import('../server.js');
    expect(mockFastifyConstructor).toHaveBeenCalledWith({
      logger: {
        level: 'warn',
      },
    });
  });

  it('should register plugins and routes', async () => {
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

    expect(registerCalls).toHaveLength(11);
  });

  it('should start listening on port', async () => {
    await import('../server.js');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockFastifyInstance.listen).toHaveBeenCalledWith({ port: 3001, host: '0.0.0.0' });
  });

  it('should handle startup errors', async () => {
    mockFastifyInstance.listen.mockRejectedValueOnce(new Error('Startup failed'));

    await import('../server.js');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockFastifyInstance.log.error).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
