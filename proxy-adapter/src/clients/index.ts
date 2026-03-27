import {
  ResolvedConfig,
  UIElement,
  Action,
  DOMSnapshotResponse,
} from '../config/schema.js';
import { VisionClient, DecisionClient, ClientResult, DecisionContext, MCPTool } from './types.js';
import { createVisionClientFactory, VisionClientFactory } from './vision/index.js';
import { createDecisionClientFactory, DecisionClientFactory } from './decision/index.js';

export class ClientFactory {
  private visionFactory: VisionClientFactory;
  private decisionFactory: DecisionClientFactory;
  private config: ResolvedConfig;

  constructor(config: ResolvedConfig) {
    this.config = config;
    this.visionFactory = createVisionClientFactory();
    this.decisionFactory = createDecisionClientFactory();
  }

  createVisionClient(provider?: string, model?: string): VisionClient | null {
    const p = provider || this.config.defaults.vision.provider;
    const m = model || this.config.defaults.vision.model;
    return this.visionFactory.create(this.config, p, m);
  }

  createDecisionClient(provider?: string, model?: string): DecisionClient | null {
    if (!provider || !model) {
      throw new Error(`provider and model are required for createDecisionClient (got: provider=${JSON.stringify(provider)}, model=${JSON.stringify(model)})`);
    }
    return this.decisionFactory.create(this.config, provider, model);
  }

  async detectUI(
    screenshot: string,
    viewport: { width: number; height: number },
    instruction?: string
  ): Promise<ClientResult<UIElement[]>> {
    const client = this.createVisionClient();

    if (!client) {
      return {
        success: false,
        error: 'No vision client available',
        provider: this.config.defaults.vision.provider,
        model: this.config.defaults.vision.model,
      };
    }

    try {
      const elements = await client.detect(screenshot, viewport, { instruction });
      return {
        success: true,
        data: elements,
        provider: client.provider,
        model: client.model,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        provider: client.provider,
        model: client.model,
      };
    }
  }

  async decideAction(
    context: DecisionContext,
    mcpTools?: MCPTool[]
  ): Promise<ClientResult<Action>> {
    let client: DecisionClient | null;
    try {
      client = this.createDecisionClient(
        this.config.defaults.decision.provider,
        this.config.defaults.decision.model
      );
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        provider: this.config.defaults.decision.provider,
        model: this.config.defaults.decision.model,
      };
    }

    if (!client) {
      return {
        success: false,
        error: 'No decision client available',
        provider: this.config.defaults.decision.provider,
        model: this.config.defaults.decision.model,
      };
    }

    try {
      const contextWithTools: DecisionContext = {
        ...context,
        mcpTools: mcpTools || context.mcpTools,
      };
      const action = await client.decide(contextWithTools);
      return {
        success: true,
        data: action,
        provider: client.provider,
        model: client.model,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        provider: client.provider,
        model: client.model,
      };
    }
  }

  async detectWithFallback(
    screenshot: string,
    viewport: { width: number; height: number },
    instruction?: string,
    maxRetries: number = 3
  ): Promise<ClientResult<UIElement[]>> {
    let lastError: string = '';
    let usedProvider = this.config.defaults.vision.provider;
    let usedModel = this.config.defaults.vision.model;

    for (let attempt = 0; attempt < maxRetries + 1; attempt++) {
      if (attempt > 0) {
        console.log(`Retry ${attempt}/${maxRetries} with fallback...`);
      }

      if (this.config.defaults.mode === 'unified') {
        let unifiedClient: DecisionClient | null;
        try {
          unifiedClient = this.createDecisionClient(
            this.config.defaults.decision.provider,
            this.config.defaults.decision.model
          );
        } catch {
          unifiedClient = null;
        }
        if (unifiedClient) {
          try {
            const dom = await this.getSimplifiedDOMFromBrowser();
            const action = await unifiedClient.decide({
              screenshot,
              dom,
              elements: [],
              instruction: instruction || '检测页面元素',
              previousActions: [],
            });

            if (action.type === 'click') {
              const x = typeof action.params.x === 'number' ? action.params.x : undefined;
              const y = typeof action.params.y === 'number' ? action.params.y : undefined;
              if (x !== undefined && y !== undefined) {
                const elements: UIElement[] = [
                  {
                    id: 0,
                    type: 'button',
                    bbox: [x - 25, y - 20, 50, 40],
                    center: [x, y],
                    confidence: 0.9,
                  },
                ];
                return { success: true, data: elements };
              }
            }
          } catch (error) {
            lastError = (error as Error).message;
          }
        }
      }

      const client = this.createVisionClient(usedProvider, usedModel);
      if (client) {
        try {
          const elements = await client.detect(screenshot, viewport, { instruction });
          return {
            success: true,
            data: elements,
            provider: client.provider,
            model: client.model,
          };
        } catch (error) {
          lastError = (error as Error).message;
          usedProvider = client.provider;
          usedModel = client.model;
        }
      }
    }

    return {
      success: false,
      error: `All vision providers failed: ${lastError}`,
      provider: usedProvider,
      model: usedModel,
    };
  }

  private async getSimplifiedDOMFromBrowser(): Promise<DOMSnapshotResponse> {
    const { browserClient } = await import('../browser-client.js');
    return browserClient.getSimplifiedDOM();
  }

  isUnifiedMode(): boolean {
    return this.config.defaults.mode === 'unified';
  }

  getConfig(): ResolvedConfig {
    return this.config;
  }
}

export function createClientFactory(config: ResolvedConfig): ClientFactory {
  return new ClientFactory(config);
}
