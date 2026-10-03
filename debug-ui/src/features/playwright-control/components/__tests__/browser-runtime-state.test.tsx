import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MonitorSidebarShell } from '@/features/runtime/components/MonitorSidebarShell.js';
import { applyPlaywrightStatus } from '@/features/runtime/lib/apply-playwright-status.js';
import { useRuntimeStore } from '@/features/runtime/store/runtime.store.js';
import { testIds } from '@/shared/testing/testids.js';
import * as adapters from '../../api/control.adapters.js';
import { useControlStore } from '../../store/control.store.js';
import { BrowserBasicShell } from '../BrowserBasicShell.js';
import { PageInteractionShell } from '../PageInteractionShell.js';

vi.mock('../../api/control.adapters.js', () => ({
  openBrowser: vi.fn(),
  closeBrowser: vi.fn(),
  navigateToUrl: vi.fn(),
  takeScreenshot: vi.fn(),
  fetchBrowserStatus: vi.fn(),
  fetchBrowserTabs: vi.fn(),
  switchBrowserTab: vi.fn(),
  fetchDomSnapshot: vi.fn(),
  executeAction: vi.fn(),
}));

const confirmedUrl = 'https://confirmed.example/';
const seedOpenBrowser = () =>
  applyPlaywrightStatus({ isOpen: true, url: confirmedUrl, title: null, status: 'ready' });

function renderPanels(open = false) {
  render(
    <>
      <BrowserBasicShell open={open} onToggle={() => {}} />
      <PageInteractionShell />
      <MonitorSidebarShell />
    </>
  );
}

async function finishAction() {
  await waitFor(() => expect(useControlStore.getState().isExecutingAction).toBe(false));
}

function expectPanels(isOpen: boolean, url: string | null) {
  expect(useRuntimeStore.getState()).toMatchObject({
    playwrightIsOpen: isOpen,
    playwrightUrl: url,
    playwrightStatusHydrated: true,
  });
  expect(screen.getByTestId(testIds.controlBrowserBasicStatusText)).toHaveTextContent(
    isOpen ? '已连接' : '未连接'
  );
  expect(screen.getByTestId(testIds.controlBrowserBasicCurrentUrl)).toHaveTextContent(url ?? '-');
  expect(screen.getByTestId(testIds.monitorSidebarBrowserStatusText)).toHaveTextContent(
    isOpen ? '就绪' : '未知'
  );
  expect(screen.getByTestId(testIds.controlPageInteractionElementPicker)).toHaveProperty(
    'disabled',
    !isOpen
  );
}

