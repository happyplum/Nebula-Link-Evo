import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

// Mock all external dependencies BEFORE any other imports
vi.mock('dotenv');
vi.mock('fs');
vi.mock('@fastify/cors');
vi.mock('@fastify/websocket');
vi.mock('@fastify/static');
vi.mock('../services/index.js', () => ({
  taskService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    getConfig: vi.fn().mockReturnValue({
      provider: 'test',
      model: 'test-model',
    }),
    getConfigPath: vi.fn().mockReturnValue('/test/config.json'),
    getMCPSDKClient: vi.fn().mockReturnValue(undefined),
    getMCPStatus: vi.fn().mockReturnValue({
      enabled: true,
    }),
    getRegistry: vi.fn().mockReturnValue(null),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../browser-client.js', () => ({
  browserClient: {},
}));
vi.mock('../conversation/index.js', () => ({
  ConversationManager: vi.fn().mockImplementation(function() {
    return {
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      setAiClient: vi.fn(),
    };
  }),
  ChatHandler: vi.fn().mockImplementation(function() {
    return {};
  }),
}));
vi.mock('../conversation/db.js', () => ({
  DatabaseManager: {
    getInstance: vi.fn().mockReturnValue({
      getSessionEventsDAO: vi.fn().mockReturnValue({
        appendEvent: vi.fn().mockResolvedValue(undefined),
        getEventsAfter: vi.fn().mockResolvedValue([]),
        getEvents: vi.fn().mockResolvedValue([]),
        getLatestSeq: vi.fn().mockResolvedValue(0),
      }),
    }),
  },
}));
vi.mock('../services/session-event-hub.js', () => ({
  SessionEventHub: {
    getInstance: vi.fn().mockReturnValue({
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      publish: vi.fn(),
    }),
  },
}));
vi.mock('../services/chat-session-controller.js', () => ({
  ChatSessionController: {
    getInstance: vi.fn().mockReturnValue({
      initialize: vi.fn(),
    }),
  },
}));
vi.mock('../plugins/routes/health.js', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../plugins/routes/config.js', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../plugins/routes/task.js', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../plugins/routes/debug/index.js', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../plugins/routes/api/livekit-token.js', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../plugins/routes/api/chat/index.js', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../plugins/routes/chat/index.js', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../plugins/routes/ws/chat-socket.js', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../plugins/routes/ws/debug-socket.js', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../services/provider/preflight.js', () => ({
  runPreflight: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../utils/db-backup.js', () => ({
  initializeWithBackup: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../clients/compression.js', () => ({
  createCompressionClient: vi.fn().mockReturnValue(null),
}));

// Create mock instances BEFORE importing server
const mockFastifyInstance = {
  register: vi.fn().mockResolvedValue(undefined),
  decorate: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockReturnValue(undefined),
  all: vi.fn().mockReturnValue(undefined),
  listen: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
};

const mockFastifyConstructor = vi.fn().mockReturnValue(mockFastifyInstance);
vi.mock('fastify', () => ({ default: mockFastifyConstructor }));

vi.mocked(fs.existsSync).mockReturnValue(false);

beforeEach(() => {
  // Set up environment
  process.env.PROXY_PORT = '3000';
  process.env.NODE_ENV = 'test';
  process.env.TEST_MODE = 'true';

  // Clear all mocks and reset modules
  vi.clearAllMocks();
  vi.resetModules();

  // Re-mock everything after clearing
  vi.mocked(fs.existsSync).mockReturnValue(false);
  
  // Mock process.exit to prevent test runner from exiting
  vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
});

afterEach(() => {
  // Clean up after each test
  vi.clearAllMocks();
});

describe('server initialization', () => {
  it('should load environment configuration', async () => {
    // Import server module to trigger initialization
    await import('../server.js');
    expect(dotenv.config).toHaveBeenCalled();
  });

  it('should create Fastify instance', async () => {
    // Re-mock for this test
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    await import('../server.js');
    expect(mockFastifyConstructor).toHaveBeenCalledWith({
      disableRequestLogging: true,
      logger: {
        level: 'info',
      },
    });
  });

  it('should register CORS plugin', async () => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    await import('../server.js');
    expect(mockFastifyInstance.register).toHaveBeenCalled();
  });

  it('should register WebSocket plugin', async () => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    await import('../server.js');
    expect(mockFastifyInstance.register).toHaveBeenCalled();
  });

  it('should register routes', async () => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    await import('../server.js');
    await new Promise(resolve => setTimeout(resolve, 10));
    const registerCalls = mockFastifyInstance.register.mock.calls;
    const prefixes = registerCalls
      .filter((call) => call[1] && typeof call[1] === 'object' && 'prefix' in call[1])
      .map((call) => (call[1] as { prefix: string }).prefix);

    expect(prefixes).toContain('/api/health');
    expect(prefixes).toContain('/api/config');
    expect(prefixes).toContain('/debug');
  });

  it('should register root route', async () => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    await import('../server.js');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(mockFastifyInstance.get).toHaveBeenCalledWith(
      '/',
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('should initialize task service', async () => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    await import('../server.js');
    await new Promise(resolve => setTimeout(resolve, 10));
    
    if (mockFastifyInstance.log.error.mock.calls.length > 0) {
      console.error('Server start error:', mockFastifyInstance.log.error.mock.calls[0][0]);
    }
    
    const { taskService } = await import('../services/index.js');
    expect(taskService.initialize).toHaveBeenCalled();
  });

  it('should get config from task service', async () => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    await import('../server.js');
    await new Promise(resolve => setTimeout(resolve, 10));
    const { taskService } = await import('../services/index.js');
    expect(taskService.getConfig).toHaveBeenCalled();
  });

  it('should get MCP status from task service', async () => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    await import('../server.js');
    await new Promise(resolve => setTimeout(resolve, 10));
    const { taskService } = await import('../services/index.js');
    expect(taskService.getMCPStatus).toHaveBeenCalled();
  });

  it('should initialize conversation services', async () => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    await import('../server.js');
    await new Promise(resolve => setTimeout(resolve, 10));
    const { ConversationManager, ChatHandler } = await import('../conversation/index.js');
    expect(ConversationManager).toHaveBeenCalled();
    expect(ChatHandler).toHaveBeenCalled();
  });

  it('should skip compressor client when createCompressionClient returns null', async () => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await import('../server.js');
    await new Promise(resolve => setTimeout(resolve, 10));

    const { ConversationManager } = await import('../conversation/index.js');
    const conversationManagerInstance = vi.mocked(ConversationManager).mock.results[0]?.value as {
      setAiClient: ReturnType<typeof vi.fn>;
    };

    // createCompressionClient(null) returns null, so setAiClient is never called
    expect(conversationManagerInstance?.setAiClient).not.toHaveBeenCalled();
  });
});
