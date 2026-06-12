/**
 * Executor Service
 *
 * Manages script execution lifecycle: load script → write temp file →
 * child_process spawn → capture results → collect artifacts.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ScriptRepository } from '../database/repositories/script-repository.js';
import type { ExecutionRunRepository, ExecutionRun } from '../database/repositories/execution-run-repository.js';

/** Default execution timeout: 5 minutes */
export const DEFAULT_TIMEOUT_MS = 300_000;

/** Artifacts base directory relative to ai-e2e root */
const ARTIFACTS_DIR = join(process.cwd(), 'artifacts');

/**
 * Temp script directory — uses OS temp to avoid spaces in project path
 * (e.g. "D:\Work\Nebula-Link Evo" breaks tsx ESM resolution).
 */
const SCRIPTS_TMP_DIR = join(tmpdir(), 'ai-e2e', 'scripts');

export interface ExecutionResult {
  runId: string;
  status: ExecutionRun['status'];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface ArtifactsInfo {
  baseDir: string;
  screenshots: string[];
  traces: string[];
  logs: string[];
}

export interface ExecuteOptions {
  timeout?: number;
}

export interface ExecutorServiceOptions {
  /** Default per-execution timeout in ms (falls back to DEFAULT_TIMEOUT_MS). */
  defaultTimeout?: number;
  /** Maximum number of concurrent executions. Default: 1 (serial, backward compatible). */
  maxConcurrency?: number;
}

/**
 * Simple semaphore for limiting concurrency.
 * No external dependencies — just a counter + FIFO wait queue.
 * When a slot is immediately available, tryAcquire() succeeds synchronously
 * so callers can keep the fast path non-async.
 */
class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(maxConcurrency: number) {
    this.available = Math.max(1, Math.floor(maxConcurrency));
  }

  /** Synchronously acquire a slot if available. Returns true on success. */
  tryAcquire(): boolean {
    if (this.available > 0) {
      this.available--;
      return true;
    }
    return false;
  }

  /** Asynchronously wait for a slot. Only call after tryAcquire() returned false. */
  waitForSlot(): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand the slot directly to the next waiter without incrementing.
      next();
    } else {
      this.available++;
    }
  }
}

export class ExecutorService {
  private activeProcesses = new Map<string, ChildProcess>();
  private readonly defaultTimeout: number;
  private readonly semaphore: Semaphore;

  constructor(
    private scriptRepo: ScriptRepository,
    private runRepo: ExecutionRunRepository,
    options?: ExecutorServiceOptions,
  ) {
    this.defaultTimeout = options?.defaultTimeout ?? DEFAULT_TIMEOUT_MS;
    this.semaphore = new Semaphore(options?.maxConcurrency ?? 1);
  }

  /**
   * Execute a script by ID.
   *
   * Loads the script from DB, writes it to a temp file, spawns `npx tsx`,
   * captures stdout/stderr, and creates an ExecutionRun record.
   */
  executeScript(scriptId: string, options?: ExecuteOptions): Promise<ExecutionResult> {
    const script = this.scriptRepo.findById(scriptId);
    if (!script) {
      throw new Error(`Script not found: ${scriptId}`);
    }

    const runWithSlot = (): Promise<ExecutionResult> =>
      this.spawnScript(script, options).finally(() => this.semaphore.release());

    // Fast path: slot available → spawn synchronously (preserves original timing)
    if (this.semaphore.tryAcquire()) {
      return runWithSlot();
    }

    // Slow path: all slots busy → wait in queue
    return this.semaphore.waitForSlot().then(runWithSlot);
  }

  /**
   * Core spawn lifecycle — assumes a concurrency slot has already been acquired.
   * The caller is responsible for releasing the semaphore via the returned
   * promise's finally chain.
   */
  private spawnScript(
    script: { id: string; version: number; content: string },
    options?: ExecuteOptions,
  ): Promise<ExecutionResult> {
    // Create execution run record
    const run = this.runRepo.create({
      script_id: script.id,
      script_version: script.version,
      status: 'running',
    });

    const runId = run.id;
    const runDir = join(ARTIFACTS_DIR, runId);
    const scriptPath = join(SCRIPTS_TMP_DIR, `${runId}.ts`);

    // Ensure directories exist
    mkdirSync(runDir, { recursive: true });
    mkdirSync(SCRIPTS_TMP_DIR, { recursive: true });

    // Write script content to temp file
    writeFileSync(scriptPath, script.content, 'utf-8');

    const timeout = options?.timeout ?? this.defaultTimeout;
    let stdout = '';
    let stderr = '';
    let killed = false;

    return new Promise<ExecutionResult>((resolve) => {
      // Use platform-specific npx binary directly (no shell) to avoid
      // shell injection and quoting issues. SCRIPTS_TMP_DIR is under
      // the OS temp directory so there are no spaces in the path.
      const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      const cp = spawn(npxBin, ['tsx', scriptPath], {
        env: {
          ...process.env,
          PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.activeProcesses.set(runId, cp);

      cp.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      cp.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Timeout handling
      const timer = setTimeout(() => {
        killed = true;
        cp.kill('SIGTERM');
      }, timeout);

      cp.on('exit', (code, signal) => {
        clearTimeout(timer);
        this.activeProcesses.delete(runId);

        // Determine status from exit code / signal
        let status: ExecutionRun['status'];
        if (killed || (code === null && signal !== null)) {
          status = 'timeout';
        } else if (code === 0) {
          status = 'pass';
        } else if (code === 1) {
          status = 'fail';
        } else {
          status = 'error';
        }

        // Update run record
        this.runRepo.update(runId, {
          status,
          completed_at: new Date().toISOString(),
          logs: stdout + (stderr ? '\n--- STDERR ---\n' + stderr : ''),
          error_message: stderr || (status !== 'pass' ? `Process exited with code ${code}` : undefined),
        });

        resolve({
          runId,
          status,
          exitCode: code,
          signal: signal as NodeJS.Signals | null,
          stdout,
          stderr,
        });
      });

      cp.on('error', (err) => {
        clearTimeout(timer);
        this.activeProcesses.delete(runId);

        this.runRepo.update(runId, {
          status: 'error',
          completed_at: new Date().toISOString(),
          error_message: err.message,
        });

        resolve({
          runId,
          status: 'error',
          exitCode: null,
          signal: null,
          stdout,
          stderr: err.message,
        });
      });
    });
  }

  /**
   * Get the execution result for a given run ID.
   */
  getExecutionResult(runId: string): ExecutionRun | null {
    return this.runRepo.findById(runId);
  }

  /**
   * Cancel a running execution.
   *
   * Kills the child process and updates the run status.
   */
  cancelExecution(runId: string): boolean {
    const cp = this.activeProcesses.get(runId);
    if (!cp) {
      return false;
    }

    cp.kill('SIGTERM');
    this.activeProcesses.delete(runId);

    this.runRepo.update(runId, {
      status: 'timeout',
      completed_at: new Date().toISOString(),
      error_message: 'Execution cancelled by user',
    });

    return true;
  }

  /**
   * Get artifact paths for a given run.
   */
  getArtifacts(runId: string): ArtifactsInfo {
    const baseDir = join(ARTIFACTS_DIR, runId);

    const listFiles = (subDir: string): string[] => {
      const dir = join(baseDir, subDir);
      if (!existsSync(dir)) return [];
      try {
        return readdirSync(dir).map((f) => join(dir, f));
      } catch {
        return [];
      }
    };

    return {
      baseDir,
      screenshots: listFiles('screenshots'),
      traces: listFiles('traces'),
      logs: listFiles('logs'),
    };
  }
}
