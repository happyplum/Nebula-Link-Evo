import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentTaskRepository,
  computeSkillContentHash,
  type SkillManifestV1,
  type SkillVersionRecord,
} from '../agent-tasks/repository.js';
import { validateCreateAgentTaskRequest } from '../agent-tasks/validation.js';
import { SkillRuntime } from './runtime.js';

const repositories: AgentTaskRepository[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function repository(): AgentTaskRepository {
  const value = new AgentTaskRepository(':memory:');
  repositories.push(value);
  return value;
}

function skillRecord(
  instructions = '只依据明确输入提取结果。',
  requiredToolPatterns: string[] = ['vision.find_element']
): SkillVersionRecord {
  const manifest: SkillManifestV1 = {
    schema: 'nebula.ai.skill/1.0',
    id: 'document.requirements_extract',
    version: '1.0.0',
    description: '提取结构化需求',
    contentHash: '0'.repeat(64),
    requiredModelRole: 'decision',
    inputSchema: {
      type: 'object',
      properties: { objective: { type: 'string' } },
      required: ['objective'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: { result: { type: 'string' } },
      required: ['result'],
      additionalProperties: false,
    },
    requiredToolPatterns,
    limits: { maxToolCalls: 1, maxModelTurns: 1, maxTokens: 100 },
  };
  manifest.contentHash = computeSkillContentHash(manifest, instructions);
  return {
    manifest,
    instructions,
    sourceRef: `local:${manifest.id}/${manifest.version}`,
    registeredAt: '2026-08-13T00:00:00.000Z',
  };
}

function writePackage(root: string, record: SkillVersionRecord): string {
  const packageDirectory = join(root, record.manifest.id, record.manifest.version);
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(join(packageDirectory, 'manifest.json'), JSON.stringify(record.manifest));
  writeFileSync(join(packageDirectory, 'instructions.md'), record.instructions);
  return packageDirectory;
}

function taskRequest(record: SkillVersionRecord) {
  return {
    schema: 'nebula.ai.agent-task/1.0',
    clientTaskId: 'skill-task-1',
    modelRole: 'decision',
    input: { objective: '提取登录需求' },
    responseSchema: structuredClone(record.manifest.outputSchema),
    toolPolicy: { allow: ['vision.find_element', 'document.read'] },
    skillPolicy: {
      allow: [
        {
          skillId: record.manifest.id,
          version: record.manifest.version,
          contentHash: record.manifest.contentHash,
        },
      ],
    },
    budgets: { maxDurationMs: 5_000, maxModelTurns: 3, maxToolCalls: 2, maxTokens: 500 },
  };
}

describe('Skills runtime', () => {
  it('loads an exact local package without exposing its filesystem source', () => {
    const root = mkdtempSync(join(tmpdir(), 'nebula-skills-'));
    directories.push(root);
    const record = skillRecord();
    writePackage(root, record);
    const store = repository();
    const runtime = new SkillRuntime(store);

    const catalog = runtime.loadFromDirectories([root], ['vision.find_element']);
    expect(catalog).toEqual([
      expect.objectContaining({
        skillId: record.manifest.id,
        version: record.manifest.version,
        contentHash: record.manifest.contentHash,
      }),
    ]);
    expect(JSON.stringify(catalog)).not.toContain(root);
    expect(JSON.stringify(catalog)).not.toContain(record.instructions);
    expect(store.getSkillVersion(record.manifest.id, record.manifest.version)).toMatchObject({
      sourceRef: `local:${record.manifest.id}/${record.manifest.version}`,
    });
  });

  it('rejects content drift and symbolic-link package paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'nebula-skills-'));
    const outside = mkdtempSync(join(tmpdir(), 'nebula-skills-outside-'));
    directories.push(root, outside);
    const record = skillRecord();
    const packageDirectory = writePackage(root, record);
    writeFileSync(join(packageDirectory, 'instructions.md'), '被篡改的指令');
    expect(() =>
      new SkillRuntime(repository()).loadFromDirectories([root], ['vision.find_element'])
    ).toThrow(
      'contentHash does not match'
    );

    rmSync(join(root, record.manifest.id), { recursive: true, force: true });
    const outsideSkill = join(outside, 'escape.skill');
    mkdirSync(outsideSkill, { recursive: true });
    symlinkSync(
      outsideSkill,
      join(root, 'escape.skill'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    expect(() =>
      new SkillRuntime(repository()).loadFromDirectories([root], ['vision.find_element'])
    ).toThrow(
      'only contain Skill directories'
    );
  });

  it('fails startup loading when a declared Skill tool is unavailable', () => {
    const root = mkdtempSync(join(tmpdir(), 'nebula-skills-'));
    directories.push(root);
    writePackage(root, skillRecord());
    expect(() => new SkillRuntime(repository()).loadFromDirectories([root], [])).toThrow(
      'requires unavailable tool pattern'
    );
  });

  it('pins schemas and narrows task tools and budgets to the current Skill', () => {
    const record = skillRecord();
    const runtime = new SkillRuntime(repository());
    runtime.register(record);
    const validated = validateCreateAgentTaskRequest(taskRequest(record));
    const prepared = runtime.prepareTask(validated.request);

    expect(prepared?.execution).toMatchObject({
      skillId: record.manifest.id,
      contentHash: record.manifest.contentHash,
      effectiveToolAllow: ['vision.find_element'],
      effectiveBudgets: { maxModelTurns: 1, maxToolCalls: 1, maxTokens: 100 },
    });
    expect(prepared?.policySha256).toMatch(/^[a-f0-9]{64}$/);

    const missingPermission = taskRequest(record);
    missingPermission.toolPolicy.allow = ['document.read'];
    expect(() =>
      runtime.prepareTask(validateCreateAgentTaskRequest(missingPermission).request)
    ).toThrow('outside the task allowlist');

    const mismatchedOutput = taskRequest(record);
    mismatchedOutput.responseSchema = {
      type: 'object',
      properties: { different: { type: 'boolean' } },
      required: ['different'],
      additionalProperties: false,
    };
    expect(() =>
      runtime.prepareTask(validateCreateAgentTaskRequest(mismatchedOutput).request)
    ).toThrow('outputSchema must match');
  });

  it('rejects filesystem, network and secret-capable tool namespaces by default', () => {
    const runtime = new SkillRuntime(repository());
    expect(() => runtime.register(skillRecord('读取任意文件。', ['filesystem.read']))).toThrow(
      'outside the v1 server policy'
    );
  });
});
