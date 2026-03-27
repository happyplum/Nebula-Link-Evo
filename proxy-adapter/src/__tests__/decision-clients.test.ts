import { describe, it, expect } from 'vitest';
import { KimiDecisionClient, KimiDecisionConfig } from '../clients/decision/kimi.js';
import { NVIDIADecisionClient, NVIDIADecisionConfig } from '../clients/decision/nvidia.js';
import { GLMDecisionClient, GLMDecisionConfig } from '../clients/decision/glm.js';
import { DOMSnapshotResponse, UIElement, ActionResult } from '../config/schema.js';

describe('BaseDecisionClient', () => {
  const baseConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com/v1',
    model: 'test-model',
  };

  describe('client construction', () => {
    it('should create KimiDecisionClient with BaseDecisionClient', () => {
      const config: KimiDecisionConfig = {
        ...baseConfig,
        temperature: 0.2,
        maxTokens: 1000,
      };
      const client = new KimiDecisionClient(config);

      expect(client.provider).toBe('kimi');
      expect(client.model).toBe('test-model');
      expect(client.getCapabilities()).toEqual(['decision']);
    });

    it('should create NVIDIADecisionClient with BaseDecisionClient', () => {
      const config: NVIDIADecisionConfig = {
        ...baseConfig,
        temperature: 0.2,
        maxTokens: 2000,
      };
      const client = new NVIDIADecisionClient(config);

      expect(client.provider).toBe('nvidia');
      expect(client.model).toBe('test-model');
      expect(client.getCapabilities()).toEqual(['decision']);
    });

    it('should create GLMDecisionClient with BaseDecisionClient', () => {
      const config: GLMDecisionConfig = {
        ...baseConfig,
        temperature: 0.2,
        maxTokens: 1000,
      };
      const client = new GLMDecisionClient(config);

      expect(client.provider).toBe('glm');
      expect(client.model).toBe('test-model');
      expect(client.getCapabilities()).toEqual(['decision']);
    });
  });

  describe('getSystemPrompt', () => {
    it('should generate system prompt without MCP tools', () => {
      const client = new KimiDecisionClient(baseConfig);

      const prompt = (client as any).getSystemPrompt();

      expect(prompt).toContain('网页自动化助手');
      expect(prompt).toContain('click');
      expect(prompt).toContain('type');
      expect(prompt).toContain('scroll');
      expect(prompt).toContain('wait');
      expect(prompt).toContain('navigate');
      expect(prompt).toContain('finish');
    });

    it('should generate system prompt with MCP tools', () => {
      const client = new KimiDecisionClient(baseConfig);
      const mcpTools = [
        {
          name: 'browser_click',
          description: 'Click on element',
          inputSchema: {
            type: 'object',
            properties: {
              element: { type: 'string', description: 'Element selector' },
            },
            required: ['element'],
          },
        },
      ];

      const prompt = (client as any).getSystemPrompt(mcpTools);

      expect(prompt).toContain('mcp_call');
      expect(prompt).toContain('browser_click');
      expect(prompt).toContain('Click on element');
    });
  });

  describe('getRequestBody', () => {
    it('should downgrade multimodal content for non-vision model and merge system', () => {
      const client = new GLMDecisionClient({
        ...baseConfig,
        model: 'glm-4.7-flashx',
        capabilities: ['decision'],
      });
      const requestBody = client.getRequestBody([
        { role: 'system', content: '系统规则A' },
        {
          role: 'user',
          content: [
            { type: 'text', text: '用户问题' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
          ],
        },
      ]);

      expect(requestBody.messages).toEqual([
        {
          role: 'user',
          content: '[System Instructions]\n系统规则A\n\n[User Query]\n用户问题',
        },
      ]);
    });

    it('should keep multimodal content for vision-capable model', () => {
      const client = new GLMDecisionClient({
        ...baseConfig,
        model: 'glm-4.7-flashx',
        capabilities: ['decision', 'vision'],
      });
      const sourceMessages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: '分析截图' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
          ],
        },
      ];
      const requestBody = client.getRequestBody(sourceMessages);

      expect(requestBody.messages).toEqual(sourceMessages);
    });

    it('should inject system instructions when no user message exists after downgrade', () => {
      const client = new GLMDecisionClient({
        ...baseConfig,
        model: 'glm-4.7-flashx',
        capabilities: ['decision'],
      });
      const requestBody = client.getRequestBody([
        { role: 'system', content: '系统规则A' },
        { role: 'assistant', content: '历史回复' },
      ]);

      expect(requestBody.messages).toEqual([
        { role: 'user', content: '[System Instructions]\n系统规则A' },
        { role: 'assistant', content: '历史回复' },
      ]);
    });
  });

  describe('buildPrompt', () => {
    const mockDom: DOMSnapshotResponse = {
      snapshot_id: 'snapshot-test',
      annotated_screenshot_base64: 'base64-placeholder',
      elements_map: {
        '1': {
          id: '1',
          tag: 'button',
          text: 'Submit',
          bbox: { x: 100, y: 200, width: 120, height: 40 },
          locator_bundle: { role: 'button', text: 'Submit' },
        },
      },
      simplified_dom: {
        elements: [{ tag: 'button', id: '1', text: 'Submit' }],
        viewport: { width: 1920, height: 1080 },
      },
      version: '2.0',
    };

    const mockElements: UIElement[] = [
      {
        id: 0,
        type: 'button',
        bbox: [100, 200, 300, 50],
        center: [250, 225],
        confidence: 0.95,
      },
    ];

    const mockPreviousActions: ActionResult[] = [
      {
        action: { type: 'click', params: { x: 100, y: 200 }, reasoning: 'Test' },
        success: true,
        message: 'Clicked',
      },
    ];

    it('should build prompt without MCP tools', () => {
      const client = new KimiDecisionClient(baseConfig);

      const prompt = (client as any).buildPrompt(
        mockDom,
        mockElements,
        'Click the button',
        mockPreviousActions
      );

      expect(prompt).toContain('Click the button');
      expect(prompt).toContain('snapshot-test');
      expect(prompt).toContain('2.0');
      expect(prompt).toContain('button');
      expect(prompt).toContain('click');
      expect(prompt).not.toContain('MCP工具');
    });

    it('should build prompt with MCP tools', () => {
      const client = new KimiDecisionClient(baseConfig);
      const mcpTools = [
        {
          name: 'browser_click',
          description: 'Click on element',
          inputSchema: {
            type: 'object',
            properties: {
              element: { type: 'string', description: 'Element selector' },
            },
            required: ['element'],
          },
        },
      ];

      const prompt = (client as any).buildPrompt(
        mockDom,
        mockElements,
        'Click the button',
        mockPreviousActions,
        mcpTools
      );

      expect(prompt).toContain('MCP工具');
      expect(prompt).toContain('browser_click');
    });

    it('should handle empty previous actions', () => {
      const client = new KimiDecisionClient(baseConfig);

      const prompt = (client as any).buildPrompt(mockDom, mockElements, 'Click the button', []);

      expect(prompt).toContain('Click the button');
      expect(prompt).not.toContain('已执行的操作');
    });


    it('should handle elements_map record format safely', () => {
      const client = new KimiDecisionClient(baseConfig);
      const recordDom = {
        snapshot_id: 'snapshot-record',
        version: '2.0.0',
        elements_map: {
          '1': {
            tag: 'input',
            text: 'Email',
            bbox: { x: 15, y: 25, width: 150, height: 30 },
          },
        },
      };

      const prompt = (client as any).buildPrompt(recordDom, mockElements, 'Type email', []);

      expect(prompt).toContain('snapshot-record');
      expect(prompt).toContain('[input] Email');
    });
  });

  describe('parseAction', () => {
    it('should parse valid JSON action', () => {
      const client = new KimiDecisionClient(baseConfig);
      const content = '{"type":"click","params":{"x":100,"y":200},"reasoning":"Test click"}';

      const action = (client as any).parseAction(content);

      expect(action.type).toBe('click');
      expect(action.params).toEqual({ x: 100, y: 200 });
      expect(action.reasoning).toBe('Test click');
    });

    it('should return wait action for invalid JSON', () => {
      const client = new KimiDecisionClient(baseConfig);
      const content = 'not valid json';

      const action = (client as any).parseAction(content);

      expect(action.type).toBe('wait');
      expect(action.params).toEqual({});
    });

    it('should extract JSON from mixed content', () => {
      const client = new KimiDecisionClient(baseConfig);
      const content = 'Some text {"type":"click","params":{"x":100,"y":200}} more text';

      const action = (client as any).parseAction(content);

      expect(action.type).toBe('click');
      expect(action.params).toEqual({ x: 100, y: 200 });
    });

    it('should handle action with missing type', () => {
      const client = new KimiDecisionClient(baseConfig);
      const content = '{"params":{"x":100,"y":200}}';

      const action = (client as any).parseAction(content);

      expect(action.type).toBe('wait');
      expect(action.params).toEqual({ x: 100, y: 200 });
    });

    it('should handle action with missing params', () => {
      const client = new KimiDecisionClient(baseConfig);
      const content = '{"type":"click"}';

      const action = (client as any).parseAction(content);

      expect(action.type).toBe('click');
      expect(action.params).toEqual({});
    });

    it('should parse target_id format into resolved_target', () => {
      const client = new GLMDecisionClient(baseConfig);
      const content = '{"action":"click","target":{"target_id":12,"snapshot_id":"snapshot-1"}}';

      const action = (client as any).parseAction(content);

      expect(action.type).toBe('click');
      expect(action.params.target).toEqual({ target_id: 12, snapshot_id: 'snapshot-1' });
      expect(action.params.target_id).toBe(12);
      expect(action.params.snapshot_id).toBe('snapshot-1');
      expect(action.params.resolved_target).toEqual({
        format: 'target_id',
        target_id: 12,
        snapshot_id: 'snapshot-1',
      });
    });

    it('should parse selector format into resolved_target', () => {
      const client = new GLMDecisionClient(baseConfig);
      const content = '{"action":"click","target":{"selector":"#submit"}}';

      const action = (client as any).parseAction(content);

      expect(action.type).toBe('click');
      expect(action.params.target).toEqual({ selector: '#submit' });
      expect(action.params.selector).toBe('#submit');
      expect(action.params.resolved_target).toEqual({
        format: 'selector',
        selector: '#submit',
      });
    });

  });
});
