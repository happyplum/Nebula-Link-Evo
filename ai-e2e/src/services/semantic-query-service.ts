import type { SemanticQueryRepository } from '../database/repositories/semantic-query-repository.js';
import type {
  AuthoringSnapshotV1,
  RunSnapshotV1,
  SemanticAssetType,
  SemanticEventV1,
  SemanticRevisionHistoryV1,
  SemanticRevisionV1,
  SemanticWorkspaceV1,
  ServiceCapabilitiesV1,
} from '../types/semantic-control.js';
import { ServiceError } from './service-error.js';

const MAX_EVENT_LOG_LIMIT = 500;

export class SemanticQueryService {
  constructor(private readonly repository: SemanticQueryRepository) {}

  getCapabilities(): ServiceCapabilitiesV1 {
    return {
      schema: 'nebula.service-capabilities/1.0',
      service: 'ai-e2e',
      serviceVersion: '1.0.0',
      protocols: {
        'semantic-assets': { major: 1, minor: 0 },
        authoring: { major: 1, minor: 0 },
        run: { major: 1, minor: 0 },
        'side-effect-policy': { major: 1, minor: 0 },
      },
      features: {
        workspaceProjection: true,
        assetRevisionHistory: true,
        authoringSnapshots: true,
        runSnapshots: true,
        persistentEventLog: true,
        snapshotFirstEvents: false,
        authoringCommands: false,
        runCommands: false,
        structuredAmendments: false,
        environments: 'local,test,staging,production',
        controlPlaneBoundary: 'loopback_single_user',
      },
      limits: {
        maxActiveBrowserSessions: 1,
        maxBrowserContextsPerSession: 1,
        maxEventLogPageSize: MAX_EVENT_LOG_LIMIT,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  getWorkspace(versionId: string): SemanticWorkspaceV1 {
    return requireResult(
      this.repository.getWorkspace(versionId),
      `Business version '${versionId}' not found`
    );
  }

  getRevisionHistory(assetType: SemanticAssetType, assetId: string): SemanticRevisionHistoryV1 {
    return requireResult(
      this.repository.getRevisionHistory(assetType, assetId),
      `${assetType} asset '${assetId}' not found`
    );
  }

  getRevision(
    assetType: SemanticAssetType,
    assetId: string,
    revisionId: string
  ): SemanticRevisionV1 {
    return requireResult(
      this.repository.getRevision(assetType, assetId, revisionId),
      `${assetType} revision '${revisionId}' not found for asset '${assetId}'`
    );
  }

  getAuthoringSnapshot(jobId: string): AuthoringSnapshotV1 {
    return requireResult(
      this.repository.getAuthoringSnapshot(jobId),
      `Authoring job '${jobId}' not found`
    );
  }

  getRunSnapshot(runId: string): RunSnapshotV1 {
    return requireResult(this.repository.getRunSnapshot(runId), `Run '${runId}' not found`);
  }

  listAuthoringEvents(jobId: string, afterSeq?: number, limit?: number): SemanticEventV1[] {
    return requireResult(
      this.repository.listAuthoringEvents(
        jobId,
        normalizeAfterSeq(afterSeq),
        normalizeLimit(limit)
      ),
      `Authoring job '${jobId}' not found`
    );
  }

  listRunEvents(runId: string, afterSeq?: number, limit?: number): SemanticEventV1[] {
    return requireResult(
      this.repository.listRunEvents(runId, normalizeAfterSeq(afterSeq), normalizeLimit(limit)),
      `Run '${runId}' not found`
    );
  }
}

function requireResult<T>(value: T | null, message: string): T {
  if (value === null) throw ServiceError.notFound(message);
  return value;
}

function normalizeAfterSeq(value?: number): number {
  return Number.isInteger(value) && (value ?? 0) >= 0 ? (value ?? 0) : 0;
}

function normalizeLimit(value?: number): number {
  if (!Number.isInteger(value) || value === undefined) return 100;
  return Math.min(Math.max(value, 1), MAX_EVENT_LOG_LIMIT);
}
