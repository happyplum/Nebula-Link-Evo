import type { SemanticEvidenceRepository } from '../database/repositories/semantic-evidence-repository.js';
import { SemanticArtifactStore } from '../infrastructure/semantic-artifact-store.js';

const DAY_MS = 24 * 60 * 60 * 1_000;

interface RetentionLogger {
  warn(details: Record<string, unknown>, message: string): void;
}

export interface SemanticEvidenceRetentionOptions {
  repository: SemanticEvidenceRepository;
  artifactStore?: SemanticArtifactStore;
  successRetentionDays?: number;
  failureRetentionDays?: number;
  logger?: RetentionLogger;
}

export interface EvidenceCleanupResult {
  recordsDeleted: number;
  filesDeleted: number;
  storageFailures: number;
}

export class SemanticEvidenceRetentionService {
  private readonly artifactStore: SemanticArtifactStore;
  private readonly successRetentionDays: number;
  private readonly failureRetentionDays: number;
  private cleanupPromise?: Promise<EvidenceCleanupResult>;

  constructor(private readonly options: SemanticEvidenceRetentionOptions) {
    this.artifactStore = options.artifactStore ?? new SemanticArtifactStore();
    this.successRetentionDays = requireRetentionDays(
      options.successRetentionDays ?? 7,
      'successRetentionDays'
    );
    this.failureRetentionDays = requireRetentionDays(
      options.failureRetentionDays ?? 30,
      'failureRetentionDays'
    );
    if (this.failureRetentionDays < this.successRetentionDays) {
      throw new Error('failureRetentionDays must not be shorter than successRetentionDays');
    }
  }

  cleanupExpiredArtifacts(now = new Date()): Promise<EvidenceCleanupResult> {
    this.cleanupPromise ??= this.runCleanup(now).finally(() => {
      this.cleanupPromise = undefined;
    });
    return this.cleanupPromise;
  }

  private async runCleanup(now: Date): Promise<EvidenceCleanupResult> {
    const deletedAt = now.toISOString();
    const successCutoff = new Date(
      now.getTime() - this.successRetentionDays * DAY_MS
    ).toISOString();
    const failureCutoff = new Date(
      now.getTime() - this.failureRetentionDays * DAY_MS
    ).toISOString();
    const eligible = this.options.repository.listArtifactsEligibleForDeletion(
      deletedAt,
      successCutoff,
      failureCutoff
    );
    let recordsDeleted = 0;
    for (const artifact of eligible) {
      if (
        this.options.repository.claimArtifactDeletion(
          artifact.id,
          deletedAt,
          successCutoff,
          failureCutoff
        )
      ) {
        recordsDeleted += 1;
      }
    }

    let filesDeleted = 0;
    let storageFailures = 0;
    for (const artifact of this.options.repository.listPendingStorageCleanup()) {
      if (artifact.storageBackend !== 'local_file') {
        storageFailures += 1;
        this.options.logger?.warn(
          {
            artifactObjectId: artifact.id,
            storageBackend: artifact.storageBackend,
          },
          '长期证据对象使用了不支持的存储后端；保留待清理状态'
        );
        continue;
      }
      if (this.options.repository.hasOtherLiveStorageReference(artifact.storageKey, artifact.id)) {
        continue;
      }
      try {
        if (await this.artifactStore.delete(artifact.storageKey)) filesDeleted += 1;
        this.options.repository.recordStorageCleanup(artifact.id, deletedAt);
      } catch (error) {
        storageFailures += 1;
        this.options.logger?.warn(
          { err: error, artifactObjectId: artifact.id },
          '长期证据对象存储清理失败；后续周期将重试'
        );
      }
    }
    return { recordsDeleted, filesDeleted, storageFailures };
  }
}

function requireRetentionDays(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
