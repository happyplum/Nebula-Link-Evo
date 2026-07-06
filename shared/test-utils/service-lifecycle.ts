import { spawn, ChildProcess } from 'node:child_process';
import { createServer as createNetServer, Server as NetServer } from 'net';
import { join } from 'path';

const CHECK_PORT_TIMEOUT = 2000;
const DEFAULT_PORT_RANGE_START = 30000;
const DEFAULT_PORT_RANGE_END = 40000;

// Service paths relative to project root
const SERVICE_PATHS = {
  proxy: join(process.cwd(), 'proxy-adapter', 'src', 'server.js'),
} as const;

/**
 * Check if a port is available (not in use)
 */
export async function isPortAvailable(
  port: number,
  host: string = '127.0.0.1'
): Promise<boolean> {
  return new Promise((resolve) => {
    const server: NetServer = createNetServer();

    const onError = () => {
      resolve(false);
    };

    const onListening = () => {
      server.close();
      resolve(true);
    };

    server.once('error', onError);
    server.once('listening', onListening);

    server.listen(port, host);
  });
}

/**
 * Find an available port in specified range
 */
export async function findAvailablePort(
  start: number = DEFAULT_PORT_RANGE_START,
  end: number = DEFAULT_PORT_RANGE_END
): Promise<number> {
  for (let port = start; port <= end; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(
    `No available port found in range ${start}-${end}`
  );
}

/**
 * Wait for a port to be accessible (service ready)
 * @param port - Port number to wait for
 * @param host - Host address (default: '127.0.0.1')
 * @param timeout - Maximum time to wait in ms (default: 30000)
 * @returns true when port is ready, false on timeout
 */
export async function waitForPort(
  port: number,
  host: string = '127.0.0.1',
  timeout: number = 30000
): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 100;

  while (Date.now() - startTime < timeout) {
    const available = await isPortAvailable(port, host);
    if (!available) {
      return true; // Port is now in use (service started)
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return false;
}

/**
 * Start a service with automatic port management
 * @param serviceName - Service name ('proxy')
 * @param port - Optional port number (will auto-select if not provided or busy)
 * @returns Object with port number and stop function
 */
export async function startService(
  serviceName: 'proxy',
  port?: number
): Promise<{ port: number; stop: () => Promise<void> }> {
  let actualPort = port || 0;

  const servicePath = SERVICE_PATHS[serviceName];

  // Auto-select port if TEST_MODE is enabled and port is unavailable
  if (process.env.TEST_MODE === 'true') {
    const available = await isPortAvailable(actualPort);
    if (!available) {
      console.log(
        `[service-lifecycle] Port ${actualPort} is in use, selecting available port...`
      );
      actualPort = await findAvailablePort();
      console.log(`[service-lifecycle] Auto-selected port: ${actualPort}`);
    }
  }

  // Check if port is available before starting (unless auto-selected)
  if (actualPort !== 0) {
    const available = await isPortAvailable(actualPort);
    if (!available) {
      throw new Error(`Port ${actualPort} is already in use`);
    }
  }

  // Set TEST_MODE environment variable
  const env = {
    ...process.env,
    TEST_MODE: 'true',
    // Pass port as environment variable
    [`${serviceName.toUpperCase()}_PORT`]: String(actualPort),
  };

  // Spawn service process with actual port
  const child = spawn('node', [servicePath], {
    env,
    stdio: 'inherit',
  });

  let childProcess = child as any;

  // Store service name and port on child process for cleanup
  childProcess.serviceName = serviceName;
  childProcess.servicePort = actualPort;

  // Handle process errors
  child.on('error', (err) => {
    throw new Error(`Failed to start ${serviceName} service: ${err.message}`);
  });

  // Wait for port to be ready
  const ready = await waitForPort(actualPort, '127.0.0.1', 10000);
  if (!ready) {
    child.kill('SIGKILL');
    throw new Error(`${serviceName} service failed to start on port ${actualPort}`);
  }

  console.log(
    `[service-lifecycle] ${serviceName} service started on port ${actualPort} (PID: ${child.pid})`
  );

  // Return stop function
  const stop = async () => {
    await stopService(childProcess);
  };

  return { port: actualPort, stop };
}

/**
 * Stop a service gracefully
 * @param serviceProcess - Process to stop (can be any, looks for servicePort property)
 */
export async function stopService(serviceProcess: any): Promise<void> {
  const process = serviceProcess as ChildProcess;

  if (!process || process.killed) {
    return;
  }

  const serviceName = serviceProcess.serviceName || 'unknown';
  const port = serviceProcess.servicePort || 'unknown';

  console.log(
    `[service-lifecycle] Stopping ${serviceName} service (PID: ${process.pid}, port: ${port})...`
  );

  // Send SIGTERM for graceful shutdown
  process.kill('SIGTERM');

  // Wait for process to exit gracefully
  const startTime = Date.now();
  const timeout = 10000;

  while (Date.now() - startTime < timeout) {
    if (process.exitCode !== null || process.signalCode !== null) {
      console.log(
        `[service-lifecycle] ${serviceName} service stopped successfully`
      );
      return; // Process has exited
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Force kill if graceful shutdown failed
  console.log(
    `[service-lifecycle] ${serviceName} service did not stop gracefully, force killing...`
  );
  if (process.exitCode === null && process.signalCode === null) {
    process.kill('SIGKILL');
    console.log(`[service-lifecycle] ${serviceName} service force killed`);
  }
}
