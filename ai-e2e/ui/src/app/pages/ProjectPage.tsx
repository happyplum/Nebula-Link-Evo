import { useParams, useSearchParams, Link } from 'react-router-dom';
import { Stepper, type Step, type StepStatus } from '@/components/ui/stepper.js';
import { ConfigPanel } from '../../features/project/components/ConfigPanel.js';
import { UnderstandStep } from '../../features/analysis/components/UnderstandStep.js';
import ExplorationPanel from '../../features/exploration/components/ExplorationPanel.js';
import { GenerateRunStep } from '../../features/scripts/components/GenerateRunStep.js';
import { useProject } from '../../features/project/store/projectApi.js';
import type { ProjectStatus } from '@/types/project.js';

// 4-step wizard definition. Labels match the plan's Task 5 spec.
const WIZARD_STEPS = [
  { id: 'prepare', label: '准备目标站点', description: '配置项目与登录脚本' },
  { id: 'understand', label: '理解测试意图', description: '分析 PRD 与设计场景' },
  { id: 'explore', label: '探索与绑定', description: '探索站点并绑定 URL' },
  { id: 'run', label: '生成与执行', description: '生成脚本并执行测试' },
] as const;

type WizardStepId = (typeof WIZARD_STEPS)[number]['id'];

const STEP_IDS: readonly WizardStepId[] = WIZARD_STEPS.map((s) => s.id);

const VALID_STEP_SET = new Set<string>(STEP_IDS);

/**
 * Step completion is derived from `project.status`, which is the backend state
 * machine's authoritative signal. The state-machine gates (documented in
 * ai-e2e/AGENTS.md) guarantee the equivalences below:
 *   - prepare is done once the project leaves `draft`
 *   - understand (analysis) is done once status reaches `analyzed` or beyond
 *   - explore (URL binding) is done once status reaches `explored` or beyond
 *   - run is the terminal step and is never auto-completed
 */
const COMPLETED_STATUSES: Record<WizardStepId, ReadonlySet<ProjectStatus>> = {
  prepare: new Set<ProjectStatus>([
    'configuring',
    'analyzing',
    'analyzed',
    'exploring',
    'explored',
    'generating',
    'ready',
    'running',
    'completed',
  ]),
  understand: new Set<ProjectStatus>([
    'analyzed',
    'exploring',
    'explored',
    'generating',
    'ready',
    'running',
    'completed',
  ]),
  explore: new Set<ProjectStatus>([
    'explored',
    'generating',
    'ready',
    'running',
    'completed',
  ]),
  run: new Set<ProjectStatus>(),
};

function computeStepStatus(
  stepId: WizardStepId,
  activeStep: WizardStepId,
  projectStatus: ProjectStatus | undefined,
): StepStatus {
  if (stepId === activeStep) return 'current';
  if (projectStatus && COMPLETED_STATUSES[stepId].has(projectStatus)) return 'completed';
  return 'pending';
}

function resolveActiveStep(rawStep: string | null): WizardStepId {
  if (rawStep && VALID_STEP_SET.has(rawStep)) return rawStep as WizardStepId;
  return 'prepare';
}

export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project } = useProject(projectId || '');
  const [searchParams, setSearchParams] = useSearchParams();

  const activeStep = resolveActiveStep(searchParams.get('step'));
  const projectStatus = project?.status;

  const steps: Step[] = WIZARD_STEPS.map((s) => ({
    ...s,
    status: computeStepStatus(s.id, activeStep, projectStatus),
  }));

  const handleStepClick = (stepId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('step', stepId);
    setSearchParams(next, { replace: false });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header: back link + project title + status */}
      <div className="border-b border-border-default bg-surface-content px-6 pt-4 pb-3">
        <div className="mb-3 flex items-center gap-3">
          <Link
            to="/"
            className="text-xs text-text-muted transition-colors hover:text-text-primary"
          >
            ← 工作区
          </Link>
        </div>
        <h1 className="text-lg font-semibold text-text-primary">
          项目: {project?.name || projectId}
        </h1>
        {projectStatus && (
          <div className="mt-1 text-xs text-text-secondary">状态: {projectStatus}</div>
        )}
        <div className="mt-4">
          <Stepper steps={steps} onStepClick={handleStepClick} />
        </div>
      </div>

      {/* Step panel */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeStep === 'prepare' && <ConfigPanel />}
        {activeStep === 'understand' && <UnderstandStep />}
        {activeStep === 'explore' && <ExplorationPanel />}
        {activeStep === 'run' && <GenerateRunStep />}
      </div>
    </div>
  );
}