describe('browser runtime state across Monitor and Control', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useControlStore.getState().reset();
    useRuntimeStore.getState().reset();
    vi.mocked(adapters.fetchBrowserTabs).mockResolvedValue({ success: true, tabs: [] });
  });

  it('hydrates all panels from the initial confirmed REST status', async () => {
    vi.mocked(adapters.fetchBrowserStatus).mockResolvedValue({
      success: true,
      isOpen: true,
      url: confirmedUrl,
    });
    renderPanels(true);
    await waitFor(() => expectPanels(true, confirmedUrl));
  });

  it('updates both panels immediately after confirmed REST open and close', async () => {
    vi.mocked(adapters.openBrowser).mockResolvedValue({ success: true });
    vi.mocked(adapters.closeBrowser).mockResolvedValue({ success: true });
    vi.mocked(adapters.fetchBrowserStatus)
      .mockResolvedValueOnce({ success: true, isOpen: true, url: confirmedUrl })
      .mockResolvedValueOnce({ success: true, isOpen: false });
    renderPanels();
    fireEvent.click(screen.getByTestId(testIds.controlBrowserBasicOpenBtn));
    await finishAction();
    expectPanels(true, confirmedUrl);
    fireEvent.click(screen.getByTestId(testIds.controlBrowserBasicCloseBtn));
    await finishAction();
    expectPanels(false, null);
    expect(adapters.fetchBrowserStatus).toHaveBeenCalledTimes(2);
  });

  it('uses the redirected URL from REST status after navigation', async () => {
    seedOpenBrowser();
    vi.mocked(adapters.navigateToUrl).mockResolvedValue({ success: true });
    vi.mocked(adapters.fetchBrowserStatus).mockResolvedValue({
      success: true,
      isOpen: true,
      url: 'https://redirected.example/final',
    });
    renderPanels();
    fireEvent.change(screen.getByTestId(testIds.controlBrowserBasicUrlInput), {
      target: { value: 'requested.example' },
    });
    fireEvent.click(screen.getByTestId(testIds.controlBrowserBasicNavigateBtn));
    await finishAction();
    expect(adapters.navigateToUrl).toHaveBeenCalledWith('https://requested.example');
    expectPanels(true, 'https://redirected.example/final');
    expect(screen.getByTestId(testIds.controlBrowserBasicUrlInput)).toHaveValue('');
  });

  it('updates both panels on reconnect and keeps the URL draft independent of remote changes', async () => {
    seedOpenBrowser();
    vi.mocked(adapters.fetchBrowserStatus).mockResolvedValue({
      success: true,
      isOpen: true,
      url: 'https://reconnected.example/',
    });
    renderPanels();
    const input = screen.getByTestId(testIds.controlBrowserBasicUrlInput);
    fireEvent.change(input, { target: { value: 'unfinished.example/draft' } });
    fireEvent.click(screen.getByTestId(testIds.controlBrowserBasicReconnectBtn));
    await finishAction();
    expectPanels(true, 'https://reconnected.example/');
    expect(input).toHaveValue('unfinished.example/draft');
    act(() => applyPlaywrightStatus({ isOpen: false, url: null, title: null, status: 'unknown' }));
    expectPanels(false, null);
    expect(input).toHaveValue('unfinished.example/draft');
  });

  it.each(['open', 'close', 'navigate', 'reconnect'] as const)(
    'keeps confirmed state when %s status confirmation fails',
    async (operation) => {
      if (operation !== 'open') seedOpenBrowser();
      vi.mocked(adapters.openBrowser).mockResolvedValue({ success: true });
      vi.mocked(adapters.closeBrowser).mockResolvedValue({ success: true });
      vi.mocked(adapters.navigateToUrl).mockResolvedValue({ success: true });
      vi.mocked(adapters.fetchBrowserStatus).mockResolvedValue({
        success: false,
        error: 'status unavailable',
      });
      renderPanels();
      if (operation === 'navigate')
        fireEvent.change(screen.getByTestId(testIds.controlBrowserBasicUrlInput), {
          target: { value: 'unconfirmed.example' },
        });
      const buttons = {
        open: testIds.controlBrowserBasicOpenBtn,
        close: testIds.controlBrowserBasicCloseBtn,
        navigate: testIds.controlBrowserBasicNavigateBtn,
        reconnect: testIds.controlBrowserBasicReconnectBtn,
      };
      fireEvent.click(screen.getByTestId(buttons[operation]));
      await finishAction();
      expect(useRuntimeStore.getState().playwrightIsOpen).toBe(operation !== 'open');
      expect(useRuntimeStore.getState().playwrightUrl).toBe(
        operation === 'open' ? null : confirmedUrl
      );
      expect(useControlStore.getState().lastActionError).toContain('status unavailable');
    }
  );

  it('keeps confirmed state on a REST status network failure', async () => {
    seedOpenBrowser();
    vi.mocked(adapters.fetchBrowserStatus).mockRejectedValue(new Error('network offline'));
    renderPanels();
    fireEvent.click(screen.getByTestId(testIds.controlBrowserBasicReconnectBtn));
    await finishAction();
    expectPanels(true, confirmedUrl);
    expect(useControlStore.getState().lastActionError).toContain('network offline');
  });

  it.each(['open', 'close', 'navigate'] as const)(
    'keeps confirmed state when the %s action fails',
    async (operation) => {
      if (operation !== 'open') seedOpenBrowser();
      const action = {
        open: adapters.openBrowser,
        close: adapters.closeBrowser,
        navigate: adapters.navigateToUrl,
      }[operation];
      vi.mocked(action).mockResolvedValue({ success: false, error: 'action failed' });
      renderPanels();
      if (operation === 'navigate')
        fireEvent.change(screen.getByTestId(testIds.controlBrowserBasicUrlInput), {
          target: { value: 'unconfirmed.example' },
        });
      const buttons = {
        open: testIds.controlBrowserBasicOpenBtn,
        close: testIds.controlBrowserBasicCloseBtn,
        navigate: testIds.controlBrowserBasicNavigateBtn,
      };
      fireEvent.click(screen.getByTestId(buttons[operation]));
      await finishAction();
      expect(adapters.fetchBrowserStatus).not.toHaveBeenCalled();
      expect(useRuntimeStore.getState().playwrightIsOpen).toBe(operation !== 'open');
      expect(useRuntimeStore.getState().playwrightUrl).toBe(
        operation === 'open' ? null : confirmedUrl
      );
      expect(useControlStore.getState().lastActionError).toBe('action failed');
    }
  );

  it('does not guess closed from an incomplete successful status response', async () => {
    seedOpenBrowser();
    vi.mocked(adapters.fetchBrowserStatus).mockResolvedValue({ success: true });
    renderPanels();
    fireEvent.click(screen.getByTestId(testIds.controlBrowserBasicReconnectBtn));
    await finishAction();
    expectPanels(true, confirmedUrl);
    expect(useControlStore.getState().lastActionError).toBeTruthy();
  });

  it('control reset only clears local state and leaves remote state visible', async () => {
    seedOpenBrowser();
    useControlStore.getState().setElementPickerEnabled(true);
    useControlStore.getState().setViewport({ width: 800, height: 600 });
    renderPanels();
    await act(async () => {});
    act(() => useControlStore.getState().reset());
    expectPanels(true, confirmedUrl);
    expect(useControlStore.getState().elementPickerEnabled).toBe(false);
    expect(useControlStore.getState().viewport).toBeNull();
  });
});
