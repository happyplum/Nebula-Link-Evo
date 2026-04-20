import type {
  UIElement,
  SimplifiedDOM,
  DOMElement,
  Action,
  ActionResult,
  TaskRequest,
  TaskResponse,
} from '../types.js';
import type { DOMSnapshotResponse as SharedDOMSnapshotResponse } from '@nebula-link-evo/shared';

export type {
  UIElement,
  SimplifiedDOM,
  DOMElement,
  Action,
  ActionResult,
  TaskRequest,
  TaskResponse,
};

export type DOMSnapshotResponse = SharedDOMSnapshotResponse;

export interface Config {
  $schema?: string;
  version: string;
  description?: string;
  providers: Record<string, FlatProvider>;
  mcp: MCPConfig;
  defaults: DefaultsConfig;
  visionTool?: VisionToolConfig;
  settings: RawSettingsConfig;
}

export interface FlatProvider {
  name?: string;
  enabled: boolean;
  apiKey: string;
  baseUrl?: string;
  npmPackage?: string;
  mcp?: string[];
  models?: Record<string, ModelConfig>;
}



export interface ModelConfig {
  type: 'vision' | 'decision' | 'multimodal';
  capabilities: ('vision' | 'decision')[];
  temperature?: number;
  maxTokens?: number;
}

export interface MCPConfig {
  enabled: boolean;
  servers: Record<string, MCPServerConfig>;
}

export interface MCPServerConfig {
  enabled: boolean;
  command: string;
  args: string[];
  env: Record<string, string>;
  stdin?: boolean;
  url?: string;
}

export interface DefaultsConfig {
  mode: 'separation' | 'unified';
  vision: string;
  decision: string;
}

export interface ModelSelector {
  provider: string;
  model: string;
}

export interface ResolvedDefaultsConfig {
  mode: 'separation' | 'unified';
  vision: ModelSelector;
  decision: ModelSelector;
}

export interface VisionToolConfig {
  maxCallsPerStep: number;
  timeoutMs: number;
  screenshotQuality: number;
}

export interface RawSettingsConfig {
  timeout: number | string;
  maxRetries: number | string;
  temperature: number | string;
  maxTokens: number | string;
  maxSteps: number | string;
}

export interface SettingsConfig {
  timeout: number;
  maxRetries: number;
  temperature: number;
  maxTokens: number;
  maxSteps: number;
}

export interface ResolvedConfig extends Omit<Config, 'defaults' | 'settings' | 'providers'> {
  defaults: ResolvedDefaultsConfig;
  settings: SettingsConfig;
  providers: Record<string, ResolvedProvider>;
}

export interface ResolvedProvider extends FlatProvider {
  apiKey: string;
  models: Record<
    string,
    ModelConfig & { resolvedTemperature?: number; resolvedMaxTokens?: number }
  >;
}
