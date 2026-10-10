import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { afterEach, describe, expect, it } from 'vitest';
import {
  digestConfig,
  hashPackageTree,
  loadTrustedHarnessPlugins,
} from './trusted-plugin-loader.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(
  source = 'export default function (_ctx, config) { if (config.value !== "ok") throw new Error("bad config") }'
) {
  const root = await mkdtemp(join(tmpdir(), 'nebula-trusted-plugin-'));
  roots.push(root);
  const pluginRoot = join(root, 'node_modules', 'fixture-harness-plugin');
  await mkdir(pluginRoot, { recursive: true });
  const entry = join(pluginRoot, 'index.js');
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture-host', dependencies: { 'fixture-harness-plugin': '1.2.3' } })
  );
  await writeFile(
    join(pluginRoot, 'package.json'),
    JSON.stringify({
      name: 'fixture-harness-plugin',
      version: '1.2.3',
      type: 'module',
      exports: { '.': './index.js' },
      peerDependencies: {},
    })
  );
  await writeFile(entry, source);
  const config = { value: 'ok' };
  const lockPath = join(root, 'trusted-harness-plugins.lock.json');
  const lock = {
    schema: 'nebula.ai.trusted-harness-plugins/1.0',
    abi: { cordis: '4.0.1', deepseekHarness: '0.1.1-rc.2' },
    plugins: [
      {
        package: 'fixture-harness-plugin',
        version: '1.2.3',
        export: '.',
        entrySha256: createHash('sha256')
          .update(await readFile(entry))
          .digest('hex'),
        treeSha256: await hashPackageTree(pluginRoot),
        config,
        configSha256: digestConfig(config),
        peerClosure: {},
      },
    ],
    mcp: [],
  };
  await writeFile(lockPath, JSON.stringify(lock));
  return { root, pluginRoot, entry, lockPath, lock };
}

describe('trusted Harness plugin loader', () => {
  it('loads an exact direct dependency with matching entry, tree, config and ABI', async () => {
    const item = await fixture();
    const context = new Context();
    await expect(
      loadTrustedHarnessPlugins(context, {
        packageRoot: item.root,
        lockPath: item.lockPath,
        mcp: [],
      })
    ).resolves.toEqual(['fixture-harness-plugin@1.2.3']);
    await context.fiber.dispose();
  });

  it('fails startup when package integrity changes after the deployment lock was built', async () => {
    const item = await fixture();
    await writeFile(item.entry, 'export default function () {}\n');
    const context = new Context();
    await expect(
      loadTrustedHarnessPlugins(context, {
        packageRoot: item.root,
        lockPath: item.lockPath,
        mcp: [],
      })
    ).rejects.toThrow(/integrity mismatch/);
    await context.fiber.dispose();
  });

  it('fails startup when a required plugin throws during activation', async () => {
    const item = await fixture(
      'export default function () { throw new Error("activation failed") }'
    );
    const context = new Context();
    await expect(
      loadTrustedHarnessPlugins(context, {
        packageRoot: item.root,
        lockPath: item.lockPath,
        mcp: [],
      })
    ).rejects.toThrow('activation failed');
    await context.fiber.dispose();
  });

  it('rejects any runtime MCP composition not present in the deployment lock', async () => {
    const item = await fixture();
    const context = new Context();
    await expect(
      loadTrustedHarnessPlugins(context, {
        packageRoot: item.root,
        lockPath: item.lockPath,
        mcp: [
          {
            transport: 'streamable-http',
            serverName: 'remote',
            url: 'https://example.com/mcp',
            headers: {},
            toolCallTimeoutMs: 1_000,
            failOnStartupError: false,
          },
        ],
      })
    ).rejects.toThrow('composition differs');
    await context.fiber.dispose();
  });
});
