import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { withE2EResources } from './e2e-process-lifecycle.mjs';

const workspaceRoot = fileURLToPath(new URL('..', import.meta.url));
const sleeper = 'setInterval(() => {}, 1000)';
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('all ai-e2e runtime stores stay inside the run root', async () => {
  await withE2EResources({ workspaceRoot, name: 'config-test' }, async (scope) => {
    const environment = {
      NEBULA_E2E_RUN_ROOT: scope.root,
      AI_E2E_UI_PACKAGE_DIR: join(workspaceRoot, 'ai-e2e/ui'),
      AI_E2E_UI_TEST_PORT: '54321',
      AI_E2E_UI_TEST_DB_PATH: join(scope.root, 'ai-e2e.sqlite'),
    };
    const previous = Object.fromEntries(
      Object.keys(environment).map((key) => [key, process.env[key]])
    );
    Object.assign(process.env, environment);
    try {
      const { default: config } = await import('../ai-e2e/ui/playwright.config.ts');
      assert.equal(config.webServer.env.AI_E2E_DB_PATH, join(scope.root, 'ai-e2e.sqlite'));
      assert.equal(
        config.webServer.env.AI_E2E_EVIDENCE_PATH,
        join(scope.root, 'semantic-evidence')
      );
      assert.equal(
        config.webServer.env.AI_E2E_SECRET_STORE_PATH,
        join(scope.root, 'semantic-secrets')
      );
      assert.equal(config.outputDir, join(scope.root, 'test-results'));
      assert.equal(config.webServer.cwd, join(workspaceRoot, 'ai-e2e/ui'));
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

for (const failure of ['first service', 'second service', 'spawn error', 'nonzero exit']) {
  test(`${failure} preserves the error and removes owned resources`, async () => {
    let root;
    const pids = [];
    const marker = new Error(failure);
    await assert.rejects(
      withE2EResources({ workspaceRoot, name: 'lifecycle-test' }, async (scope) => {
        root = scope.root;
        if (failure !== 'first service')
          pids.push(scope.spawn(process.execPath, ['-e', sleeper]).pid);
        if (failure === 'spawn error') {
          await scope.waitForExit(scope.spawn(join(root, 'missing-executable'), []));
        } else if (failure === 'nonzero exit') {
          assert.equal(
            await scope.waitForExit(scope.spawn(process.execPath, ['-e', 'process.exit(7)'])),
            7
          );
          throw marker;
        } else {
          assert.equal(
            await scope.waitForExit(scope.spawn(process.execPath, ['-e', 'process.exit(1)'])),
            1
          );
          throw marker;
        }
      }),
      failure === 'spawn error' ? /ENOENT/ : (error) => error === marker
    );
    await assert.rejects(access(root));
    assert.ok(pids.every((pid) => !alive(pid)));
  });
}

test('cleanup is idempotent and stops only owned children and their descendants', async () => {
  const unrelated = spawn(process.execPath, ['-e', sleeper], { windowsHide: true });
  let root;
  let childPid;
  let grandchildPid;
  try {
    await withE2EResources({ workspaceRoot, name: 'lifecycle-test' }, async (scope) => {
      root = scope.root;
      const child = scope.spawn(
        process.execPath,
        [
          '-e',
          `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e',${JSON.stringify(sleeper)}],{stdio:'ignore'}); console.log(child.pid); ${sleeper}`,
        ],
        { stdio: ['ignore', 'pipe', 'inherit'] }
      );
      childPid = child.pid;
      grandchildPid = await scope.wait(
        new Promise((resolve) =>
          child.stdout.once('data', (data) => resolve(Number(String(data).trim())))
        )
      );
      await scope.cleanup();
      await scope.cleanup();
      assert.equal(alive(childPid), false);
      assert.equal(alive(grandchildPid), false);
      assert.equal(alive(unrelated.pid), true);
    });
    await assert.rejects(access(root));
  } finally {
    const exited = new Promise((resolve) => unrelated.once('exit', resolve));
    unrelated.kill();
    await exited;
  }
});

test('descendants are collected even when their parent exits first', async () => {
  let descendantPid;
  await withE2EResources({ workspaceRoot, name: 'lifecycle-test' }, async (scope) => {
    const child = scope.spawn(
      process.execPath,
      [
        '-e',
        `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e',${JSON.stringify(sleeper)}],{stdio:'ignore'}); console.log(child.pid); child.unref();`,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] }
    );
    descendantPid = await scope.wait(
      new Promise((resolve) =>
        child.stdout.once('data', (data) => resolve(Number(String(data).trim())))
      )
    );
    assert.equal(await scope.waitForExit(child), 0);
  });
  assert.equal(alive(descendantPid), false);
});

test('directory cleanup removes a junction without following it', async () => {
  await withE2EResources({ workspaceRoot, name: 'lifecycle-test' }, async (outside) => {
    const sentinel = join(outside.root, 'sentinel');
    await writeFile(sentinel, 'keep');
    await withE2EResources({ workspaceRoot, name: 'lifecycle-test' }, async (inside) => {
      await symlink(
        outside.root,
        join(inside.root, 'link'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
    });
    assert.equal(await readFile(sentinel, 'utf8'), 'keep');
  });
});

test('cleanup refuses a replaced root and keeps the primary error', async () => {
  await withE2EResources({ workspaceRoot, name: 'lifecycle-test' }, async (outside) => {
    const sentinel = join(outside.root, 'sentinel');
    await writeFile(sentinel, 'keep');
    const marker = new Error('primary startup failure');
    await assert.rejects(
      withE2EResources(
        { workspaceRoot, parentRoot: outside.root, name: 'replaced-root' },
        async (inside) => {
          // Both directories were created by this test. Replacing the owned empty
          // root with a junction must never make cleanup traverse the other owner.
          const { rm } = await import('node:fs/promises');
          await rm(inside.root, { recursive: true });
          await symlink(
            outside.root,
            inside.root,
            process.platform === 'win32' ? 'junction' : 'dir'
          );
          throw marker;
        }
      ),
      (error) =>
        error instanceof AggregateError &&
        error.errors[0] === marker &&
        /redirected path/u.test(error.errors[1].message)
    );
    assert.equal(await readFile(sentinel, 'utf8'), 'keep');
  });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`${signal} handler interrupts startup and cleans its process tree`, async () => {
    await withE2EResources({ workspaceRoot, name: 'lifecycle-test' }, async (outer) => {
      const fixture = join(outer.root, 'interrupt.mjs');
      await mkdir(join(outer.root, 'unused'));
      await writeFile(
        fixture,
        `import {withE2EResources} from ${JSON.stringify(new URL('./e2e-process-lifecycle.mjs', import.meta.url).href)};
try { await withE2EResources({workspaceRoot:${JSON.stringify(workspaceRoot)},name:'interrupt-test'},async scope=>{
const child=scope.spawn(process.execPath,['-e',${JSON.stringify(sleeper)}]);
console.log(JSON.stringify({root:scope.root,pid:child.pid}));
setTimeout(()=>process.emit('${signal}'),100);
await scope.wait(new Promise(()=>{}));
}); } catch(error) { console.error(error.message); process.exitCode=1; }`
      );
      const child = outer.spawn(process.execPath, [fixture], { stdio: ['ignore', 'pipe', 'pipe'] });
      const metadata = await outer.wait(
        new Promise((resolve) => {
          let output = '';
          child.stdout.on('data', (chunk) => {
            output += String(chunk);
            const line = output.split(/\r?\n/u).find((item) => item.startsWith('{'));
            if (line) resolve(JSON.parse(line));
          });
        })
      );
      assert.equal(await outer.waitForExit(child), 1);
      assert.equal(alive(metadata.pid), false);
      await assert.rejects(access(metadata.root));
    });
  });
}
