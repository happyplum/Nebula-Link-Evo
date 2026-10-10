import type { SemanticEventV1 } from '../../contracts/semantic-control.js';
import type {
  SemanticControlEventHubPort,
  SemanticControlEventType,
} from '../../services/semantic-control-event-hub.js';
import { afterImmediateTransactionCommit, type DatabaseLike } from './semantic-repository-utils.js';

interface SemanticEventRow {
  id: string;
  seq: number | bigint;
  type: string;
  entity_type: string;
  entity_id: string;
  state_version: number | bigint | null;
  correlation_id: string | null;
  causation_id: string | null;
  payload_json: string;
  occurred_at: string;
}

export function publishPersistedSemanticControlEvent(
  db: DatabaseLike,
  hub: SemanticControlEventHubPort | undefined,
  type: SemanticControlEventType,
  contextId: string,
  seq: number
): void {
  if (!hub) return;

  const table = type === 'authoring' ? 'authoring_events' : 'run_events';
  const contextColumn = type === 'authoring' ? 'job_id' : 'run_id';
  const row = db
    .prepare(
      `SELECT id, seq, type, entity_type, entity_id, state_version,
              correlation_id, causation_id, payload_json, occurred_at
       FROM ${table} WHERE ${contextColumn} = ? AND seq = ?`
    )
    .get(contextId, seq) as SemanticEventRow | undefined;
  if (!row) throw new Error('Inserted semantic control event could not be reloaded');

  const event: SemanticEventV1 = {
    id: row.id,
    seq: Number(row.seq),
    schemaVersion: 1,
    type: row.type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    ...(row.state_version ? { stateVersion: Number(row.state_version) } : {}),
    ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
    ...(row.causation_id ? { causationId: row.causation_id } : {}),
    payload: parsePayload(row.payload_json),
    occurredAt: row.occurred_at,
  };
  afterImmediateTransactionCommit(db, () => hub.publishControlEvent(type, contextId, event));
}

function parsePayload(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
