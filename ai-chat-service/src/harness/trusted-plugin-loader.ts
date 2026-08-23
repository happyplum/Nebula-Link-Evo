import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Context } from '@deepseek-ai/cordis';
import type { Config as DshMcpConfig } from '@deepseek-ai/dsh-mcp-client';

const SUPPORTED_ABI = Object.freeze({
  cordis: '4.0.1',
  deepseekHarness: '0.1.1-rc.2',
});
const SECRET_KEY = /(?:api.?key|authorization|credential|password|secret|token)/i;

export interface TrustedHarnessPluginLock {
  schema: 'nebula.ai.trusted-harness-plugins/1.0';
  abi: typeof SUPPORTED_ABI;
  plugins: TrustedHarnessPluginEntry[];
  mcp: TrustedMcpEntry[];
}

export interface TrustedHarnessPluginEntry {
  package: string;
  version: string;
  export: string;
  exportName?: string;
  entrySha256: string;
  treeSha256: string;
  config: unknown;
  configSha256: string;
  peerClosure: Record<string, string>;
}

export type TrustedMcpEntry =
  | {
      transport: 'stdio';
      serverName: string;
      command: string;
      args: string[];
      cwd: string;
      env: Record<string, string>;
    }
  | {
      transport: 'streamable-http';
      serverName: string;
      url: string;
      headers: Record<string, string>;
    };

export interface TrustedPluginLoaderOptions {
  packageRoot: string;
  lockPath: string;
  mcp: readonly DshMcpConfig[];
  env?: Readonly<Record<string, string | undefined>>;
}

/** Loads only deployment-locked, direct-dependency Cordis plugins. */
export async function loadTrustedHarnessPlugins(
  context: Context,
  options: TrustedPluginLoaderOptions
): Promise<readonly string[]> {
  const lock = parseLock(JSON.parse(await readFile(options.lockPath, 'utf8')));
  assertMcpLock(lock.mcp, options.mcp, options.env ?? process.env);
  const servicePackage = parsePackageJson(
    JSON.parse(await readFile(join(options.packageRoot, 'package.json'), 'utf8')),
    'service package.json'
  );
  const dependencies = servicePackage.dependencies ?? {};
  const serviceRequire = createRequire(join(options.packageRoot, 'package.json'));
  const loaded: string[] = [];

  for (const plugin of lock.plugins) {
    if (dependencies[plugin.package] !== plugin.version) {
      throw new Error(
        `Trusted Harness plugin ${plugin.package} must be an exact installed direct dependency ${plugin.version}`
      );
    }
    assertNoSecrets(plugin.config, `plugins.${plugin.package}.config`);
    if (digestConfig(plugin.config) !== plugin.configSha256) {
      throw new Error(`Trusted Harness plugin ${plugin.package} config digest mismatch`);
    }
    const specifier =
      plugin.export === '.'
        ? plugin.package
        : `${plugin.package}/${plugin.export.replace(/^\.\//, '')}`;
    const resolvedEntry = await realpath(serviceRequire.resolve(specifier));
    const packageRoot = await findPackageRoot(resolvedEntry, plugin.package);
    const packageJson = parsePackageJson(
      JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')),
      plugin.package
    );
    if (packageJson.name !== plugin.package || packageJson.version !== plugin.version) {
      throw new Error(`Trusted Harness plugin ${plugin.package} installed package identity mismatch`);
    }
    assertWithin(packageRoot, resolvedEntry, `plugin entry ${plugin.package}`);
    if ((await hashFile(resolvedEntry)) !== plugin.entrySha256) {
      throw new Error(`Trusted Harness plugin ${plugin.package} entry integrity mismatch`);
    }
    if ((await hashPackageTree(packageRoot)) !== plugin.treeSha256) {
      throw new Error(`Trusted Harness plugin ${plugin.package} package tree integrity mismatch`);
    }
    await assertPeerClosure(serviceRequire, packageJson.peerDependencies ?? {}, plugin.peerClosure);

    const imported = (await import(pathToFileURL(resolvedEntry).href)) as Record<string, unknown>;
    const cordisPlugin = plugin.exportName
      ? imported[plugin.exportName]
      : (imported.default ?? imported);
    if (!isCordisPlugin(cordisPlugin)) {
      throw new Error(`Trusted Harness plugin ${plugin.package} export is not a Cordis plugin`);
    }
    await context.plugin(cordisPlugin as never, plugin.config as never);
    loaded.push(`${plugin.package}@${plugin.version}`);
  }
  return Object.freeze(loaded);
}

