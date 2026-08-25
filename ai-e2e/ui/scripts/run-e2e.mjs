import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await mkdtemp(join(tmpdir(), 'nebula-ai-e2e-ui-playwright-'));
const childEnvironment = { ...process.env };
delete childEnvironment.NO_COLOR;
Object.assign(childEnvironment, {
  AI_E2E_UI_TEST_PORT: String(await availablePort()),
  AI_E2E_UI_TEST_DB_PATH: join(root, 'ai-e2e.sqlite'),
});

const playwrightCli = fileURLToPath(
  new URL('../node_modules/@playwright/test/cli.js', import.meta.url)
);
const child = spawn(process.execPath, [playwrightCli, 'test', ...process.argv.slice(2)], {
  env: childEnvironment,
  stdio: 'inherit',
  windowsHide: true,
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve(signal ? 1 : (code ?? 1)));
});
await rm(root, { recursive: true, force: true });
process.exitCode = exitCode;

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (!port) throw new Error('Failed to allocate ai-e2e UI test port');
  return port;
}
