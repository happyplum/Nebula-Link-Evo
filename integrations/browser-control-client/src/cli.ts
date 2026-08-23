#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as processStdin, stdout as processStdout } from 'node:process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type {
  BrowserExecutionCredentials,
  BrowserOperationRequestV1,
  CreateBrowserLeaseRequest,
} from '@nebula-link-evo/shared/types/browser-execution';
import { BrowserControlClient } from './client.js';
import { ControlledBrowserSession, type ControlledOperationInput } from './controlled-session.js';
import { BrowserControlError } from './errors.js';

interface CliIo {
  stdout(value: string): void;
  stderr(value: string): void;
  readStdin(): Promise<string>;
  env: NodeJS.ProcessEnv;
}

interface CliDependencies {
  createClient(options: { baseUrl?: string }): BrowserControlClient;
}

interface BatchOperationInput extends Omit<ControlledOperationInput, 'key'> {
  id: string;
}

const defaultIo: CliIo = {
  stdout: (value) => process.stdout.write(`${value}\n`),
  stderr: (value) => process.stderr.write(`${value}\n`),
  readStdin: async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  },
  env: process.env,
};

const defaultDependencies: CliDependencies = {
  createClient: (options) => new BrowserControlClient(options),
};

export async function runCli(
  argv: string[],
  io: CliIo = defaultIo,
  dependencies: CliDependencies = defaultDependencies
): Promise<number> {
  try {
    const { baseUrl, rest } = extractGlobalOptions(argv);
    const [group, action, ...args] = rest;
    if (!group || group === 'help' || group === '--help') {
      io.stdout(helpText());
      return 0;
    }
    if (group === 'run') {
      return await runBatch([action, ...args].filter(Boolean), baseUrl, io, dependencies);
    }
    if (group === 'shell') {
      return await runShell([action, ...args].filter(Boolean), baseUrl, io, dependencies);
    }

    const client = dependencies.createClient({ baseUrl });
    try {
      const result = await runLowLevel(client, group, action, args, io);
      io.stdout(JSON.stringify(result));
      return 0;
    } finally {
      await client.close();
    }
  } catch (error) {
    io.stderr(JSON.stringify(serializeError(error)));
    return exitCodeFor(error);
  }
}

async function runLowLevel(
  client: BrowserControlClient,
  group: string,
  action: string | undefined,
  args: string[],
  io: CliIo
): Promise<unknown> {
  if (group === 'capabilities') return client.getCapabilities();
  if (group === 'session') return runSessionCommand(client, action, args, io);
  if (group === 'lease') return runLeaseCommand(client, action, args, io);
  if (group === 'operation') return runOperationCommand(client, action, args, io);
  throw usageError(`Unknown command group: ${group}`);
}

async function runSessionCommand(
  client: BrowserControlClient,
  action: string | undefined,
  args: string[],
  io: CliIo
): Promise<unknown> {
  if (action === 'create') {
    const { values } = commandOptions(args, true);
    return client.createSession(
      await readJsonInput(values.input as string | undefined, io, {}),
      requireOption(values, 'idempotency-key')
    );
  }
  const { positionals, values } = commandOptions(args, false);
  const sessionId = requirePositional(positionals, 0, 'sessionId');
  if (action === 'get') return client.getSession(sessionId);
  if (action === 'close') {
    const credentials = await credentialsFromOptions(sessionId, values, io);
    return client.closeSession(sessionId, credentials, requireOption(values, 'idempotency-key'));
  }
  throw usageError(`Unknown session command: ${action ?? ''}`);
}

async function runLeaseCommand(
  client: BrowserControlClient,
  action: string | undefined,
  args: string[],
  io: CliIo
): Promise<unknown> {
  const { positionals, values } = commandOptions(args, true);
  const sessionId = requirePositional(positionals, 0, 'sessionId');
  if (action === 'create') {
    const request = await readJsonInput<CreateBrowserLeaseRequest>(
      values.input as string | undefined,
      io
    );
    const issued = await client.createLease(
      sessionId,
      request,
      requireOption(values, 'idempotency-key')
    );
    return values['token-stdout'] === true ? issued : { ...issued, token: undefined };
  }
  if (action === 'revoke') {
    const leaseId = requirePositional(positionals, 1, 'leaseId');
    const credentials = await credentialsFromOptions(
      sessionId,
      { ...values, 'lease-id': leaseId },
      io
    );
    return client.revokeLease(credentials, requireOption(values, 'idempotency-key'));
  }
  throw usageError(`Unknown lease command: ${action ?? ''}`);
}

