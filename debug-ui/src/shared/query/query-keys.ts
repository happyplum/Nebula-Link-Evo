/**
 * Centralized TanStack Query key factory.
 * Each domain has its own namespace with factory functions for parameterized keys.
 */

export const queryKeys = {
  config: ['config'] as const,
  health: ['health'] as const,

  tasks: {
    all: ['tasks'] as const,
    list: (limit?: number) => ['tasks', 'list', limit] as const,
    detail: (id: string) => ['tasks', 'detail', id] as const,
  },

  sessions: {
    all: ['sessions'] as const,
    detail: (id: string) => ['sessions', 'detail', id] as const,
    messages: (id: string) => ['sessions', 'messages', id] as const,
    status: (id: string) => ['sessions', 'status', id] as const,
  },

  playwright: {
    status: ['playwright', 'status'] as const,
  },

  mcp: {
    status: ['mcp', 'status'] as const,
    tools: ['mcp', 'tools'] as const,
  },

  interactions: {
    list: (params?: Record<string, string>) => ['interactions', params] as const,
    stats: ['interactions', 'stats'] as const,
  },
} as const;
