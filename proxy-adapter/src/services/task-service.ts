/**
 * TaskService - Facade for task execution
 *
 * Provides backward-compatible API for routes while delegating
 * execution logic to TaskOrchestrator, StepRunner, and ActionExecutor.
 * Manages configuration, MCP client, and connectivity testing.
 */

import { loadConfig, validateConfig } from '../config/index.js';
import { createClientFactory, ClientFactory } from '../clients/index.js';
import type { VisionClient, DecisionClient } from '../clients/types.js';
import { MCPSDKClient } from '../clients/mcp/sdk-client.js';
import type {
  TaskRequest,
  TaskResponse,
  ResolvedConfig,
} from '../config/schema.js';
import { DebugWebSocketManager } from '../websocket-manager.js';
import { ActionExecutor } from './action-executor.js';
import { StepRunner } from './step-runner.js';
import { TaskOrchestrator } from './task-orchestrator.js';
import { streamTask } from '../clients/vercel-ai/streaming.js';
import type { ModelMessage } from 'ai';

export class TaskService {
  private config: ResolvedConfig | null = null;
  private configPath: string = '';
  private clientFactory: ClientFactory | null = null;
  private mcpClient: MCPSDKClient | null = null;
  private wsManager: DebugWebSocketManager;
  private actionExecutor: ActionExecutor;
  private stepRunner: StepRunner | null = null;
  private taskOrchestrator: TaskOrchestrator | null = null;

  constructor() {
    this.wsManager = DebugWebSocketManager.getInstance();
    this.wsManager.setMCPStatusProvider(() => this.getMCPStatus());
    this.actionExecutor = new ActionExecutor({ mcpClient: null });
  }

  async initialize(): Promise<void> {
    const loadResult = loadConfig();
    this.config = loadResult.config || null;
    this.configPath = loadResult.configPath;

    if (!this.config) {
      throw new Error('Failed to load config: ' + loadResult.result.errors.join(', '));
    }

    const validation = validateConfig(this.config);
    if (!validation.valid) {
      console.warn('Config validation warnings:', validation.warnings);
      if (validation.errors.length > 0) {
        throw new Error('Config validation failed: ' + validation.errors.join(', '));
      }
    }

    this.clientFactory = createClientFactory(this.config);

    this.mcpClient = new MCPSDKClient(this.config);
    try {
      await this.mcpClient.initialize();
      this.actionExecutor.setMCPClient(this.mcpClient);
    } catch (error) {
      console.warn('MCP initialization failed, continuing without MCP:', error);
    }

    this.stepRunner = new StepRunner({
      actionExecutor: this.actionExecutor,
      clientFactory: this.clientFactory,
      getMCPTools: () => this.getMCPTools(),
    });

    this.taskOrchestrator = new TaskOrchestrator({
      actionExecutor: this.actionExecutor,
      stepRunner: this.stepRunner,
      getConfig: () => this.getConfig(),
    });

    this.wsManager.setTaskCommandHandler((message) => this.handleTaskCommand(message));
  }

  async execute(request: TaskRequest): Promise<TaskResponse> {
    if (!this.taskOrchestrator) {
      throw new Error('TaskService not initialized');
    }
    return this.taskOrchestrator.execute(request);
  }

