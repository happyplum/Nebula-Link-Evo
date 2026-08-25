import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const proxyPort = await availablePort();
const aiPort = await availablePort(new Set([proxyPort]));
const uiPort = await availablePort(new Set([proxyPort, aiPort]));
const childEnvironment = { ...process.env };
delete childEnvironment.NO_COLOR;
Object.assign(childEnvironment, {
  DEBUG_UI_E2E_PROXY_PORT: String(proxyPort),
  DEBUG_UI_E2E_AI_PORT: String(aiPort),
  DEBUG_UI_E2E_UI_PORT: String(uiPort),
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
process.exitCode = exitCode;

async function availablePort(excluded = new Set()) {
  while (true) {
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
    if (port && !excluded.has(port)) return port;
  }
}
