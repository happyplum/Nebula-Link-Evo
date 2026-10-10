import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRegistry } from '../tools/registry.js';
import type { GatewayTool, ToolProvider, ToolProviderStatus } from '../tools/types.js';

function makeTool(overrides: Partial<GatewayTool> & { id: string; name: string }): GatewayTool {
  return {
    description: `${overrides.name} description`,
    inputSchema: { type: 'object', properties: {} },
    providerId: 'test',
    isAvailable: true,
    execute: vi.fn(async () => 'ok'),
    ...overrides,
  };
}

function makeProvider(overrides: {
  id: string;
  tools?: GatewayTool[];
  init?: () => Promise<void>;
}): ToolProvider & { on: typeof EventEmitter_on } {
  const tools = overrides.tools ?? [];
  const status: { value: ToolProviderStatus } = { value: 'initializing' };
  const listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map();

  return {
    id: overrides.id,
    get status() {
      return status.value;
    },
    set status(v: ToolProviderStatus) {
      status.value = v;
    },
    getTools: vi.fn(() => tools),
    initialize: vi.fn(async () => {
      if (overrides.init) {
        await overrides.init();
      }
      status.value = 'ready';
      // notify listeners
      listeners.get('status-changed')?.forEach((fn) => fn(status.value));
    }),
    shutdown: vi.fn(async () => {
      status.value = 'disabled';
    }),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      let handlers = listeners.get(event);
      if (!handlers) {
        handlers = new Set();
        listeners.set(event, handlers);
      }
      handlers.add(handler);
    }),
    removeListener: vi.fn(),
  };
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('registerProvider', () => {
    it('should register a provider and return its tools via getAvailableTools', () => {
      const tool = makeTool({ id: 't1', name: 'test.tool' });
      const provider = makeProvider({ id: 'p1', tools: [tool] });

      registry.registerProvider(provider);

      const tools = registry.getAvailableTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('test.tool');
    });

    it('should throw on duplicate provider id', () => {
      const provider = makeProvider({ id: 'dup' });
      registry.registerProvider(provider);

      expect(() => registry.registerProvider(makeProvider({ id: 'dup' }))).toThrow(
        'Provider "dup" already registered'
      );
    });
  });

  describe('getAvailableTools', () => {
    it('should skip unavailable tools', () => {
      const tool = makeTool({ id: 't1', name: 'unavailable', isAvailable: false });
      registry.registerProvider(makeProvider({ id: 'p1', tools: [tool] }));

      expect(registry.getAvailableTools()).toHaveLength(0);
    });

    it('should return every available controlled MCP tool', () => {
      const t1 = makeTool({ id: 't1', name: 'a' });
      const t2 = makeTool({ id: 't2', name: 'b' });
      registry.registerProvider(makeProvider({ id: 'p1', tools: [t1, t2] }));

      expect(registry.getAvailableTools()).toHaveLength(2);
    });
  });

  describe('unregisterProvider', () => {
    it('should remove provider and its tools', () => {
      const tool = makeTool({ id: 't1', name: 'x' });
      const provider = makeProvider({ id: 'p1', tools: [tool] });
      registry.registerProvider(provider);

      registry.unregisterProvider('p1');

      expect(registry.getAvailableTools()).toHaveLength(0);
      expect(registry.getProvider('p1')).toBeUndefined();
    });

    it('should be a no-op for unknown id', () => {
      expect(() => registry.unregisterProvider('nonexistent')).not.toThrow();
    });
  });

  describe('initializeAll', () => {
    it('should initialize all providers', async () => {
      const p1 = makeProvider({ id: 'p1' });
      const p2 = makeProvider({ id: 'p2' });
      registry.registerProvider(p1);
      registry.registerProvider(p2);

      await registry.initializeAll();

      expect(p1.initialize).toHaveBeenCalledOnce();
      expect(p2.initialize).toHaveBeenCalledOnce();
      expect(registry.getProviderStatus('p1')).toBe('ready');
      expect(registry.getProviderStatus('p2')).toBe('ready');
    });

    it('should mark failed providers as degraded', async () => {
      const good = makeProvider({ id: 'good' });
      const bad = makeProvider({
        id: 'bad',
        init: async () => {
          throw new Error('boom');
        },
      });
      registry.registerProvider(good);
      registry.registerProvider(bad);

      await registry.initializeAll();

      expect(registry.getProviderStatus('good')).toBe('ready');
      expect(registry.getProviderStatus('bad')).toBe('degraded');
    });
  });

  describe('shutdownAll', () => {
    it('should call shutdown on every provider', async () => {
      const p1 = makeProvider({ id: 'p1' });
      const p2 = makeProvider({ id: 'p2' });
      registry.registerProvider(p1);
      registry.registerProvider(p2);

      await registry.shutdownAll();

      expect(p1.shutdown).toHaveBeenCalledOnce();
      expect(p2.shutdown).toHaveBeenCalledOnce();
    });
  });

  describe('getAllTools', () => {
    it('should return tools without availability or consumer filtering', () => {
      const available = makeTool({ id: 't1', name: 'av', isAvailable: true });
      const unavailable = makeTool({ id: 't2', name: 'unav', isAvailable: false });
      registry.registerProvider(makeProvider({ id: 'p1', tools: [available, unavailable] }));

      const all = registry.getAllTools();
      expect(all).toHaveLength(2);
    });
  });
});
