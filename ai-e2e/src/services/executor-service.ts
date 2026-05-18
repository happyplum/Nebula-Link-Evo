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
const DEFAULT_TIMEOUT_MS = 300_000;

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

export class ExecutorService {
  private activeProcesses = new Map<string, ChildProcess>();

  constructor(
    private scriptRepo: ScriptRepository,
    private runRepo: ExecutionRunRepository,
  ) {}

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

    const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
    let stdout = '';
    let stderr = '';
    let killed = false;

    return new Promise<ExecutionResult>((resolve) => {
      const cp = spawn('npx', ['tsx', scriptPath], {
        env: {
          ...process.env,
          PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
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
