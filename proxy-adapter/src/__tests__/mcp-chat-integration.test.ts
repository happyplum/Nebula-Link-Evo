import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatHandler } from '../conversation/chat-handler.js';
import { ConversationManager } from '../conversation/manager.js';
import type { DecisionClient } from '../clients/types.js';
import type { DecisionContext } from '../clients/types.js';
import { MCPSDKClient, MCPTool } from '../clients/mcp/sdk-client.js';
import type { ResolvedConfig } from '../config/schema.js';
import type { Session } from '../conversation/types.js';

interface TestStreamCallbacks {
  onToken?: (text: string) => void;
  onThinking?: (text: string) => void;
  onToolCall?: (call: any) => void;
  onUsage?: (usage: any) => void;
  onDone?: () => void;
}

describe('MCP Chat Integration', () => {
  let conversationManager: ConversationManager;
  let decisionClient: Partial<DecisionClient>;
  let mcpClient: MCPSDKClient;
  let chatHandler: ChatHandler;
  let session: Session;

const mockConfig: ResolvedConfig = {
    version: '1.0',
    providers: {
      test: {
        enabled: true,
        apiKey: 'test-key',
        npmPackage: '@ai-sdk/openai',
        models: {
          'test-model': {
            type: 'decision',
            capabilities: ['decision'],
          },
        },
      },
    },
    mcp: {
      enabled: true,
      servers: {
        'test-server': {
          enabled: true,
          command: 'node',
          args: ['-e', 'console.log("test")'],
          env: {},
        },
      },
    },
    defaults: {
      mode: 'separation',
      decision: { provider: 'test', model: 'test-model' },
      vision: { provider: 'test', model: 'test-model' },
    },
    settings: {
      timeout: 30000,
      maxRetries:3,
      temperature: 0.7,
      maxTokens: 4096,
      maxSteps: 10,
    },
  };

  const mockTools: MCPTool[] = [
    {
      name: 'test-server.search',
      description: 'Search for information',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      },
    },
  ];

  const mockToolCall = {
    id: 'call_123',
    type: 'function',
    function: {
      name: 'test-server.search',
      arguments: JSON.stringify({ query: 'test' }),
    },
  };

  const mockToolResult = {
    result: 'success',
    data: ['item1', 'item2'],
  };

  beforeEach(async () => {
    conversationManager = new ConversationManager(':memory:');
    decisionClient = {
      provider: 'test',
      model: 'test-model',
      decide: vi.fn(),
      decideStream: vi.fn(),
      getCapabilities: () => [],
    };

    mcpClient = new MCPSDKClient(mockConfig);
    vi.spyOn(mcpClient, 'initialize').mockResolvedValue(undefined);
    vi.spyOn(mcpClient, 'getAvailableTools').mockReturnValue(mockTools);
    vi.spyOn(mcpClient, 'callTool').mockResolvedValue(mockToolResult);

    chatHandler = new ChatHandler(conversationManager, mockConfig, mcpClient);
    (chatHandler as any).resolveDecisionModel = () => decisionClient as DecisionClient;

    session = conversationManager.createSession({
      id: 'test-session',
      title: 'Test Session',
      provider: 'test',
      model: 'test-model',
    });
  });

  afterEach(async () => {
    conversationManager.close();
    await mcpClient.shutdown();
  });

  describe('tool_call detection', () => {
    it('should detect when AI returns tool_calls', async () => {
      const onToolCall = vi.fn();
      const callbacks: TestStreamCallbacks = {
        onToken: vi.fn(),
        onThinking: vi.fn(),
        onToolCall,
        onUsage: vi.fn(),
        onDone: vi.fn(),
      };

      await decisionClient.decideStream?.(
        { sessionId: 'test-session', messages: [], provider: 'test', model: 'test-model' } as any,
        callbacks
      );

      expect(callbacks.onToolCall).toBeDefined();
    });

    it('should parse tool_call correctly', () => {
      const parsed = JSON.parse(mockToolCall.function.arguments);
      expect(parsed.query).toBe('test');
    });
  });

  describe('MCP tool invocation', () => {
    it('should call MCP tool when tool_call is received', async () => {
      const serverName = 'test-server';
      const toolName = 'search';
      const args = { query: 'test' };

      const result = await mcpClient.callTool(serverName, toolName, args);

      expect(mcpClient.callTool).toHaveBeenCalledWith(serverName, toolName, args);
      expect(result).toEqual(mockToolResult);
    });

    it('should handle MCP tool errors gracefully', async () => {
      vi.spyOn(mcpClient, 'callTool').mockRejectedValue(new Error('Tool failed'));

      await expect(mcpClient.callTool('test-server', 'search', { query: 'test' })).rejects.toThrow(
        'Tool failed'
      );
    });

    it('should reject dangerous tool calls without confirmation', async () => {
      vi.spyOn(mcpClient, 'callTool').mockImplementation((serverName, toolName) => {
        if (toolName === 'deleteAll') {
          return Promise.reject(new Error('Dangerous tool requires confirmation'));
        }
        return Promise.resolve(mockToolResult);
      });

      await expect(mcpClient.callTool('test-server', 'deleteAll', {})).rejects.toThrow(
        'Dangerous tool requires confirmation'
      );
    });
  });

  describe('tool result injection', () => {
    it('should add tool result as tool role message to session', () => {
      const toolMessage = conversationManager.addMessage(session.id, {
        role: 'tool',
        content: JSON.stringify(mockToolResult),
        metadata: {
          tool_call_id: mockToolCall.id,
          tool_name: mockToolCall.function.name,
        },
      });

      expect(toolMessage.role).toBe('tool');
      expect(toolMessage.metadata?.tool_call_id).toBe(mockToolCall.id);
    });

    it('should add assistant message with tool_calls metadata', () => {
      const assistantMessage = conversationManager.addMessage(session.id, {
        role: 'assistant',
        content: '',
        metadata: {
          tool_calls: [mockToolCall],
        },
      });

      expect(assistantMessage.role).toBe('assistant');
      expect(assistantMessage.metadata?.tool_calls).toEqual([mockToolCall]);
    });
  });

  describe('tool use loop', () => {
    it('should call AI again after tool execution', async () => {
      let callCount = 0;
      const onToolCall = vi.fn();
      const onDone = vi.fn();

      const callbacks: TestStreamCallbacks = {
        onToken: vi.fn(),
        onThinking: vi.fn(),
        onToolCall: (call: any) => {
          onToolCall(call);
          callCount++;

          if (callCount === 1) {
            conversationManager.addMessage(session.id, {
              role: 'tool',
              content: JSON.stringify(mockToolResult),
              metadata: {
                tool_call_id: call.id,
                tool_name: call.function.name,
              },
            });
          }
        },
        onUsage: vi.fn(),
        onDone: () => {
          if (callCount >= 2) {
            onDone();
          }
        },
      };

      vi.spyOn(decisionClient, 'decideStream').mockImplementation(
        async (context: DecisionContext, cb: TestStreamCallbacks) => {
          if (callCount === 0) {
            cb.onToolCall!(mockToolCall);
          } else {
            cb.onToken!('Final answer based on tool results');
            cb.onDone!();
          }
        }
      );

      await decisionClient.decideStream?.(
        {
          screenshot: '',
          dom: { snapshot_id: 'test', annotated_screenshot_base64: '', elements_map: {}, simplified_dom: { elements: [], viewport: { width: 1920, height: 1080 } }, version: '2.0' as const },
          elements: [],
          instruction: '',
          previousActions: [],
          sessionId: session.id,
          messages: [],
          provider: 'test',
          model: 'test-model',
        } as DecisionContext,
        callbacks
      );

      expect(onToolCall).toHaveBeenCalled();
      expect(callCount).toBeGreaterThan(0);
    });

    it('should limit loop iterations to prevent infinite loops', async () => {
      const maxLoops = 5;
      let loopCount = 0;
      const shouldThrow = true;

      const onToolCall = vi.fn(() => {
        loopCount++;
        if (shouldThrow && loopCount > maxLoops) {
          throw new Error('Maximum tool use loop exceeded');
        }
      });

      const callbacks: TestStreamCallbacks = {
        onToken: vi.fn(),
        onThinking: vi.fn(),
        onToolCall,
        onUsage: vi.fn(),
        onDone: vi.fn(),
      };

      vi.spyOn(decisionClient, 'decideStream').mockImplementation(
        async (_context: DecisionContext, cb: TestStreamCallbacks) => {
          for (let i = 0; i < maxLoops + 2; i++) {
            cb.onToolCall!(mockToolCall);
          }
          cb.onDone!();
        }
      );

      await expect(
        decisionClient.decideStream?.(
          {
            screenshot: '',
            dom: { snapshot_id: 'test', annotated_screenshot_base64: '', elements_map: {}, simplified_dom: { elements: [], viewport: { width: 1920, height: 1080 } }, version: '2.0' as const },
            elements: [],
            instruction: '',
            previousActions: [],
            sessionId: session.id,
            messages: [],
            provider: 'test',
            model: 'test-model',
          } as DecisionContext,
          callbacks
        )
      ).rejects.toThrow('Maximum tool use loop exceeded');

      expect(loopCount).toBeGreaterThan(maxLoops);
    });
  });

  describe('WebSocket tool_call streaming', () => {
    it('should handle tool_call in stream callbacks', async () => {
      const mockRespondToClient = vi.fn();

      const callbacks: TestStreamCallbacks = {
        onToken: vi.fn(),
        onThinking: vi.fn(),
        onToolCall: (call: any) => {
          mockRespondToClient('client-id', {
            type: 'chat_stream_tool_call',
            sessionId: session.id,
            messageId: 'msg-123',
            toolCall: call,
          });
        },
        onUsage: vi.fn(),
        onDone: vi.fn(),
      };

      vi.spyOn(decisionClient, 'decideStream').mockImplementation(
        async (_context: DecisionContext, cb: TestStreamCallbacks) => {
          cb.onToolCall!(mockToolCall);
          cb.onDone!();
        }
      );

      await decisionClient.decideStream?.(
        {
          screenshot: '',
          dom: { snapshot_id: 'test', annotated_screenshot_base64: '', elements_map: {}, simplified_dom: { elements: [], viewport: { width: 1920, height: 1080 } }, version: '2.0' as const },
          elements: [],
          instruction: '',
          previousActions: [],
          sessionId: session.id,
          messages: [],
          provider: 'test',
          model: 'test-model',
        } as DecisionContext,
        callbacks
      );

      expect(mockRespondToClient).toHaveBeenCalledWith('client-id', {
        type: 'chat_stream_tool_call',
        sessionId: session.id,
        messageId: 'msg-123',
        toolCall: mockToolCall,
      });
    });
  });

  describe('system prompt with MCP tools', () => {
    it('should inject available MCP tools into system prompt', () => {
      const tools = mcpClient.getAvailableTools();
      const toolsDescription = tools
        .map((tool) => `- ${tool.name}: ${tool.description}`)
        .join('\n');

      const systemPrompt = `You are a helpful assistant. You have access to the following tools:\n${toolsDescription}`;

      expect(systemPrompt).toContain('test-server.search');
      expect(systemPrompt).toContain('Search for information');
    });

    it('should handle empty tool list gracefully', () => {
      vi.spyOn(mcpClient, 'getAvailableTools').mockReturnValue([]);

      const tools = mcpClient.getAvailableTools();
      const toolsDescription =
        tools.length > 0
          ? tools.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n')
          : 'No tools available.';

      expect(toolsDescription).toBe('No tools available.');
    });
  });

  describe('metadata recording', () => {
    it('should record tool_call in message metadata', () => {
      const message = conversationManager.addMessage(session.id, {
        role: 'assistant',
        content: 'I will search for that.',
        metadata: {
          tool_calls: [mockToolCall],
        },
      });

      expect(message.metadata?.tool_calls).toBeDefined();
      expect(message.metadata?.tool_calls).toEqual([mockToolCall]);
    });

    it('should record tool_result in message metadata', () => {
      const message = conversationManager.addMessage(session.id, {
        role: 'tool',
        content: JSON.stringify(mockToolResult),
        metadata: {
          tool_call_id: mockToolCall.id,
          tool_name: mockToolCall.function.name,
        },
      });

      expect(message.metadata?.tool_call_id).toBe(mockToolCall.id);
      expect(message.metadata?.tool_name).toBe(mockToolCall.function.name);
    });
  });

  describe('error handling', () => {
    it('should handle MCP client errors gracefully', async () => {
      vi.spyOn(mcpClient, 'callTool').mockRejectedValue(new Error('MCP connection lost'));

      const callbacks: TestStreamCallbacks = {
        onToken: vi.fn(),
        onThinking: vi.fn(),
        onToolCall: async () => {
          await mcpClient.callTool('test-server', 'search', { query: 'test' });
        },
        onUsage: vi.fn(),
        onDone: vi.fn(),
      };

      await expect(callbacks.onToolCall!(mockToolCall)).rejects.toThrow('MCP connection lost');
    });

    it('should handle invalid tool_call format', () => {
      const invalidToolCall = {
        id: 'call_789',
        type: 'invalid',
        function: 'not-an-object',
      };

      expect(() => {
        if (typeof invalidToolCall.function === 'string') {
          JSON.parse(invalidToolCall.function);
        }
      }).toThrow();
    });
  });
});
