# Test Utilities for Nebula-Link Evo

This directory contains shared test utilities and mock implementations for external dependencies used in tests.

## Service Lifecycle Management

`service-lifecycle.ts` provides utilities for managing service lifecycle during tests, including port checking, service startup/shutdown, and TEST_MODE support.

### Usage

```typescript
import {
  isPortAvailable,
  findAvailablePort,
  waitForPort,
  startService,
  stopService,
} from '../shared/test-utils/service-lifecycle.js';

// Check if a port is available
const available = await isPortAvailable(3000);

// Find an available port in a range
const port = await findAvailablePort(30000, 40000);

// Wait for a service to start listening on a port
const ready = await waitForPort(3000, '127.0.0.1', 5000);

// Start a service with automatic port management
const { port, stop } = await startService('proxy', 3000);

// Stop the service gracefully
await stop(service);
```

### Features

- **Port Availability Check**: `isPortAvailable(port, host?)` - Check if a port is free
- **Automatic Port Selection**: `findAvailablePort(start, end)` - Find an available port in a range
- **Wait for Service**: `waitForPort(port, host?, timeout?)` - Wait for a service to start, returns boolean
- **Service Lifecycle**: `startService(serviceName, port?)` - Start 'proxy' or 'playwright' service
- **Stop Function**: Returns `{ port, stop }` with cleanup function
- **TEST_MODE Support**: Automatically selects available ports when TEST_MODE is enabled
- **Graceful Shutdown**: Sends SIGTERM first, force-kills only after timeout (10s)

### Service Names

The `startService` function accepts service names that map to actual server paths:
- `'proxy'` → `proxy-adapter/src/server.js`
- `'playwright'` → `playwright-server/src/server.js`

### TEST_MODE Behavior

When `TEST_MODE='true'` is set:
- If the requested port is busy, automatically selects an available port
- Sets `{SERVICE}_PORT` environment variable for the service
- Logs startup/shutdown events with service name and PID
- Prevents test failures due to port conflicts

## Mock Library

### Usage

```typescript
import { createKimiClientMock } from '@mocks/KimiClient.mock.js';
import { createBrowserContextMock } from '@mocks/BrowserContext.mock.js';

// Create fresh mocks for each test
const kimiMock = createKimiClientMock();
const browserMock = createBrowserContextMock();
```

### Available Mocks

- `KimiClient.mock.ts` - Mock for Kimi AI API client
- `BrowserContext.mock.ts` - Mock for Playwright BrowserContext

### Conventions

- All mocks are factory functions (functions that create fresh mocks)
- Use Vitest's `vi.fn()` for mock functions
- Type-safe mocks that match original interfaces
