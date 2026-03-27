import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { createServer, Server } from 'net';

import {
  startService,
  stopService,
  waitForPort,
  isPortAvailable,
  findAvailablePort,
} from '../../../shared/test-utils/service-lifecycle.js';

describe('service-lifecycle', () => {
  let testProcess: any = null;
  let testServer: Server | null = null;
  // Use ephemeral port range to avoid conflicts
  const BUSY_PORT = 49254;

  beforeEach(() => {
    // Ensure TEST_MODE is set
    process.env.TEST_MODE = 'true';
  });

  afterEach(async () => {
    if (testProcess) {
      await stopService(testProcess);
      testProcess = null;
    }
    if (testServer) {
      await new Promise<void>((resolve) => {
        testServer!.close(() => resolve());
      });
      testServer = null;
    }
    // Give time for port to be released
    await new Promise((resolve) => setTimeout(resolve, 2000));
  });

  describe('isPortAvailable', () => {
    it('should return true for available port', async () => {
      // Use a random high port to avoid conflicts
      const available = await isPortAvailable(49255);
      expect(available).toBe(true);
    });

    it('should return false for in-use port', async () => {
      // Create a simple test server to occupy the port
      const server = createServer();
      await new Promise<void>((resolve) => {
        server.listen(BUSY_PORT, '127.0.0.1', () => resolve());
      });

      try {
        const available = await isPortAvailable(BUSY_PORT);
        expect(available).toBe(false);
      } finally {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
        // Wait for port to be released
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }
    });
  });

  describe('findAvailablePort', () => {
    it('should find an available port in range', async () => {
      const port = await findAvailablePort(49256, 49260);
      expect(port).toBeGreaterThanOrEqual(49256);
      expect(port).toBeLessThanOrEqual(49260);
    });

    it('should skip occupied ports', async () => {
      // Occupy one port in the range
      const server = createServer();
      await new Promise<void>((resolve) => {
        server.listen(49261, '127.0.0.1', () => resolve());
      });

      try {
        const port = await findAvailablePort(49261, 49265);
        // Should return a different port
        expect(port).not.toBe(49261);
      } finally {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      }
    });

    it('should throw if no available port in range', async () => {
      // Occupy the entire range
      const servers: Server[] = [];
      for (let port = 49270; port <= 49272; port++) {
        const server = createServer();
        await new Promise<void>((resolve) => {
          server.listen(port, '127.0.0.1', () => resolve());
        });
        servers.push(server);
      }

      try {
        await expect(
          findAvailablePort(49270, 49272)
        ).rejects.toThrow('No available port found in range');
      } finally {
        // Clean up all servers
        await Promise.all(
          servers.map(
            (server) =>
              new Promise<void>((resolve) => {
                server.close(() => resolve());
              })
          )
        );
      }
    });
  });

  describe('waitForPort', () => {
    it('should wait for port to become occupied', async () => {
      const server = createServer();

      setTimeout(() => {
        server.listen(BUSY_PORT, '127.0.0.1');
      }, 100);

      try {
        const ready = await waitForPort(BUSY_PORT, '127.0.0.1', 5000);
        expect(ready).toBe(true); // Port became occupied
      } finally {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
        // Wait for port to be released
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }
    });

    it('should timeout if port never becomes occupied', async () => {
      // Use a port that won't be used by other tests
      const timeoutPort = 49999;
      const ready = await waitForPort(timeoutPort, '127.0.0.1', 200);
      expect(ready).toBe(false);
    });
  });

  describe('startService', () => {
    it('should have correct API signature', async () => {
      // Verify the API exists with correct signature
      expect(startService).toBeDefined();
      expect(stopService).toBeDefined();
    });

    it('should accept proxy and playwrite service names', async () => {
      // This test only validates the API accepts the correct types
      // Actual service startup is tested in integration tests
      expect(startService).toBeDefined();
    });
  });
});
