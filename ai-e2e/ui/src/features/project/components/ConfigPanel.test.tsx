import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigPanel } from './ConfigPanel.js';

// --- Mocks ------------------------------------------------------------------

vi.mock('../store/projectApi.js', () => ({
  useProject: () => ({
    data: { id: 'p1', name: 'Demo', status: 'draft' },
  }),
}));

// NOTE: `data` must hold a STABLE reference — ConfigPanel runs
// `setLocalConfig` inside a `useEffect([config])`. A fresh object per render
// would make that effect loop forever (setState → effect → setState …) and
// exhaust the V8 heap. We build the payload once, inside the factory.
vi.mock('../store/configApi.js', () => {
  const configData = {
    base_url: '',
    auth_type: 'none',
    auth_config: {},
    seed_urls: [''],
  };
  return {
    useProjectConfig: () => ({ data: configData, isLoading: false }),
    useUpdateProjectConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useTransitionProjectState: () => ({ mutate: vi.fn(), isPending: false }),
    useCreateLoginScript: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useTestLoginScript: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useLoginScripts: () => ({ data: [] }),
  };
});

// --- Helpers ----------------------------------------------------------------

// Renders the current router search string so the test can assert navigation.
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.search}</div>;
}

function renderAt(initialPath: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/project/:projectId"
            element={
              <>
                <ConfigPanel />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// --- Tests ------------------------------------------------------------------

describe('ConfigPanel wizard step', () => {
  it('renders the default step title at the top', () => {
    renderAt('/project/p1');
    expect(screen.getByText('准备目标站点')).toBeInTheDocument();
  });

  it('renders a custom step title when provided', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/project/p1']}>
          <Routes>
            <Route path="/project/:projectId" element={<ConfigPanel stepTitle="自定义标题" />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText('自定义标题')).toBeInTheDocument();
  });

  it('keeps the base URL field functional', () => {
    renderAt('/project/p1');
    const baseUrlInput = screen.getByPlaceholderText('https://example.com');
    expect(baseUrlInput).toBeInTheDocument();
    fireEvent.change(baseUrlInput, { target: { value: 'https://demo.test' } });
    expect(baseUrlInput).toHaveValue('https://demo.test');
  });

  it('navigates to ?step=understand when 下一步 is clicked', () => {
    renderAt('/project/p1');
    expect(screen.getByTestId('location').textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByTestId('location').textContent).toContain('step=understand');
  });
});
