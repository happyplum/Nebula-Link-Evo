import { execFile, spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

// Each launcher owns one directory and the exact child processes it spawned.
export async function withE2EResources(options, run) {
  const workspace = await realpath(options.workspaceRoot);
  const temporary = join(workspace, '.tmp');
  await mkdir(temporary, { recursive: true });
  await assertDirectory(temporary);
  const parent = options.parentRoot ? resolve(options.parentRoot) : temporary;
  if (options.parentRoot) {
    assertWithin(temporary, parent);
    await assertDirectory(parent);
  }
  const root = await mkdtemp(join(parent, `${options.name}-`));
  const children = [];
  const controller = new AbortController();
  const interrupt = (signal) => controller.abort(new Error(`E2E interrupted by ${signal}`));
  const signals = ['SIGINT', 'SIGTERM'].map((signal) => {
    const listener = () => interrupt(signal);
    process.once(signal, listener);
    return [signal, listener];
  });
  let cleanup;
  const scope = {
    root,
    signal: controller.signal,
    spawn(command, args, spawnOptions = {}) {
      controller.signal.throwIfAborted();
      const child = spawn(command, args, {
        ...spawnOptions,
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
      const record = { child, started: Date.now(), descendants: Promise.resolve([]) };
      record.exited = new Promise((done) => {
        child.once('error', (error) => done({ error }));
        child.once('exit', (code, signal) => {
          if (process.platform === 'win32' && child.pid && !record.stopping) {
            // Windows keeps ParentProcessId after the parent exits. Capture the
            // surviving descendants before that PID could be reused.
            record.descendants = windowsTree(record).catch((error) => ({ error }));
          }
          done({ code: signal ? 1 : (code ?? 1) });
        });
      });
      children.push(record);
      if (child.pid) console.log(`[E2E] owned PID ${child.pid}`);
      return child;
    },
    async wait(promise) {
      controller.signal.throwIfAborted();
      let onAbort;
      const interrupted = new Promise((_, reject) => {
        onAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      try {
        return await Promise.race([promise, interrupted]);
      } finally {
        controller.signal.removeEventListener('abort', onAbort);
      }
    },
    async waitForExit(child) {
      const record = children.find((item) => item.child === child);
      if (!record) throw new Error('Cannot wait for an unowned E2E process');
      const result = await scope.wait(record.exited);
      if (result.error) throw result.error;
      return result.code;
    },
    cleanup() {
      cleanup ??= (async () => {
        const errors = [];
        for (const record of children.toReversed()) {
          try {
            await stopOwnedTree(record);
          } catch (error) {
            errors.push(error);
          }
        }
        // Retain evidence if any process could still be writing to the root.
        if (errors.length) throw new AggregateError(errors, 'E2E process cleanup failed');
        assertWithin(parent, root);
        await assertDirectory(parent);
        await assertDirectory(root);
        await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      })();
      return cleanup;
    },
  };
  console.log(`[E2E] run root ${root}`);
  let result;
  let failure;
  try {
    result = await run(scope);
  } catch (error) {
    failure = error;
  } finally {
    try {
      await scope.cleanup();
    } catch (error) {
      failure = failure
        ? new AggregateError([failure, error], 'E2E failed and cleanup failed')
        : error;
    }
    for (const [signal, listener] of signals) process.off(signal, listener);
  }
  if (failure) throw failure;
  return result;
}

function assertWithin(parent, target) {
  const path = relative(parent, target);
  if (
    !isAbsolute(target) ||
    !path ||
    path === '..' ||
    path.startsWith(`..${sep}`) ||
    isAbsolute(path)
  ) {
    throw new Error(`Refusing E2E cleanup outside its owner: ${target}`);
  }
}

async function assertDirectory(path) {
  const stat = await lstat(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    resolve(await realpath(path)) !== resolve(path)
  ) {
    throw new Error(`Refusing E2E directory with a redirected path: ${path}`);
  }
}

async function windowsProcesses() {
  const { stdout } = await execute(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,@{Name="Created";Expression={$_.CreationDate.ToUniversalTime().Ticks.ToString()}} | ConvertTo-Json -Compress',
    ],
    { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
  );
  const parsed = JSON.parse(stdout || '[]');
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function windowsTree(record) {
  const exitedBeforeQuery = record.child.exitCode !== null || record.child.signalCode !== null;
  const processes = await windowsProcesses();
  const root = processes.find((item) => item.ProcessId === record.child.pid);
  // Once Node observed exit, an existing process with that PID is a replacement.
  if (root && exitedBeforeQuery) return [];
  const earliest = BigInt(record.started - 2_000) * 10_000n + 621355968000000000n;
  if (root && BigInt(root.Created) < earliest) return [];
  const owned = root ? [root] : [];
  const parents = new Map([[record.child.pid, root ? BigInt(root.Created) : earliest]]);
  for (let changed = true; changed;) {
    changed = false;
    for (const item of processes) {
      const parentBirth = parents.get(item.ParentProcessId);
      if (
        !parents.has(item.ProcessId) &&
        parentBirth !== undefined &&
        BigInt(item.Created) >= parentBirth
      ) {
        parents.set(item.ProcessId, BigInt(item.Created));
        owned.push(item);
        changed = true;
      }
    }
  }
  return owned;
}

async function stopOwnedTree(record) {
  const { child } = record;
  if (!child.pid) return;
  record.stopping = true;
  if (process.platform === 'win32') {
    const captured = await record.descendants;
    if (captured.error) throw captured.error;
    const owned = new Map(
      [...captured, ...(await windowsTree(record))].map((item) => [item.ProcessId, item])
    );
    const current = await windowsProcesses();
    for (const item of [...owned.values()].toReversed()) {
      if (
        !current.some((live) => live.ProcessId === item.ProcessId && live.Created === item.Created)
      )
        continue;
      try {
        await execute('taskkill.exe', ['/PID', String(item.ProcessId), '/T', '/F'], {
          windowsHide: true,
        });
      } catch (error) {
        if (isAlive(item.ProcessId))
          throw new Error(`Failed to stop owned E2E PID ${item.ProcessId}`, { cause: error });
      }
    }
    await waitUntilStopped([...owned.keys()]);
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    for (let attempt = 0; attempt < 50 && isAlive(-child.pid); attempt++) await delay(100);
    if (isAlive(-child.pid)) process.kill(-child.pid, 'SIGKILL');
    await waitUntilStopped([-child.pid]);
  }
  await record.exited;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitUntilStopped(pids) {
  const deadline = Date.now() + 10_000;
  while (pids.some(isAlive)) {
    if (Date.now() >= deadline)
      throw new Error(`Owned E2E PIDs did not exit: ${pids.filter(isAlive).join(', ')}`);
    await delay(50);
  }
}
