import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const page = {
    on: vi.fn(),
    off: vi.fn(),
    isClosed: vi.fn(() => false),
  };
  const context = {
    newPage: vi.fn(async () => page),
  };
  const browser = {
    on: vi.fn(),
    off: vi.fn(),
    isConnected: vi.fn(() => true),
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined),
  };

  return {
    page,
    context,
    browser,
    launch: vi.fn(async () => browser),
    startPublisher: vi.fn(async () => undefined),
    stopPublisher: vi.fn(async () => undefined),
    startScreencast: vi.fn(async () => undefined),
    stopScreencast: vi.fn(async () => undefined),
  };
});

vi.mock('playwright', () => ({
  chromium: { launch: mocks.launch },
}));

vi.mock('../../services/livekit-publisher.js', () => ({
  startPublisher: mocks.startPublisher,
  stopPublisher: mocks.stopPublisher,
}));

vi.mock('../screencast.js', () => ({
  screencastManager: {
    start: mocks.startScreencast,
    stop: mocks.stopScreencast,
    isActive: vi.fn(() => true),
  },
}));

import { BrowserLifecycle } from './browser-lifecycle.js';

describe('BrowserLifecycle screencast lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts MJPEG capture when the browser opens and stops it when the browser closes', async () => {
    const lifecycle = new BrowserLifecycle();

    await lifecycle.open({ headless: true });

    expect(mocks.startScreencast).toHaveBeenCalledOnce();
    expect(mocks.startScreencast).toHaveBeenCalledWith(mocks.page);

    await lifecycle.close();

    expect(mocks.stopScreencast).toHaveBeenCalledOnce();
  });
});
