import { EventEmitter } from 'node:events';
import type { BrowserClient } from '../../browser-client.js';
import {
  loadVisionConfig,
  type VisionConfig,
  type VisionConfigOverride,
} from '../../mcps/vision-agent/config.js';
import { createSnapshotCache, type SnapshotCache } from '../../mcps/vision-agent/snapshot-cache.js';
import { createVisionAgentTools } from '../../mcps/vision-agent/tools/index.js';
import type { ToolDeps } from '../../mcps/vision-agent/types.js';
import { VisionAnalyzer } from '../../mcps/vision-agent/vision-analyzer.js';
import { createWorkerLogger } from '../../services/logger.js';
import type { GatewayTool, ToolProvider, ToolProviderStatus } from '../types.js';

const logger = createWorkerLogger('VisionAgentProvider');

export class VisionAgentProvider extends EventEmitter implements ToolProvider {
  readonly id = 'vision-agent';
  status: ToolProviderStatus = 'initializing';

  private readonly browserClient: BrowserClient;
  private readonly configOverride?: VisionConfigOverride;
  private config?: VisionConfig;
  private visionAnalyzer?: VisionAnalyzer;
  private cache?: SnapshotCache;
  private _tools: GatewayTool[] = [];

  constructor(browserClient: BrowserClient, configOverride?: VisionConfigOverride) {
    super();
    this.browserClient = browserClient;
    this.configOverride = configOverride;
  }

  async initialize(): Promise<void> {
    this.setStatus('initializing');

    try {
      this.config = loadVisionConfig(this.configOverride);
      this.visionAnalyzer = new VisionAnalyzer(this.config);
      this.cache = createSnapshotCache();

      const deps: ToolDeps = {
        browserClient: this.browserClient,
        visionAnalyzer: this.visionAnalyzer,
        cache: this.cache,
      };

      this._tools = createVisionAgentTools(deps, this.config, () => this.status === 'ready');
      this.setStatus('ready');
    } catch (error) {
      logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'Vision agent provider initialized in degraded mode',
      );
      this._tools = [];
      this.visionAnalyzer = undefined;
      this.cache?.clear();
      this.cache = undefined;
      this.setStatus('degraded');
    }
  }

  getTools(): GatewayTool[] {
    return this._tools;
  }

  async shutdown(): Promise<void> {
    this.cache?.clear();
    this.cache = undefined;
    this.visionAnalyzer = undefined;
    this._tools = [];
    this.setStatus('disabled');
  }

  private setStatus(status: ToolProviderStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit('status-changed', status);
  }
}
