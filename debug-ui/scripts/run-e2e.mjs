import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { withE2EResources } from '../../tools/e2e-process-lifecycle.mjs';

process.exitCode = await withE2EResources(
  {
    workspaceRoot: fileURLToPath(new URL('../..', import.meta.url)),
    name: 'debug-ui-e2e',
  },
  async (scope) => {
    const proxyPort = await availablePort();
    const aiPort = await availablePort(new Set([proxyPort]));
    const uiPort = await availablePort(new Set([proxyPort, aiPort]));
    const childEnvironment = { ...process.env };
    delete childEnvironment.NO_COLOR;
    Object.assign(childEnvironment, {
      DEBUG_UI_E2E_PROXY_PORT: String(proxyPort),
      DEBUG_UI_E2E_AI_PORT: String(aiPort),
      DEBUG_UI_E2E_UI_PORT: String(uiPort),
      NEBULA_E2E_RUN_ROOT: scope.root,
      DEBUG_UI_E2E_PACKAGE_DIR: fileURLToPath(new URL('..', import.meta.url)),
      PLAYWRIGHT_HTML_OPEN: 'never',
    });

    const playwrightCli = fileURLToPath(
      new URL('../node_modules/@playwright/test/cli.js', import.meta.url)
    );
    const child = scope.spawn(process.execPath, [playwrightCli, 'test', ...process.argv.slice(2)], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: childEnvironment,
      stdio: 'inherit',
      windowsHide: true,
    });

    return await scope.waitForExit(child);
  }
);

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
