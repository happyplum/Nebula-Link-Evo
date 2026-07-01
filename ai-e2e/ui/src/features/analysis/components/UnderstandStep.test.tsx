import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useSearchParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UnderstandStep } from './UnderstandStep.js';

// Mock heavy child panels so the test stays focused on UnderstandStep wiring.
vi.mock('./AnalysisPanel.js', () => ({
  AnalysisPanel: () => <div data-testid="analysis-panel">AnalysisPanel</div>,
}));
vi.mock('../../scenario/components/ScenarioPanel.js', () => ({
  ScenarioPanel: () => <div data-testid="scenario-panel">ScenarioPanel</div>,
}));

// Mock the upload hook so no real fetch calls happen during tests.
vi.mock('../store/analysisApi.js', () => ({
  useUploadPRD: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
}));

// Helper that exposes the current URL search params for navigation assertions.
function SearchParamsProbe() {
  const [params] = useSearchParams();
  return <div data-testid="search-params">{params.toString()}</div>;
}

function renderAt(initialPath: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <SearchParamsProbe />
        <Routes>
          <Route path="/project/:projectId" element={<UnderstandStep />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('UnderstandStep', () => {
  it('renders the step title', () => {
    renderAt('/project/p1');
    expect(screen.getByText('理解测试意图')).toBeInTheDocument();
  });

  it('renders the AnalysisPanel and ScenarioPanel', () => {
    renderAt('/project/p1');
    expect(screen.getByTestId('analysis-panel')).toBeInTheDocument();
    expect(screen.getByTestId('scenario-panel')).toBeInTheDocument();
  });

  it('accepts text in the prompt textarea', () => {
    renderAt('/project/p1');
    const textarea = screen.getByPlaceholderText(
      '用一句话描述你想测试什么…',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '用户登录后提交订单' } });
    expect(textarea.value).toBe('用户登录后提交订单');
  });

  it('disables the generate button when the prompt is empty', () => {
    renderAt('/project/p1');
    expect(
      screen.getByRole('button', { name: '生成分析' }),
    ).toBeDisabled();
  });

  it('shows the prompt preview card after clicking 生成分析', () => {
    renderAt('/project/p1');
    const textarea = screen.getByPlaceholderText('用一句话描述你想测试什么…');
    fireEvent.change(textarea, { target: { value: '用户登录后提交订单' } });
    fireEvent.click(screen.getByRole('button', { name: '生成分析' }));
    const preview = screen.getByTestId('prompt-preview');
    expect(preview).toHaveTextContent('用户登录后提交订单');
  });

  it('does not show the preview card before submit', () => {
    renderAt('/project/p1');
    const textarea = screen.getByPlaceholderText('用一句话描述你想测试什么…');
    fireEvent.change(textarea, { target: { value: '尚未提交的内容' } });
    expect(screen.queryByTestId('prompt-preview')).not.toBeInTheDocument();
  });

  it('navigates to ?step=explore when 下一步 is clicked', () => {
    renderAt('/project/p1');
    fireEvent.click(screen.getByText('下一步'));
    expect(screen.getByTestId('search-params').textContent).toContain(
      'step=explore',
    );
  });
});