async function runOperationCommand(
  client: BrowserControlClient,
  action: string | undefined,
  args: string[],
  io: CliIo
): Promise<unknown> {
  const { positionals, values } = commandOptions(args, true);
  if (action === 'get') {
    return client.getOperation(requirePositional(positionals, 0, 'operationId'));
  }
  const sessionId = requireOption(values, 'session-id');
  const credentials = await credentialsFromOptions(sessionId, values, io);
  if (action === 'cancel') {
    return client.cancelOperation(requirePositional(positionals, 0, 'operationId'), credentials);
  }
  if (action === 'execute') {
    const request = await readJsonInput<BrowserOperationRequestV1>(
      values.input as string | undefined,
      io
    );
    if (request.kind === 'act' && values['allow-act'] !== true) {
      throw new BrowserControlError(
        'permission_denied',
        'Act operations require --allow-act in automation mode'
      );
    }
    return client.executeOperation(credentials, requireOption(values, 'tab-id'), request);
  }
  throw usageError(`Unknown operation command: ${action ?? ''}`);
}

async function runBatch(
  args: string[],
  baseUrl: string | undefined,
  io: CliIo,
  dependencies: CliDependencies
): Promise<number> {
  const { values } = commandOptions(args, true);
  const text = await readTextInput(values.input as string | undefined, io);
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => parseJson<BatchOperationInput>(line, `NDJSON line ${index + 1}`));
  for (const [index, row] of rows.entries()) {
    if (typeof row.id !== 'string' || !row.id) {
      throw usageError(`NDJSON line ${index + 1} requires a non-empty id`);
    }
  }
  if (rows.some((row) => row.kind === 'act') && values['allow-act'] !== true) {
    throw new BrowserControlError(
      'permission_denied',
      'Batch input contains act operations; pass --allow-act to authorize them'
    );
  }

  const client = dependencies.createClient({ baseUrl });
  const session = new ControlledBrowserSession(client, {
    attachSessionId: values['attach-session'] as string | undefined,
    ownerId: values['owner-id'] as string | undefined,
  });
  let exitCode = 0;
  try {
    for (const row of rows) {
      try {
        const operation = await session.execute(
          { ...row, key: row.id },
          row.kind === 'act' ? async () => true : undefined
        );
        io.stdout(JSON.stringify({ id: row.id, ok: operation.status === 'succeeded', operation }));
        if (operation.status !== 'succeeded') {
          exitCode = operation.status === 'outcome_unknown' ? 5 : 4;
          break;
        }
      } catch (error) {
        io.stdout(JSON.stringify({ id: row.id, ok: false, error: serializeError(error) }));
        exitCode = exitCodeFor(error);
        break;
      }
    }
  } finally {
    try {
      await session.close();
    } catch (error) {
      io.stderr(JSON.stringify(serializeError(error)));
      if (exitCode === 0) exitCode = exitCodeFor(error);
    }
  }
  return exitCode;
}

async function runShell(
  args: string[],
  baseUrl: string | undefined,
  io: CliIo,
  dependencies: CliDependencies
): Promise<number> {
  if (io !== defaultIo) {
    throw usageError('Interactive shell requires a terminal');
  }
  const { values } = commandOptions(args, false);
  const client = dependencies.createClient({ baseUrl });
  const session = new ControlledBrowserSession(client, {
    attachSessionId: values['attach-session'] as string | undefined,
  });
  const terminal = createInterface({ input: processStdin, output: processStdout });
  let sequence = 0;
  try {
    await session.start();
    while (true) {
      const line = (await terminal.question('nebula-browser> ')).trim();
      if (!line) continue;
      if (line === 'exit' || line === 'close') break;
      if (line === 'status') {
        io.stdout(JSON.stringify(session.getState()));
        continue;
      }
      const match = /^(observe|act)\s+(\S+)(?:\s+(.+))?$/.exec(line);
      if (!match) {
        io.stderr('Use: status | observe <operation> [json] | act <operation> [json] | close');
        continue;
      }
      const kind = match[1] as 'observe' | 'act';
      const payload = match[3]
        ? parseJson<{
            target?: ControlledOperationInput['target'];
            args?: Record<string, unknown>;
          }>(match[3], 'shell payload')
        : {};
      const input: ControlledOperationInput = {
        key: `shell-${++sequence}`,
        kind,
        operation: match[2] as ControlledOperationInput['operation'],
        ...payload,
      };
      const authorize =
        kind === 'act'
          ? async () =>
              /^(?:y|yes)$/i.test(
                (await terminal.question('Approve this browser action? [y/N] ')).trim()
              )
          : undefined;
      try {
        io.stdout(JSON.stringify(await session.execute(input, authorize)));
      } catch (error) {
        io.stderr(JSON.stringify(serializeError(error)));
      }
    }
    return 0;
  } finally {
    terminal.close();
    await session.close();
  }
}

