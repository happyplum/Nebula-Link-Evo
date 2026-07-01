import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useSearchParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExplorationPanel } from './ExplorationPanel.js';

// --- Mocks ------------------------------------------------------------------

// Captured per-test so we can assert the start-exploration call.
const startExplorationMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../store/explorationApi.js', () => ({
  explorationKeys: {
    all: (id: string) => ['exploration', id],
    status: (id: string) => ['exploration', id, 'status'],
    urls: (id: string) => ['exploration', id, 'urls'],
    bindings: (id: string) => ['exploration', id, 'bindings'],
  },
  useExplorationStatus: () => ({
    data: { status: 'idle', pages_visited: 0, urls_found: 0 },
    refetch: vi.fn(),
    isLoading: false,
    error: null,
  }),
  useUrls: () => ({ data: [], refetch: vi.fn(), isLoading: false, error: null }),
  useBindings: () => ({ data: [], isLoading: false, error: null }),
  useStartExploration: () => ({ mutateAsync: startExplorationMock, isPending: false }),
  useStopExploration: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
  useAddUrl: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
  useProposeBindings: () => ({ mutate: vi.fn(), isPending: false }),
  useConfirmBinding: () => ({ mutate: vi.fn(), isPending: false }),
  useRejectBinding: () => ({ mutate: vi.fn(), isPending: false }),
  useTransitionState: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
}));

vi.mock('@/hooks/use-sse.js', () => ({ useSSE: () => {} }));

// Mock heavy child components; keep ExplorationControls real so the
// "开始探索" button and its onStart wiring stay under test.
vi.mock('./URLList.js', () => ({
  URLList: () => <div data-testid="url-list">URLList</div>,
}));
vi.mock('./PagePreview.js', () => ({
  PagePreview: () => <div data-testid="page-preview">PagePreview</div>,
}));
vi.mock('./BindingEditor.js', () => ({
  BindingEditor: () => <div data-testid="binding-editor">BindingEditor</div>,
}));
vi.mock('./UnboundModuleIndicator.js', () => ({
  UnboundModuleIndicator: () => <div data-testid="unbound-indicator" />,
}));

// --- Helpers ----------------------------------------------------------------

// Exposes the current URL search params so navigation assertions work.
function SearchParamsProbe() {
  const [params] = useSearchParams();
  return <div data-testid="search-params">{params.toString()}</div>;
}

function renderAt(initialPath: string, props?: { stepTitle?: string }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <SearchParamsProbe />
        <Routes>
          <Route
            path="/project/:projectId"
            element={<ExplorationPanel {...props} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// --- Tests ------------------------------------------------------------------

describe('ExplorationPanel wizard step', () => {
  beforeEach(() => {
    startExplorationMock.mockClear();
  });

  it('renders the default step title at the top', () => {
    renderAt('/project/p1');
    expect(screen.getByText('探索与绑定')).toBeInTheDocument();
  });

  it('renders a custom step title when provided', () => {
    renderAt('/project/p1', { stepTitle: '自定义探索标题' });
    expect(screen.getByText('自定义探索标题')).toBeInTheDocument();
  });

  it('keeps the exploration controls and child panels rendered', () => {
    renderAt('/project/p1');
    expect(screen.getByText('开始探索')).toBeInTheDocument();
    expect(screen.getByTestId('url-list')).toBeInTheDocument();
    expect(screen.getByTestId('binding-editor')).toBeInTheDocument();
  });

  it('starts exploration when the 开始探索 button is clicked', async () => {
    renderAt('/project/p1');
    fireEvent.click(screen.getByText('开始探索'));
    await waitFor(() => expect(startExplorationMock).toHaveBeenCalledWith({}));
  });

  it('navigates to ?step=run when 下一步 is clicked', () => {
    renderAt('/project/p1');
    expect(screen.getByTestId('search-params').textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByTestId('search-params').textContent).toContain('step=run');
  });
});
