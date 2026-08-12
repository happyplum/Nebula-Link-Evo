import { createHash } from 'node:crypto';
import { AgentTaskError } from '../agent-tasks/errors.js';
import {
  computeSkillContentHash,
  type AgentTaskRepository,
  type SkillVersionRecord,
} from '../agent-tasks/repository.js';
import type { AgentTaskSkillExecution, CreateAgentTaskRequest } from '../agent-tasks/types.js';
import { validateBoundedObjectSchema, validateResponseValue } from '../agent-tasks/validation.js';
import { loadSkillPackages } from './loader.js';

export interface PreparedTaskSkill {
  execution: AgentTaskSkillExecution;
  pins: CreateAgentTaskRequest['skillPolicy']['allow'];
  policySha256: string;
}

export interface SkillCatalogEntry {
  skillId: string;
  version: string;
  contentHash: string;
  description: string;
  requiredModelRole: 'decision';
  requiredToolPatterns: string[];
}

export class SkillRuntime {
  private readonly versions = new Map<string, SkillVersionRecord>();

  constructor(private readonly repository: AgentTaskRepository) {}

  loadFromDirectories(
    directories: readonly string[],
    availableTools: readonly string[] = []
  ): SkillCatalogEntry[] {
    const records = loadSkillPackages(directories);
    for (const record of records) {
      for (const pattern of record.manifest.requiredToolPatterns) {
        if (!availableTools.some((tool) => toolMatchesPattern(tool, pattern))) {
          throw new AgentTaskError(
            'dependency_unavailable',
            `Skill ${record.manifest.id}@${record.manifest.version} requires unavailable tool pattern '${pattern}'`,
            true
          );
        }
      }
    }
    for (const record of records) this.register(record);
    return this.list();
  }

  register(record: SkillVersionRecord): void {
    const computedHash = computeSkillContentHash(record.manifest, record.instructions);
    if (computedHash !== record.manifest.contentHash) {
      throw new AgentTaskError('validation_failed', 'Skill contentHash does not match its content');
    }
    const key = skillVersionKey(record.manifest.id, record.manifest.version);
    const existing = this.versions.get(key);
    if (existing && existing.manifest.contentHash !== record.manifest.contentHash) {
      throw new AgentTaskError('conflict', `Skill version ${key} changed during runtime`);
    }
    this.repository.registerSkillVersion(record);
    this.versions.set(key, structuredClone(record));
  }

  prepareTask(request: CreateAgentTaskRequest): PreparedTaskSkill | undefined {
    const [pin] = request.skillPolicy.allow;
    if (!pin) return undefined;
    const record = this.versions.get(skillVersionKey(pin.skillId, pin.version));
    if (!record) {
      throw new AgentTaskError(
        'dependency_unavailable',
        `Skill ${pin.skillId}@${pin.version} is not loaded`,
        true
      );
    }
    if (record.manifest.contentHash !== pin.contentHash) {
      throw new AgentTaskError(
        'validation_failed',
        `Skill ${pin.skillId}@${pin.version} contentHash does not match the loaded version`
      );
    }

    const inputSchema = validateBoundedObjectSchema(record.manifest.inputSchema);
    const outputSchema = validateBoundedObjectSchema(record.manifest.outputSchema);
    try {
      validateResponseValue(inputSchema, request.input);
    } catch (error) {
      throw new AgentTaskError(
        'validation_failed',
        `Skill ${pin.skillId} input does not match its inputSchema`,
        false,
        undefined,
        { cause: error }
      );
    }
    if (stableStringify(outputSchema) !== stableStringify(request.responseSchema)) {
      throw new AgentTaskError(
        'validation_failed',
        `Skill ${pin.skillId} outputSchema must match the Agent task responseSchema`
      );
    }

    for (const pattern of record.manifest.requiredToolPatterns) {
      if (!request.toolPolicy.allow.some((tool) => toolMatchesPattern(tool, pattern))) {
        throw new AgentTaskError(
          'tool_not_allowed',
          `Skill ${pin.skillId} requires tool pattern '${pattern}' outside the task allowlist`
        );
      }
    }
    const effectiveToolAllow = request.toolPolicy.allow.filter((tool) =>
      record.manifest.requiredToolPatterns.some((pattern) => toolMatchesPattern(tool, pattern))
    );
    const effectiveBudgets = {
      maxModelTurns: Math.min(request.budgets.maxModelTurns, record.manifest.limits.maxModelTurns),
      maxToolCalls: Math.min(request.budgets.maxToolCalls, record.manifest.limits.maxToolCalls),
      ...effectiveMaxTokens(request.budgets.maxTokens, record.manifest.limits.maxTokens),
    };
    const policySha256 = sha256(
      stableStringify({
        pin,
        taskToolAllow: request.toolPolicy.allow,
        taskToolConstraints: request.toolPolicy.constraints ?? null,
        requiredToolPatterns: record.manifest.requiredToolPatterns,
        effectiveToolAllow,
        effectiveBudgets,
      })
    );
    return {
      pins: request.skillPolicy.allow,
      policySha256,
      execution: {
        skillId: pin.skillId,
        version: pin.version,
        contentHash: pin.contentHash,
        description: record.manifest.description,
        instructions: record.instructions,
        requiredToolPatterns: [...record.manifest.requiredToolPatterns],
        effectiveToolAllow,
        effectiveBudgets,
        policySha256,
      },
    };
  }

  list(): SkillCatalogEntry[] {
    return [...this.versions.values()]
      .map((record) => ({
        skillId: record.manifest.id,
        version: record.manifest.version,
        contentHash: record.manifest.contentHash,
        description: record.manifest.description,
        requiredModelRole: record.manifest.requiredModelRole,
        requiredToolPatterns: [...record.manifest.requiredToolPatterns],
      }))
      .sort((left, right) =>
        `${left.skillId}@${left.version}`.localeCompare(`${right.skillId}@${right.version}`)
      );
  }
}

function toolMatchesPattern(tool: string, pattern: string): boolean {
  return pattern.endsWith('.*') ? tool.startsWith(pattern.slice(0, -1)) : tool === pattern;
}

function effectiveMaxTokens(
  taskLimit: number | undefined,
  skillLimit: number | undefined
): { maxTokens?: number } {
  if (taskLimit === undefined && skillLimit === undefined) return {};
  if (taskLimit === undefined) return { maxTokens: skillLimit };
  if (skillLimit === undefined) return { maxTokens: taskLimit };
  return { maxTokens: Math.min(taskLimit, skillLimit) };
}

function skillVersionKey(skillId: string, version: string): string {
  return `${skillId}@${version}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}