function commandOptions(args: string[], allowInput: boolean) {
  return parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      'idempotency-key': { type: 'string' },
      'session-id': { type: 'string' },
      'lease-id': { type: 'string' },
      'tab-id': { type: 'string' },
      'lease-token-stdin': { type: 'boolean' },
      'token-stdout': { type: 'boolean' },
      'allow-act': { type: 'boolean' },
      'attach-session': { type: 'string' },
      'owner-id': { type: 'string' },
      ...(allowInput ? { input: { type: 'string' as const } } : {}),
    },
  });
}

function extractGlobalOptions(argv: string[]): { baseUrl?: string; rest: string[] } {
  const rest: string[] = [];
  let baseUrl: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base-url') {
      baseUrl = argv[index + 1];
      if (!baseUrl) throw usageError('--base-url requires a value');
      index += 1;
    } else {
      rest.push(argv[index]!);
    }
  }
  return { baseUrl, rest };
}

async function credentialsFromOptions(
  sessionId: string,
  values: Record<string, string | boolean | undefined>,
  io: CliIo
): Promise<BrowserExecutionCredentials> {
  const token =
    values['lease-token-stdin'] === true
      ? (await io.readStdin()).trim()
      : io.env.NEBULA_BROWSER_LEASE_TOKEN;
  if (!token) {
    throw usageError(
      'Lease token is required through NEBULA_BROWSER_LEASE_TOKEN or --lease-token-stdin'
    );
  }
  return {
    sessionId,
    leaseId: requireOption(values, 'lease-id'),
    leaseToken: token,
  };
}

async function readJsonInput<T>(input: string | undefined, io: CliIo, fallback?: T): Promise<T> {
  if (!input && fallback !== undefined) return fallback;
  return parseJson<T>(await readTextInput(input, io), 'input');
}

async function readTextInput(input: string | undefined, io: CliIo): Promise<string> {
  if (!input) throw usageError('--input is required');
  return input === '-' ? io.readStdin() : readFile(input, 'utf8');
}

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw usageError(`${label} is not valid JSON`);
  }
}

function requireOption(values: Record<string, string | boolean | undefined>, name: string): string {
  const value = values[name];
  if (typeof value !== 'string' || !value) throw usageError(`--${name} is required`);
  return value;
}

function requirePositional(values: string[], index: number, name: string): string {
  const value = values[index];
  if (!value) throw usageError(`${name} is required`);
  return value;
}

function usageError(message: string): BrowserControlError {
  return new BrowserControlError('validation_failed', message);
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof BrowserControlError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.correlationId ? { correlationId: error.correlationId } : {}),
      ...(error.details ? { details: error.details } : {}),
    };
  }
  return {
    code: 'internal_error',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}

function exitCodeFor(error: unknown): number {
  if (!(error instanceof BrowserControlError)) return 1;
  if (error.code === 'validation_failed') return 2;
  if (error.code === 'dependency_unavailable' || error.code === 'incompatible_capability') return 3;
  if (error.code === 'outcome_unknown') return 5;
  return 4;
}

function helpText(): string {
  return [
    'nebula-browser [--base-url URL] capabilities',
    'nebula-browser session create|get|close ...',
    'nebula-browser lease create|revoke ...',
    'nebula-browser operation execute|get|cancel ...',
    'nebula-browser run --input <file|-> [--allow-act] [--attach-session ID]',
    'nebula-browser shell [--attach-session ID]',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
