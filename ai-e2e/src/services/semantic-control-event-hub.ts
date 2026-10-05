import { EventEmitter } from 'node:events';
import type { SemanticEventV1 } from '../contracts/semantic-control.js';

export type SemanticControlEventType = 'authoring' | 'run';

export interface SemanticAuthoringMessage {
  seq: number;
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export type SemanticControlHubMessage =
  | { kind: 'control'; event: SemanticEventV1 }
  | { kind: 'authoring-message'; message: SemanticAuthoringMessage };

export interface SemanticControlEventHubPort {
  publishControlEvent(
    type: SemanticControlEventType,
    contextId: string,
    event: SemanticEventV1
  ): void;
  publishAuthoringMessage(contextId: string, message: SemanticAuthoringMessage): void;
  subscribe(
    type: SemanticControlEventType,
    contextId: string,
    listener: (message: SemanticControlHubMessage) => void
  ): () => void;
}

export class SemanticControlEventHub implements SemanticControlEventHubPort {
  private readonly emitter = new EventEmitter();

  publishControlEvent(
    type: SemanticControlEventType,
    contextId: string,
    event: SemanticEventV1
  ): void {
    this.emitter.emit(key(type, contextId), {
      kind: 'control',
      event,
    } satisfies SemanticControlHubMessage);
  }

  publishAuthoringMessage(contextId: string, message: SemanticAuthoringMessage): void {
    this.emitter.emit(key('authoring', contextId), {
      kind: 'authoring-message',
      message,
    } satisfies SemanticControlHubMessage);
  }

  subscribe(
    type: SemanticControlEventType,
    contextId: string,
    listener: (message: SemanticControlHubMessage) => void
  ): () => void {
    const eventName = key(type, contextId);
    this.emitter.on(eventName, listener);
    return () => this.emitter.off(eventName, listener);
  }
}

function key(type: SemanticControlEventType, contextId: string): string {
  return `${type}:${contextId}`;
}
