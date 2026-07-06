import { UIElement, Action, ActionResult, DOMSnapshotResponse } from '../config/schema.js';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: object;
}

export interface DecisionClient {
  provider: string;
  model: string;
  capabilities: string[];

  decide(context: DecisionContext): Promise<Action>;

  decideStream?(
    context: DecisionContext,
    callbacks: {
      onToken?: (text: string) => void;
      onThinking?: (text: string) => void;
      onToolCall?: (call: unknown) => void;
      onUsage?: (usage: unknown) => void;
      onDone?: () => void;
    },
    signal?: AbortSignal
  ): Promise<void>;

  getCapabilities(): string[];
}

export interface DecisionContext {
  screenshot: string;
  dom: DOMSnapshotResponse;
  elements: UIElement[];
  instruction: string;
  previousActions: ActionResult[];
  mcpTools?: MCPTool[];
}

export type ClientType = 'decision' | 'mcp';

export interface ClientInfo {
  type: ClientType;
  provider: string;
  model: string;
  capabilities: string[];
}

export interface ClientResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  provider?: string;
  model?: string;
}
