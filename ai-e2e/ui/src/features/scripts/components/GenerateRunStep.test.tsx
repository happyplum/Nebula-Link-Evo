import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GenerateRunStep } from './GenerateRunStep.js';

// --- Mocks ---------------------------------------------------------------

const generateMock = vi.fn();
const runAllMock = vi.fn();

vi.mock('../store/scriptsApi.js', () => ({
  useGenerateScripts: () => ({ mutate: generateMock, isPending: false }),
}));

vi.mock('../../execution/store/executionApi.js', () => ({
  useRunAllScripts: () => ({ mutate: runAllMock, isPending: false }),
}));

// Mock the heavy sub-panels so the test focuses on the step header + buttons.
vi.mock('./ScriptPanel.js', () => ({
  __esModule: true,
  default: () => <div data-testid="script-panel">ScriptPanel</div>,
}));
vi.mock('../../execution/components/ExecutionPanel.js', () => ({
  __esModule: true,
  default: () => <div data-testid="execution-panel">ExecutionPanel</div>,
}));
vi.mock('../../report/components/ReportPanel.js', () => ({
  ReportPanel: ({ projectId }: { projectId: string }) => (
    <div data-testid="report-panel">ReportPanel:{projectId}</div>
  ),
}));

// --- Helpers -------------------------------------------------------------

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/project/:projectId" element={<GenerateRunStep />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// --- Tests ---------------------------------------------------------------

describe('GenerateRunStep', () => {
  beforeEach(() => {
    generateMock.mockClear();
    runAllMock.mockClear();
  });

  it('renders the step title and quick-action buttons', () => {
    renderAt('/project/p1');
    expect(screen.getByText('生成与执行')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成脚本' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '执行全部脚本' })).toBeInTheDocument();
  });

  it('renders the stacked ScriptPanel, ExecutionPanel and ReportPanel', () => {
    renderAt('/project/p1');
    expect(screen.getByTestId('script-panel')).toBeInTheDocument();
    expect(screen.getByTestId('execution-panel')).toBeInTheDocument();
    expect(screen.getByTestId('report-panel')).toHaveTextContent('ReportPanel:p1');
  });

  it('calls useGenerateScripts mutate when "生成脚本" is clicked', () => {
    renderAt('/project/p1');
    fireEvent.click(screen.getByRole('button', { name: '生成脚本' }));
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(runAllMock).not.toHaveBeenCalled();
  });

  it('calls useRunAllScripts mutate when "执行全部脚本" is clicked', () => {
    renderAt('/project/p1');
    fireEvent.click(screen.getByRole('button', { name: '执行全部脚本' }));
    expect(runAllMock).toHaveBeenCalledTimes(1);
    expect(generateMock).not.toHaveBeenCalled();
  });
});
