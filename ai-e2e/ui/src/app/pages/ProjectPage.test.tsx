import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProjectPage } from './ProjectPage.js';

// Local status union (mirrors ProjectStatus from @/types/project) so this test
// stays self-contained and does not depend on cross-file type resolution.
type ProjectStatus =
  | 'draft'
  | 'configuring'
  | 'analyzing'
  | 'analyzed'
  | 'exploring'
  | 'explored'
  | 'generating'
  | 'ready'
  | 'running'
  | 'completed';

// --- Mocks -----------------------------------------------------------------

// Default project factory; individual tests override status via mockProject.
let mockProject: { id: string; name: string; status: ProjectStatus } | undefined = {
  id: 'p1',
  name: 'Demo Project',
  status: 'draft',
};

vi.mock('../../features/project/store/projectApi.js', () => ({
  useProject: () => ({ data: mockProject }),
}));

// Mock the four step areas so tests stay focused on ProjectPage wiring.
vi.mock('../../features/project/components/ConfigPanel.js', () => ({
  ConfigPanel: () => <div data-testid="config-panel">ConfigPanel</div>,
}));
vi.mock('../../features/analysis/components/AnalysisPanel.js', () => ({
  AnalysisPanel: () => <div data-testid="analysis-panel">AnalysisPanel</div>,
}));
vi.mock('../../features/scenario/components/ScenarioPanel.js', () => ({
  ScenarioPanel: () => <div data-testid="scenario-panel">ScenarioPanel</div>,
}));
vi.mock('../../features/exploration/components/ExplorationPanel.js', () => ({
  __esModule: true,
  default: () => <div data-testid="exploration-panel">ExplorationPanel</div>,
  ExplorationPanel: () => <div data-testid="exploration-panel">ExplorationPanel</div>,
}));
vi.mock('../../features/scripts/components/GenerateRunStep.js', () => ({
  GenerateRunStep: ({ projectId }: { projectId?: string }) => (
    <div data-testid="generate-run-step">GenerateRunStep:{projectId ?? ''}</div>
  ),
}));

// --- Helpers ---------------------------------------------------------------

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/project/:projectId" element={<ProjectPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setProject(status: ProjectStatus) {
  mockProject = { id: 'p1', name: 'Demo Project', status };
}

// Step labels used by the wizard (must match WIZARD_STEPS in ProjectPage).
const LABELS = {
  prepare: '准备目标站点',
  understand: '理解测试意图',
  explore: '探索与绑定',
  run: '生成与执行',
} as const;

// --- Tests -----------------------------------------------------------------

describe('ProjectPage wizard', () => {
  it('renders all four step labels', () => {
    setProject('draft');
    renderAt('/project/p1');
    expect(screen.getByText(LABELS.prepare)).toBeInTheDocument();
    expect(screen.getByText(LABELS.understand)).toBeInTheDocument();
    expect(screen.getByText(LABELS.explore)).toBeInTheDocument();
    expect(screen.getByText(LABELS.run)).toBeInTheDocument();
  });

  it('defaults to the prepare step and renders ConfigPanel when no ?step=', () => {
    setProject('draft');
    renderAt('/project/p1');
    expect(screen.getByTestId('config-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('analysis-panel')).not.toBeInTheDocument();
  });

  it('renders the prepare panel for ?step=prepare', () => {
    setProject('draft');
    renderAt('/project/p1?step=prepare');
    expect(screen.getByTestId('config-panel')).toBeInTheDocument();
  });

  it('renders analysis + scenario panels for ?step=understand', () => {
    setProject('draft');
    renderAt('/project/p1?step=understand');
    expect(screen.getByTestId('analysis-panel')).toBeInTheDocument();
    expect(screen.getByTestId('scenario-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('config-panel')).not.toBeInTheDocument();
  });

  it('renders the exploration panel for ?step=explore', () => {
    setProject('draft');
    renderAt('/project/p1?step=explore');
    expect(screen.getByTestId('exploration-panel')).toBeInTheDocument();
  });

  it('renders the GenerateRunStep panel for ?step=run', () => {
    setProject('draft');
    renderAt('/project/p1?step=run');
    expect(screen.getByTestId('generate-run-step')).toBeInTheDocument();
  });

  it('falls back to the prepare step for an invalid ?step= value', () => {
    setProject('draft');
    renderAt('/project/p1?step=bogus');
    expect(screen.getByTestId('config-panel')).toBeInTheDocument();
  });

  it('marks the active step as current via aria-current="step"', () => {
    setProject('draft');
    renderAt('/project/p1?step=understand');
    // UnderstandStep also renders the label as an <h2>, so scope the text
    // search to the Stepper's <span> via the selector option.
    const currentButton = screen
      .getByText(LABELS.understand, { selector: 'span' })
      .closest('button');
    expect(currentButton).toHaveAttribute('aria-current', 'step');
    // prepare is pending (draft project) so it must NOT be marked current.
    const prepareButton = screen
      .getByText(LABELS.prepare, { selector: 'span' })
      .closest('button');
    expect(prepareButton).not.toHaveAttribute('aria-current', 'step');
  });

  it('marks earlier steps as completed (clickable) based on project.status', () => {
    // explored => prepare & understand complete, explore default current.
    setProject('explored');
    renderAt('/project/p1');

    // Completed steps render a checkmark icon and are not disabled.
    const prepareButton = screen.getByText(LABELS.prepare).closest('button');
    expect(prepareButton).not.toBeDisabled();

    const understandButton = screen.getByText(LABELS.understand).closest('button');
    expect(understandButton).not.toBeDisabled();

    // run is pending for an explored project => disabled.
    const runButton = screen.getByText(LABELS.run).closest('button');
    expect(runButton).toBeDisabled();
  });

  it('switches panel when a completed step is clicked', () => {
    // explored => prepare is completed and clickable.
    setProject('explored');
    renderAt('/project/p1');

    // Default step for an explored project is still 'prepare' (URL has no ?step=).
    expect(screen.getByTestId('config-panel')).toBeInTheDocument();

    // Click the completed understand step -> URL updates -> panel switches.
    fireEvent.click(screen.getByText(LABELS.understand));
    expect(screen.getByTestId('analysis-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('config-panel')).not.toBeInTheDocument();
  });

  it('keeps project title visible', () => {
    setProject('draft');
    renderAt('/project/p1');
    expect(screen.getByText('项目: Demo Project')).toBeInTheDocument();
  });
});