export function digestConfig(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export async function hashPackageTree(packageRoot: string): Promise<string> {
  const canonicalRoot = await realpath(packageRoot);
  const files: Array<{ path: string; hash: string }> = [];
  const pending = [canonicalRoot];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const path = join(current, entry.name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) throw new Error(`Trusted plugin package refuses symlink ${path}`);
      if (stat.isDirectory()) {
        pending.push(path);
      } else if (stat.isFile()) {
        files.push({
          path: relative(canonicalRoot, path).split(sep).join('/'),
          hash: await hashFile(path),
        });
      } else {
        throw new Error(`Trusted plugin package refuses special file ${path}`);
      }
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return createHash('sha256').update(canonicalJson(files)).digest('hex');
}

function parseLock(value: unknown): TrustedHarnessPluginLock {
  if (!isRecord(value) || value.schema !== 'nebula.ai.trusted-harness-plugins/1.0') {
    throw new Error('Trusted Harness plugin lock has an unsupported schema');
  }
  if (!isRecord(value.abi) || value.abi.cordis !== SUPPORTED_ABI.cordis) {
    throw new Error(`Trusted Harness plugin lock requires Cordis ${SUPPORTED_ABI.cordis}`);
  }
  if (value.abi.deepseekHarness !== SUPPORTED_ABI.deepseekHarness) {
    throw new Error(
      `Trusted Harness plugin lock requires DeepSeek Harness ${SUPPORTED_ABI.deepseekHarness}`
    );
  }
  if (!Array.isArray(value.plugins) || !Array.isArray(value.mcp)) {
    throw new Error('Trusted Harness plugin lock plugins and mcp must be arrays');
  }
  const plugins = value.plugins.map(parsePluginEntry);
  const packages = new Set<string>();
  for (const plugin of plugins) {
    if (packages.has(plugin.package)) throw new Error(`Duplicate trusted plugin ${plugin.package}`);
    packages.add(plugin.package);
  }
  return {
    schema: value.schema,
    abi: SUPPORTED_ABI,
    plugins,
    mcp: value.mcp.map(parseMcpEntry),
  };
}

function parsePluginEntry(value: unknown): TrustedHarnessPluginEntry {
  if (!isRecord(value)) throw new Error('Trusted Harness plugin entry must be an object');
  for (const field of [
    'package',
    'version',
    'export',
    'entrySha256',
    'treeSha256',
    'configSha256',
  ]) {
    if (typeof value[field] !== 'string' || value[field].length === 0) {
      throw new Error(`Trusted Harness plugin entry requires ${field}`);
    }
  }
  if (value.exportName !== undefined && typeof value.exportName !== 'string') {
    throw new Error('Trusted Harness plugin exportName must be a string');
  }
  if (!isRecord(value.peerClosure)) {
    throw new Error('Trusted Harness plugin peerClosure must be an object');
  }
  return value as unknown as TrustedHarnessPluginEntry;
}

function parseMcpEntry(value: unknown): TrustedMcpEntry {
  if (!isRecord(value) || typeof value.serverName !== 'string') {
    throw new Error('Trusted MCP lock entry is invalid');
  }
  if (value.transport === 'stdio') {
    if (
      typeof value.command !== 'string' ||
      !Array.isArray(value.args) ||
      !value.args.every((item) => typeof item === 'string') ||
      typeof value.cwd !== 'string' ||
      !isStringRecord(value.env)
    ) {
      throw new Error(`Trusted stdio MCP ${value.serverName} lock entry is invalid`);
    }
    assertEnvironmentBindings(value.env, `mcp.${value.serverName}.env`);
    return value as unknown as TrustedMcpEntry;
  }
  if (
    value.transport !== 'streamable-http' ||
    typeof value.url !== 'string' ||
    !isStringRecord(value.headers)
  ) {
    throw new Error(`Trusted remote MCP ${value.serverName} lock entry is invalid`);
  }
  assertEnvironmentBindings(value.headers, `mcp.${value.serverName}.headers`);
  return value as unknown as TrustedMcpEntry;
}

function assertMcpLock(
  lock: readonly TrustedMcpEntry[],
  runtime: readonly DshMcpConfig[],
  env: Readonly<Record<string, string | undefined>>
): void {
  const expected = new Map(
    lock.map((entry) => [entry.serverName, canonicalJson(resolveMcpLockEntry(entry, env))])
  );
  if (expected.size !== lock.length) throw new Error('Trusted MCP lock contains duplicate server names');
  if (runtime.length !== lock.length) throw new Error('Runtime MCP composition differs from trusted lock');
  for (const server of runtime) {
    const locked =
      server.transport === 'stdio'
        ? {
            transport: server.transport,
            serverName: server.serverName,
            command: server.command,
            args: server.args,
            cwd: resolve(server.cwd),
            env: server.env,
          }
        : {
            transport: server.transport,
            serverName: server.serverName,
            url: new URL(server.url).toString(),
            headers: server.headers,
          };
    if (expected.get(server.serverName) !== canonicalJson(locked)) {
      throw new Error(`Runtime MCP ${server.serverName} differs from trusted deployment lock`);
    }
  }
}

async function assertPeerClosure(
  serviceRequire: NodeJS.Require,
  declaredPeers: Record<string, string>,
  lockedPeers: Record<string, string>
): Promise<void> {
  const declaredNames = Object.keys(declaredPeers).sort();
  if (canonicalJson(declaredNames) !== canonicalJson(Object.keys(lockedPeers).sort())) {
    throw new Error('Trusted Harness plugin peer closure does not match package peerDependencies');
  }
  for (const peer of declaredNames) {
    const peerEntry = await realpath(serviceRequire.resolve(peer));
    const peerRoot = await findPackageRoot(peerEntry, peer);
    const peerPackage = parsePackageJson(
      JSON.parse(await readFile(join(peerRoot, 'package.json'), 'utf8')),
      peer
    );
    if (peerPackage.version !== lockedPeers[peer]) {
      throw new Error(`Trusted Harness plugin peer ${peer} exact version mismatch`);
    }
  }
}

async function findPackageRoot(entry: string, expectedName: string): Promise<string> {
  let current = dirname(entry);
  while (true) {
    try {
      const parsed = JSON.parse(await readFile(join(current, 'package.json'), 'utf8')) as unknown;
      if (isRecord(parsed) && parsed.name === expectedName) return realpath(current);
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
        throw error;
      }
    }
    const parent = dirname(current);
    if (parent === current) throw new Error(`Cannot locate installed package root for ${expectedName}`);
    current = parent;
  }
}

