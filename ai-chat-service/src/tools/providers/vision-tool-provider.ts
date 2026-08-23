import { EventEmitter } from 'node:events';
import type { VisionAnalyzer } from '../../vision/vision-analyzer.js';
import { VisionAnalysisError } from '../../vision/errors.js';
import type { VisionSnapshotLoader } from '../../vision/snapshot-loader.js';
import type { GatewayTool, ToolProvider, ToolProviderStatus } from '../types.js';

const BINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schema: { type: 'string', const: 'nebula.vision-snapshot-binding/1.0' },
    sessionId: { type: 'string' },
    tabId: { type: 'string' },
    operationId: { type: 'string' },
    requestHash: { type: 'string' },
    leaseId: { type: 'string' },
    leaseSequence: { type: 'integer', minimum: 1 },
    snapshotId: { type: 'string' },
    status: { type: 'string', const: 'succeeded' },
    domArtifact: {
      type: 'object',
      additionalProperties: false,
      properties: {
        artifactId: { type: 'string' },
        sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        mimeType: { type: 'string', const: 'application/json' },
        sizeBytes: { type: 'integer', minimum: 1 },
      },
      required: ['artifactId', 'sha256', 'mimeType', 'sizeBytes'],
    },
  },
  required: [
    'schema',
    'sessionId',
    'tabId',
    'operationId',
    'requestHash',
    'leaseId',
    'leaseSequence',
    'snapshotId',
    'status',
    'domArtifact',
  ],
} as const;

/** Bounded Vision v2 product tools over immutable proxy-managed evidence. */
export class VisionToolProvider extends EventEmitter implements ToolProvider {
  readonly id = 'vision';
  status: ToolProviderStatus = 'initializing';
  private tools: GatewayTool[] = [];

  constructor(
    private readonly analyzer: VisionAnalyzer,
    private readonly snapshots: VisionSnapshotLoader
  ) {
    super();
  }

  async initialize(): Promise<void> {
    this.tools = [this.buildAnalyzePage(), this.buildResolveTarget()];
    this.status = 'ready';
  }

  getTools(): GatewayTool[] {
    return this.tools;
  }

  async shutdown(): Promise<void> {
    this.status = 'disabled';
    this.tools = [];
  }

  private buildAnalyzePage(): GatewayTool {
    return {
      id: 'vision:analyze_page',
      name: 'vision.analyze_page',
      description: 'Analyze one immutable proxy-managed browser snapshot.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { binding: BINDING_SCHEMA, objective: { type: 'string' } },
        required: ['binding'],
      },
      providerId: this.id,
      exposeTo: ['chat'],
      isAvailable: true,
      execute: async (args, context) =>
        this.execute(async () => {
          const input = requireInput(args);
          const loaded = await this.snapshots.load(input.binding, context?.abortSignal);
          const analysis = await this.analyzer.analyzePage(
            loaded.snapshot,
            typeof input.objective === 'string' ? input.objective : undefined
          );
          return { ok: true, snapshot_id: loaded.snapshot.snapshot_id, ...analysis };
        }),
    };
  }

  private buildResolveTarget(): GatewayTool {
    return {
      id: 'vision:resolve_target',
      name: 'vision.resolve_target',
      description: 'Resolve a semantic target against one immutable proxy-managed snapshot.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { binding: BINDING_SCHEMA, description: { type: 'string', minLength: 1 } },
        required: ['binding', 'description'],
      },
      providerId: this.id,
      exposeTo: ['chat'],
      isAvailable: true,
      execute: async (args, context) =>
        this.execute(async () => {
          const input = requireInput(args);
          if (typeof input.description !== 'string' || !input.description.trim()) {
            throw new Error('description is required');
          }
          const loaded = await this.snapshots.load(input.binding, context?.abortSignal);
          const match = await this.analyzer.resolveTarget(loaded.snapshot, input.description.trim());
          const element = match.nebula_id ? loaded.snapshot.elements_map[match.nebula_id] : undefined;
          return {
            ok: true,
            snapshot_id: loaded.snapshot.snapshot_id,
            ...match,
            ...(element
              ? {
                  element: {
                    tag: element.tag,
                    text: element.text,
                    bbox: element.bbox,
                    locator_bundle: element.locator_bundle,
                  },
                }
              : {}),
          };
        }),
    };
  }

  private async execute(run: () => Promise<Record<string, unknown>>): Promise<string> {
    try {
      return JSON.stringify(await run());
    } catch (error) {
      if (error instanceof VisionAnalysisError) {
        return JSON.stringify({
          ok: false,
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        });
      }
      return JSON.stringify({
        ok: false,
        code: 'VISION_SNAPSHOT_REJECTED',
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      });
    }
  }
}

function requireInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Vision tool input must be an object');
  }
  return value as Record<string, unknown>;
}