  getConfig(): ResolvedConfig | null {
    return this.config;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  getMCPStatus() {
    return {
      enabled: this.mcpClient?.isEnabled() || false,
      servers: this.mcpClient?.getServerList() || [],
    };
  }

  getMCPTools() {
    return this.mcpClient?.getAvailableTools() || [];
  }

  getMCPSDKClient() {
    return this.mcpClient;
  }

  getHistory(limit?: number) {
    return this.taskOrchestrator?.getHistory(limit) || [];
  }

  getHistoryById(id: string) {
    return this.taskOrchestrator?.getHistoryById(id) || null;
  }

  clearHistory() {
    this.taskOrchestrator?.clearHistory();
  }

  getActionExecutor(): ActionExecutor {
    return this.actionExecutor;
  }

  getTaskOrchestrator(): TaskOrchestrator | null {
    return this.taskOrchestrator;
  }

  async shutdown(): Promise<void> {
    if (this.mcpClient) {
      await this.mcpClient.shutdown();
    }
  }
  async streamTaskStream(options: {
    provider: string;
    model: string;
    messages: ModelMessage[];
  }): Promise<void> {
    if (!this.taskOrchestrator) {
      throw new Error('TaskService not initialized');
    }

    const taskId = crypto.randomUUID();
    const onEvent = this.createStreamEventHandler(taskId);

    await streamTask({
      provider: options.provider,
      model: options.model,
      messages: options.messages,
      executor: this.actionExecutor,
      taskOrchestrator: this.taskOrchestrator,
      config: this.config!,
      onEvent,
    });
  }

  private createStreamEventHandler(taskId: string): (event: { type: string; [key: string]: unknown }) => void {
    return (event) => {
      this.wsManager.broadcast({
        taskId,
        ...event,
        timestamp: new Date().toISOString(),
      });
    };
  }
/**
   * Execute a single action (backward compatibility)
   */
  async executeAction(action: import('../types.js').Action): Promise<import('../types.js').ActionResult> {
    return this.actionExecutor.execute(action);
  }

  /**
   * Get singleton instance (backward compatibility)
   */
  static getInstance(): TaskService {
    if (!TaskService.instance) {
      TaskService.instance = new TaskService();
    }
    return TaskService.instance;
  }

  private static instance: TaskService | null = null;

  static setInstance(instance: TaskService): void {
    TaskService.instance = instance;
  }

  async testAIConnectivity(): Promise<{
    vision: {
      status: string;
      provider?: string;
      model?: string;
      responseTime: number;
      error?: string | null;
      intro?: string;
    };
    decision: {
      status: string;
      provider?: string;
      model?: string;
      responseTime: number;
      error?: string | null;
      intro?: string;
    };
    totalResponseTime: number;
  }> {
    const startTime = Date.now();
    console.log('[AI Test] Starting connectivity test...');

    const testScreenshot =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const testViewport = { width: 1, height: 1 };

    let visionResult: {
      status: string;
      provider?: string;
      model?: string;
      responseTime: number;
      error?: string | null;
      intro?: string;
    };
    const visionStart = Date.now();
    try {
      const visionClient = this.clientFactory?.createVisionClient();
      if (!visionClient) {
        console.log('[AI Test] Vision: not configured');
        visionResult = {
          status: 'not_configured',
          responseTime: Date.now() - visionStart,
          error: 'No vision client available',
        };
      } else {
        console.log(`[AI Test] Testing Vision: ${visionClient.provider}/${visionClient.model}`);
        await visionClient.detect(testScreenshot, testViewport);
        const intro = await this.getModelIntro(visionClient);
        visionResult = {
          status: 'connected',
          provider: visionClient.provider,
          model: visionClient.model,
          responseTime: Date.now() - visionStart,
          error: null,
          intro,
        };
        console.log(`[AI Test] Vision: OK (${visionResult.responseTime}ms)`);
        console.log(`[AI Test] Vision AI Response: ${intro}`);
      }
    } catch (err) {
      const errMsg = (err as Error).message;
      const truncatedError = errMsg.length > 200 ? errMsg.substring(0, 200) + '...' : errMsg;
      console.log(`[AI Test] Vision: FAILED - ${truncatedError}`);
      visionResult = {
        status: 'disconnected',
        responseTime: Date.now() - visionStart,
        error: truncatedError,
      };
    }

    let decisionResult: {
      status: string;
      provider?: string;
      model?: string;
      responseTime: number;
      error?: string | null;
      intro?: string;
    };
    const decisionStart = Date.now();
    try {
      const decisionClient = this.clientFactory?.createDecisionClient();
      if (!decisionClient) {
        console.log('[AI Test] Decision: not configured');
        decisionResult = {
          status: 'not_configured',
          responseTime: Date.now() - decisionStart,
          error: 'No decision client available',
        };
      } else {
        console.log(
          `[AI Test] Testing Decision: ${decisionClient.provider}/${decisionClient.model}`
        );
        const intro = await this.getModelIntro(decisionClient);
        decisionResult = {
          status: 'connected',
          provider: decisionClient.provider,
          model: decisionClient.model,
          responseTime: Date.now() - decisionStart,
          error: null,
          intro,
        };
        console.log(`[AI Test] Decision: OK (${decisionResult.responseTime}ms)`);
        console.log(`[AI Test] AI Response: ${intro}`);
      }
    } catch (err) {
      const errMsg = (err as Error).message;
      const truncatedError = errMsg.length > 200 ? errMsg.substring(0, 200) + '...' : errMsg;
      console.log(`[AI Test] Decision: FAILED - ${truncatedError}`);
      decisionResult = {
        status: 'disconnected',
        responseTime: Date.now() - decisionStart,
        error: truncatedError,
      };
    }

    console.log(`[AI Test] Completed in ${Date.now() - startTime}ms`);
    return {
      vision: visionResult,
      decision: decisionResult,
      totalResponseTime: Date.now() - startTime,
    };
  }

  private getProviderDisplayName(provider: string): string {
    const names: Record<string, string> = {
      kimi: 'Moonshot AI',
      glm: '智谱 AI',
      nvidia: 'NVIDIA',
      openai: 'OpenAI',
      anthropic: 'Anthropic',
      google: 'Google',
    };
    return names[provider] || provider;
  }
  /**
   * Shared interface for clients with provider and model properties
   */
  private async getModelIntro(
    client: VisionClient | DecisionClient
  ): Promise<string> {

    try {
      const config = this.config;
      if (!config?._resolved?.providers?.[client.provider]) {
        return `我是 ${client.model} 决策模型，由 ${this.getProviderDisplayName(client.provider)} 提供。`;
      }
      const providerConfig = config._resolved.providers[client.provider] as import('../config/schema.js').Provider;
      const apiKey = providerConfig?.apiKey;
      const baseUrl = providerConfig?.baseUrl || 'https://api.moonshot.cn/v1';
      if (!apiKey || apiKey.startsWith('{')) {
        return `我是 ${client.model} 决策模型，由 ${this.getProviderDisplayName(client.provider)} 提供。`;
      }
      const axios = (await import('axios')).default;
      const response = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model: client.model,
          messages: [
            {
              role: 'user',
              content: '请用一句话简短介绍你自己（不超过50字），说明你的模型名称和能力。',
            },
          ],
          temperature: 0.7,
          max_tokens: 100,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );
      const intro = response.data.choices[0]?.message?.content || `我是 ${client.model} 决策模型。`;
      return intro.trim();
    } catch {
      return `我是 ${client.model} 决策模型，由 ${this.getProviderDisplayName(client.provider)} 提供。`;
    }
  }

  private handleTaskCommand(message: {
    type: string;
    taskId?: string;
    instruction?: unknown;
    action?: unknown;
  }): void {
    switch (message.type) {
      case 'pause':
        console.log('Pause command received');
        this.wsManager.broadcast({
          type: 'task_paused',
          taskId: message.taskId,
          timestamp: new Date().toISOString(),
        });
        break;
      case 'resume':
        console.log('Resume command received');
        this.wsManager.broadcast({
          type: 'task_resumed',
          taskId: message.taskId,
          timestamp: new Date().toISOString(),
        });
        break;
      case 'modify':
        console.log('Modify command received:', message);
        this.wsManager.broadcast({
          type: 'task_modified',
          taskId: message.taskId,
          instruction: message.instruction,
          timestamp: new Date().toISOString(),
        });
        break;
      case 'manual_action':
        console.log('Manual action command received:', message);
        this.wsManager.broadcast({
          type: 'manual_action_executed',
          taskId: message.taskId,
          action: message.action,
          timestamp: new Date().toISOString(),
        });
        break;
    }
  }
}

const taskService = new TaskService();
TaskService.setInstance(taskService);
export { taskService };