function parsePackageJson(value: unknown, label: string): {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  for (const field of ['dependencies', 'peerDependencies']) {
    if (value[field] !== undefined && !isStringRecord(value[field])) {
      throw new Error(`${label} ${field} must be a string record`);
    }
  }
  return value;
}

function assertNoSecrets(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      const isEnvironmentBinding =
        key.endsWith('Env') && typeof nested === 'string' && /^[A-Z_][A-Z0-9_]*$/u.test(nested);
      if (!isEnvironmentBinding) {
        throw new Error(`${path}.${key} may contain a secret and cannot be locked`);
      }
    }
    assertNoSecrets(nested, `${path}.${key}`);
  }
}

function assertEnvironmentBindings(values: Record<string, string>, path: string): void {
  for (const [key, value] of Object.entries(values)) {
    if (!/^\{[A-Za-z_][A-Za-z0-9_]*\}$/u.test(value)) {
      throw new Error(`${path}.${key} must be an environment binding, not a locked value`);
    }
  }
}

function resolveMcpLockEntry(
  entry: TrustedMcpEntry,
  env: Readonly<Record<string, string | undefined>>
): TrustedMcpEntry {
  const resolveBindings = (values: Record<string, string>): Record<string, string> =>
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => {
        const name = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/u.exec(value)?.[1];
        if (!name || !env[name]) {
          throw new Error(`Trusted MCP ${entry.serverName} environment binding ${value} is unavailable`);
        }
        return [key, env[name]!];
      })
    );
  return entry.transport === 'stdio'
    ? { ...entry, cwd: resolve(entry.cwd), env: resolveBindings(entry.env) }
    : { ...entry, url: new URL(entry.url).toString(), headers: resolveBindings(entry.headers) };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`).join(',')}}`;
}

function isCordisPlugin(value: unknown): boolean {
  return (
    typeof value === 'function' ||
    (isRecord(value) && (typeof value.apply === 'function' || typeof value.default === 'function'))
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

async function hashFile(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function assertWithin(root: string, target: string, label: string): void {
  const child = relative(root, target);
  if (child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child))) {
    return;
  }
  throw new Error(`${label} escapes its installed package root`);
}
