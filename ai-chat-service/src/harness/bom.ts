import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

interface HarnessBom {
  schema: string;
  node: string;
  roots: Record<string, string>;
  peerClosure: Record<string, string>;
  nativeBuilds: Record<string, string>;
  patches: Record<string, string>;
  licenses: { upstream: string; notice: string };
}

export async function verifyHarnessBom(packageRoot: string): Promise<void> {
  const bom = JSON.parse(await readFile(join(packageRoot, 'harness-bom.json'), 'utf8')) as HarnessBom;
  if (bom.schema !== 'nebula.ai.harness-bom/1.0') throw new Error('Unsupported Harness BOM schema');
  const service = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
    engines?: { node?: string };
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  if (service.engines?.node !== bom.node) throw new Error('Harness BOM Node constraint drifted');
  const declared = { ...service.dependencies, ...service.devDependencies };
  for (const [name, version] of Object.entries(bom.roots)) {
    if (declared[name] !== version) throw new Error(`Harness BOM root ${name} is not exactly pinned`);
  }

  const resolved = new Map<string, string>();
  const pending = await Promise.all(
    Object.keys(bom.roots).map(async (name) => ({
      name,
      packageJsonPath: await realpath(join(packageRoot, 'node_modules', ...name.split('/'), 'package.json')),
    }))
  );
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (resolved.has(current.name)) continue;
    const metadata = JSON.parse(await readFile(current.packageJsonPath, 'utf8')) as {
      name: string;
      version: string;
      license?: string;
      peerDependencies?: Record<string, string>;
    };
    if (metadata.name !== current.name || bom.peerClosure[current.name] !== metadata.version) {
      throw new Error(`Harness BOM installed identity mismatch for ${current.name}`);
    }
    if (metadata.license !== 'MIT') throw new Error(`Harness dependency ${current.name} is not MIT`);
    resolved.set(current.name, metadata.version);
    const requireFromPackage = createRequire(current.packageJsonPath);
    for (const peer of Object.keys(metadata.peerDependencies ?? {})) {
      const peerPackageJson = await resolvePackageJson(requireFromPackage, peer);
      const peerMetadata = JSON.parse(await readFile(peerPackageJson, 'utf8')) as {
        name: string;
        version: string;
      };
      if (bom.peerClosure[peer] !== peerMetadata.version) {
        throw new Error(`Harness BOM peer ${current.name} -> ${peer} drifted`);
      }
      pending.push({ name: peer, packageJsonPath: peerPackageJson });
    }
  }
  const unresolved = Object.keys(bom.peerClosure).filter((name) => !resolved.has(name));
  if (unresolved.length > 0) throw new Error(`Harness BOM contains unreachable peers: ${unresolved.join(', ')}`);

  const jsonlEntry = createRequire(join(packageRoot, 'package.json')).resolve(
    '@deepseek-ai/dsh-session-persistence-jsonl'
  );
  const jsonlRequire = createRequire(jsonlEntry);
  for (const [name, version] of Object.entries(bom.nativeBuilds)) {
    const packageJson = await resolvePackageJson(jsonlRequire, name);
    const installed = JSON.parse(await readFile(packageJson, 'utf8')) as { version: string };
    if (installed.version !== version) throw new Error(`Harness native dependency ${name} drifted`);
  }
  for (const [relativePath, expected] of Object.entries(bom.patches)) {
    const actual = createHash('sha256')
      .update(await readFile(join(packageRoot, relativePath)))
      .digest('hex');
    if (actual !== expected) throw new Error(`Harness patch ${relativePath} digest drifted`);
  }
  await readFile(join(packageRoot, bom.licenses.notice), 'utf8');
}

async function resolvePackageJson(requireFromPackage: NodeJS.Require, name: string): Promise<string> {
  try {
    return await realpath(requireFromPackage.resolve(`${name}/package.json`));
  } catch (error) {
    if (
      !error ||
      typeof error !== 'object' ||
      !('code' in error) ||
      !['ERR_PACKAGE_PATH_NOT_EXPORTED', 'MODULE_NOT_FOUND'].includes(String(error.code))
    ) {
      throw error;
    }
    const entry = await realpath(requireFromPackage.resolve(name));
    let current = dirname(entry);
    while (true) {
      try {
        const candidate = join(current, 'package.json');
        const metadata = JSON.parse(await readFile(candidate, 'utf8')) as { name?: string };
        if (metadata.name === name) return candidate;
      } catch (candidateError) {
        if (
          !candidateError ||
          typeof candidateError !== 'object' ||
          !('code' in candidateError) ||
          candidateError.code !== 'ENOENT'
        ) {
          throw candidateError;
        }
      }
      const parent = dirname(current);
      if (parent === current) throw new Error(`Cannot resolve package.json for ${name}`);
      current = parent;
    }
  }
}
