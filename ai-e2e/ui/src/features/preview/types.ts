export type PreviewThemePreference = 'system' | 'light' | 'dark';

export type PreviewCandidateStatus =
  | 'draft'
  | 'candidate_ready'
  | 'waiting_decision'
  | 'queued_at_safe_boundary'
  | 'verifying'
  | 'activated'
  | 'rejected'
  | 'failed'
  | 'stale';

export type PreviewChangeTarget =
  | 'current_module_asset'
  | 'same_url_scenario_graph'
  | 'same_url_foreign_module_asset'
  | 'cross_url_asset';

export type PreviewRunState =
  | 'running'
  | 'waiting_decision'
  | 'interrupted'
  | 'failed'
  | 'completed';

export interface PreviewContextScope {
  businessVersionId: string;
  businessVersionLabel: string;
  deployment: string;
  pageDefinitionId: string;
  pageLabel: string;
  url: string;
  selectedModuleId: string;
  visibleScenarioIds: string[];
  baseRevisionHashes: Record<string, string>;
}

export interface PreviewFunctionalScript {
  id: string;
  name: string;
  status: 'verified' | 'stale' | 'candidate';
  assertions: number;
}

export interface PreviewModule {
  id: string;
  pageDefinitionId: string;
  name: string;
  purpose: string;
  coverage: number;
  revision: string;
  requirementHash: string;
  prdFragmentIds: string[];
  acceptanceCriteria: string[];
  functionalPoints: string[];
  scripts: PreviewFunctionalScript[];
}

export interface PreviewPage {
  id: string;
  name: string;
  routeTemplate: string;
  liveUrl: string;
  modules: PreviewModule[];
}

export interface PreviewScenarioNode {
  id: string;
  label: string;
  moduleId: string;
  pageDefinitionId: string;
  status?: 'passed' | 'running' | 'failed' | 'skipped' | 'pending';
}

export interface PreviewScenario {
  id: string;
  name: string;
  summary: string;
  revision: string;
  pageDefinitionIds: string[];
  nodes: PreviewScenarioNode[];
  inputs: string[];
  outputs: string[];
}

export interface PreviewPrdFragment {
  id: string;
  heading: string;
  source: string;
  content: string;
}

export interface PreviewImpactDecision {
  id: string;
  kind: 'same_url_foreign_module' | 'cross_url';
  status: 'pending' | 'approved' | 'rejected';
  reason: string;
  affectedUrls: string[];
  affectedModules: string[];
  affectedScenarios: string[];
  baseRevisions: string[];
  targetRevision: string;
  sideEffects: string[];
}

export interface PreviewAuthoringAmendment {
  id: string;
  jobId: string;
  createdAt: string;
  status: PreviewCandidateStatus;
  target: PreviewChangeTarget;
  reason: string;
  changeKind: 'locator_only' | 'interaction' | 'contract' | 'requirement';
  scope: PreviewContextScope;
  affectedAssetIds: string[];
  summary: string;
  diff: Array<{ kind: 'add' | 'remove' | 'keep'; text: string }>;
  verificationPlan: string[];
  decision?: PreviewImpactDecision;
  auditNote?: string;
}

export interface PreviewLayoutPreferences {
  leftWidth: number;
  rightWidth: number;
  chatCollapsed: boolean;
  browserFocused: boolean;
  browserZoom: number;
  theme: PreviewThemePreference;
}

export interface PreviewRunFixture {
  id: string;
  name: string;
  state: PreviewRunState;
  statusLabel: string;
  description: string;
  activeScenarioId: string;
  browserUrl: string;
  elapsed: string;
  progress: number;
  todos: Array<{
    id: string;
    label: string;
    status: 'passed' | 'running' | 'failed' | 'skipped' | 'pending' | 'blocked';
    detail: string;
  }>;
}

export function requiresScopeDecision(target: PreviewChangeTarget): boolean {
  return target === 'same_url_foreign_module_asset' || target === 'cross_url_asset';
}

export function isAmendmentApplicable(
  amendment: PreviewAuthoringAmendment,
  scope: PreviewContextScope
): boolean {
  if (amendment.status !== 'candidate_ready') return false;
  if (amendment.scope.businessVersionId !== scope.businessVersionId) return false;
  if (amendment.scope.pageDefinitionId !== scope.pageDefinitionId) return false;
  if (
    amendment.target === 'current_module_asset' &&
    amendment.scope.selectedModuleId !== scope.selectedModuleId
  ) {
    return false;
  }
  return Object.entries(amendment.scope.baseRevisionHashes).every(
    ([assetId, hash]) => scope.baseRevisionHashes[assetId] === hash
  );
}
