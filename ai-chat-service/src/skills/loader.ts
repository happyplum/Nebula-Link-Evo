import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { AgentTaskError } from '../agent-tasks/errors.js';
import type { SkillManifestV1, SkillVersionRecord } from '../agent-tasks/repository.js';

const MANIFEST_FILE = 'manifest.json';
const INSTRUCTIONS_FILE = 'instructions.md';
const MAX_FILE_BYTES = 256 * 1024;

export function loadSkillPackages(directories: readonly string[]): SkillVersionRecord[] {
  const records: SkillVersionRecord[] = [];
  const seenRoots = new Set<string>();
  const seenVersions = new Set<string>();

  for (const configuredDirectory of directories) {
    if (!configuredDirectory.trim()) continue;
    const configuredRoot = resolve(configuredDirectory);
    if (!existsSync(configuredRoot)) {
      throw new AgentTaskError('validation_failed', 'Configured Skill root does not exist');
    }
    const root = realpathSync.native(configuredRoot);
    if (!statSync(root).isDirectory()) {
      throw new AgentTaskError('validation_failed', 'Configured Skill root is not a directory');
    }
    if (seenRoots.has(root)) {
      throw new AgentTaskError('validation_failed', 'Configured Skill roots contain duplicates');
    }
    seenRoots.add(root);

    for (const skillEntry of readdirSync(root, { withFileTypes: true })) {
      assertDirectoryEntry(skillEntry, 'Skill root may only contain Skill directories');
      const skillDirectory = resolveWithin(root, skillEntry.name);
      for (const versionEntry of readdirSync(skillDirectory, { withFileTypes: true })) {
        assertDirectoryEntry(versionEntry, 'Skill directory may only contain version directories');
        const packageDirectory = resolveWithin(skillDirectory, versionEntry.name);
        assertWithin(root, packageDirectory);
        const entries = readdirSync(packageDirectory, { withFileTypes: true });
        const names = new Set(entries.map((entry) => entry.name));
        if (entries.length !== 2 || !names.has(MANIFEST_FILE) || !names.has(INSTRUCTIONS_FILE)) {
          throw new AgentTaskError(
            'validation_failed',
            'Skill version directory must contain only manifest.json and instructions.md'
          );
        }
        for (const entry of entries) {
          if (!entry.isFile() || entry.isSymbolicLink()) {
            throw new AgentTaskError(
              'validation_failed',
              'Skill package files must be regular files'
            );
          }
        }

        const manifestPath = resolveFileWithin(root, packageDirectory, MANIFEST_FILE);
        const instructionsPath = resolveFileWithin(root, packageDirectory, INSTRUCTIONS_FILE);
        const manifest = parseManifest(readBoundedText(manifestPath));
        const instructions = readBoundedText(instructionsPath);
        if (manifest.id !== skillEntry.name || manifest.version !== versionEntry.name) {
          throw new AgentTaskError(
            'validation_failed',
            'Skill manifest id/version must match its directory names'
          );
        }
        const key = skillVersionKey(manifest.id, manifest.version);
        if (seenVersions.has(key)) {
          throw new AgentTaskError('conflict', `Skill version ${key} is configured more than once`);
        }
        seenVersions.add(key);
        records.push({
          manifest,
          instructions,
          sourceRef: `local:${manifest.id}/${manifest.version}`,
          registeredAt: new Date().toISOString(),
        });
      }
    }
  }
  return records;
}

function assertDirectoryEntry(
  entry: { isDirectory(): boolean; isSymbolicLink(): boolean },
  message: string
): void {
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new AgentTaskError('validation_failed', message);
  }
}

function resolveWithin(parent: string, child: string): string {
  const path = realpathSync.native(resolve(parent, child));
  assertWithin(parent, path);
  return path;
}

function resolveFileWithin(root: string, parent: string, name: string): string {
  const candidate = resolve(parent, name);
  const metadata = lstatSync(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new AgentTaskError('validation_failed', 'Skill package files must be regular files');
  }
  const path = realpathSync.native(candidate);
  assertWithin(root, path);
  return path;
}

function assertWithin(root: string, target: string): void {
  const pathFromRoot = relative(root, target);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new AgentTaskError('validation_failed', 'Skill package path escapes its configured root');
  }
}

function readBoundedText(path: string): string {
  const metadata = statSync(path);
  if (metadata.size < 1 || metadata.size > MAX_FILE_BYTES) {
    throw new AgentTaskError('validation_failed', 'Skill package file size is invalid');
  }
  const value = readFileSync(path, 'utf8');
  if (!value.trim() || value.includes('\0')) {
    throw new AgentTaskError('validation_failed', 'Skill package text is invalid');
  }
  return value;
}

function parseManifest(text: string): SkillManifestV1 {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('not an object');
    }
    return value as SkillManifestV1;
  } catch (error) {
    throw new AgentTaskError(
      'validation_failed',
      'Skill manifest is not valid JSON',
      false,
      undefined,
      {
        cause: error,
      }
    );
  }
}

function skillVersionKey(skillId: string, version: string): string {
  return `${skillId}@${version}`;
}
