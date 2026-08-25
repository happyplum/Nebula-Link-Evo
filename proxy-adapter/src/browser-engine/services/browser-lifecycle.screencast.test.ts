import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const page = {
    on: vi.fn(),
    off: vi.fn(),
    isClosed: vi.fn(() => false),
    url: vi.fn(() => 'about:blank'),
    title: vi.fn(async () => 'first'),
    bringToFront: vi.fn(async () => undefined),
  };
  const secondPage = {
    on: vi.fn(),
    off: vi.fn(),
    isClosed: vi.fn(() => false),
    url: vi.fn(() => 'https://second.test/'),
    title: vi.fn(async () => 'second'),
    bringToFront: vi.fn(async () => undefined),
  };
  const context = {
    newPage: vi.fn(async () => page),
    pages: vi.fn(() => [page, secondPage]),
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
    secondPage,
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

  it('rebinds LiveKit and MJPEG transports to the selected tab in teardown-first order', async () => {
    const lifecycle = new BrowserLifecycle();
    await lifecycle.open({ headless: true, viewport: { width: 1280, height: 720 } });
    const second = (await lifecycle.getTabs()).find((tab) => tab.title === 'second');
    if (!second) throw new Error('second test tab must exist');
    vi.clearAllMocks();

    await lifecycle.switchTab(second.id);
    await vi.waitFor(() =>
      expect(mocks.startPublisher).toHaveBeenCalledWith(mocks.secondPage, {
        width: 1280,
        height: 720,
      })
    );
    expect(mocks.stopPublisher).toHaveBeenCalledOnce();
    expect(mocks.stopScreencast).toHaveBeenCalledOnce();
    expect(mocks.startScreencast).toHaveBeenCalledWith(mocks.secondPage);
    const stopOrder = mocks.stopPublisher.mock.invocationCallOrder[0];
    const startOrder = mocks.startPublisher.mock.invocationCallOrder[0];
    if (stopOrder === undefined || startOrder === undefined) {
      throw new Error('publisher stop/start calls must be recorded');
    }
    expect(stopOrder).toBeLessThan(startOrder);

    await lifecycle.close();
  });
});
