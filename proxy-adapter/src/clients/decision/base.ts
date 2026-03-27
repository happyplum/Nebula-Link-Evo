import { DecisionContext } from '../types.js';
import { Action } from '../../config/schema.js';
import type { ToolCall, UsageStats } from './stream.js';

export interface DecisionClient {
  provider: string;
  model: string;

  decide(context: DecisionContext): Promise<Action>;

  decideStream?(
    context: DecisionContext,
    callbacks: {
      onToken?: (text: string) => void;
      onThinking?: (text: string) => void;
      onToolCall?: (call: ToolCall) => void;
      onUsage?: (usage: UsageStats) => void;
      onDone?: () => void;
    },
    signal?: AbortSignal
  ): Promise<void>;

  getCapabilities(): string[];
}
