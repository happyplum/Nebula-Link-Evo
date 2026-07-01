import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type React from 'react';

// --- Mock EventSource -----------------------------------------------------

/**
 * Minimal EventSource mock that mirrors the subset of the API the real
 * `useSSE` hook uses: constructor(url), addEventListener(type, listener),
 * close(). The test emits events via `instance.emit(type, payload)`.
 */
class MockEventSource {
  static last: MockEventSource | null = null;
  private listeners: Record<string, Array<(event: { data: string }) => void>> = {};
  public closed = false;

  constructor(public url: string) {
    MockEventSource.last = this;
  }
  addEventListener(
    type: string,
    listener: (event: { data: string }) => void,
  ): void {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }
  removeEventListener(
    type: string,
    listener: (event: { data: string }) => void,
  ): void {
    const arr = this.listeners[type];
    if (arr) this.listeners[type] = arr.filter((l) => l !== listener);
  }
  close(): void {
    this.closed = true;
  }
  /** Test helper: dispatch a typed SSE event to all listeners of `type`. */
  emit(type: string, data: unknown): void {
    const payload = { data };
    const evt = { data: JSON.stringify(payload) };
    (this.listeners[type] || []).forEach((l) => {
      l(evt);
    });
  }
}

// --- Mocks ----------------------------------------------------------------

const runScriptMock = vi.fn();

vi.mock('../store/executionApi.js', () => ({
  useRuns: () => ({ data: [], isLoading: false }),
  useRunDetail: () => ({ data: undefined }),
  useRunScript: () => ({ mutate: runScriptMock, isPending: false }),
  executionKeys: {
    runs: (id: string) => ['execution', id, 'runs'],
    runDetail: (id: string, runId: string) => ['execution', id, 'runs', runId],
    diagnosis: (id: string, runId: string) => [
      'execution',
      id,
      'runs',
      runId,
      'diagnosis',
    ],
  },
}));

// Keep the diagnosis/result sub-panels light so the test focuses on timeline.
vi.mock('./ExecutionControls.js', () => ({
  ExecutionControls: () => <div data-testid="execution-controls" />,
}));
vi.mock('./ResultDashboard.js', () => ({
  ResultDashboard: () => <div data-testid="result-dashboard" />,
}));
vi.mock('./RunDetail.js', () => ({
  RunDetail: () => <div data-testid="run-detail" />,
}));
vi.mock('./DiagnosisPanel.js', () => ({
  DiagnosisPanel: () => <div data-testid="diagnosis-panel" />,
}));
vi.mock('./ExecutionHistory.js', () => ({
  ExecutionHistory: () => <div data-testid="execution-history" />,
}));

// --- Helpers --------------------------------------------------------------

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/project/p1']}>
        <Routes>
          <Route path="/project/:projectId" element={<ExecutionPanel />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Import after mocks are registered so the module picks them up.
// (vitest hoists vi.mock calls, so this dynamic import is safe.)
async function loadExecutionPanel() {
  const mod = await import('./ExecutionPanel.js');
  return mod.default;
}

let ExecutionPanel: React.FC;

// --- Tests ----------------------------------------------------------------

describe('ExecutionPanel timeline accumulation', () => {
  beforeEach(async () => {
    vi.stubGlobal('EventSource', MockEventSource);
    MockEventSource.last = null;
    ExecutionPanel = await loadExecutionPanel();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('accumulates timeline steps from execution.started -> progress -> completed', async () => {
    renderPanel();
    // Wait for useSSE to construct the EventSource.
    await waitFor(() => expect(MockEventSource.last).not.toBeNull());
    const es = MockEventSource.last!;

    act(() => {
      es.emit('execution.started', { scriptId: 'script-1' });
      es.emit('execution.progress', { step: '初始化浏览器' });
      es.emit('execution.progress', { step: '执行登录脚本' });
      es.emit('execution.completed', { run: { id: 'run-1' } });
    });

    expect(await screen.findByText('开始执行')).toBeInTheDocument();
    expect(screen.getByText('初始化浏览器')).toBeInTheDocument();
    expect(screen.getByText('执行登录脚本')).toBeInTheDocument();
    expect(screen.getByText('执行完成')).toBeInTheDocument();
  });

  it('marks a failed step and appends a failure terminal step on execution.failed', async () => {
    renderPanel();
    await waitFor(() => expect(MockEventSource.last).not.toBeNull());
    const es = MockEventSource.last!;

    act(() => {
      es.emit('execution.started', { scriptId: 'script-2' });
      es.emit('execution.progress', { step: '打开页面' });
      es.emit('execution.failed', { error: 'selector timeout' });
    });

    expect(await screen.findByText('执行失败')).toBeInTheDocument();
    expect(screen.getByText('打开页面')).toBeInTheDocument();
    expect(screen.getByText('selector timeout')).toBeInTheDocument();
  });
});
