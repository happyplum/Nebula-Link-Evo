import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CirclePause,
  CirclePlay,
  Focus,
  GripVertical,
  LocateFixed,
  Maximize2,
  Moon,
  Orbit,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  RotateCcw,
  Square,
  Sun,
  XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { semanticApi } from './api.js';
import { BrowserStage } from './BrowserStage.js';
import { AgentActivityPanel } from './AgentActivityPanel.js';
import { ContextTree } from './ContextTree.js';
import { InspectorPanel, type ContextPreview, type InspectorTab } from './InspectorPanel.js';
import type {
  AuthoringAmendment,
  AuthoringSnapshot,
  LayoutPreferences,
  RunSnapshot,
  SemanticWorkspace,
} from './types.js';
import { record, text } from './types.js';
import { useSemanticEventStream } from './useSemanticEventStream.js';
import { useAgentActivityStream } from './useAgentActivityStream.js';
import './semantic.css';

const STORAGE_KEY = 'ai-e2e.semantic.layout.v1';
const DEFAULT_LAYOUT: LayoutPreferences = {
  leftWidth: 272,
  rightWidth: 380,
  chatCollapsed: false,
  browserFocused: false,
  browserCollapsed: false,
  browserZoom: 90,
  theme: 'system',
};
const MIN_LEFT = 232;
const MAX_LEFT = 420;
const MIN_RIGHT = 320;
const MAX_RIGHT = 540;
const MIN_BROWSER = 520;

function readPreferences(): LayoutPreferences {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_LAYOUT;
    const value = JSON.parse(stored) as Partial<LayoutPreferences>;
    const widths = clampLayout(
      Number.isFinite(value.leftWidth) ? Number(value.leftWidth) : DEFAULT_LAYOUT.leftWidth,
      Number.isFinite(value.rightWidth) ? Number(value.rightWidth) : DEFAULT_LAYOUT.rightWidth
    );
    return {
      ...DEFAULT_LAYOUT,
      ...widths,
      chatCollapsed:
        typeof value.chatCollapsed === 'boolean'
          ? value.chatCollapsed
          : DEFAULT_LAYOUT.chatCollapsed,
      browserFocused:
        typeof value.browserFocused === 'boolean'
          ? value.browserFocused
          : DEFAULT_LAYOUT.browserFocused,
      browserCollapsed:
        typeof value.browserCollapsed === 'boolean'
          ? value.browserCollapsed
          : DEFAULT_LAYOUT.browserCollapsed,
      browserZoom: Number.isFinite(value.browserZoom)
        ? Math.min(150, Math.max(50, Number(value.browserZoom)))
        : DEFAULT_LAYOUT.browserZoom,
      theme: ['system', 'light', 'dark'].includes(value.theme ?? '')
        ? (value.theme as LayoutPreferences['theme'])
        : DEFAULT_LAYOUT.theme,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function pageUrl(workspace: SemanticWorkspace, pageId: string): string {
  const page = workspace.pages.find((entry) => entry.id === pageId);
  return text(page?.currentRevision.payload.routeTemplate, 'about:blank');
}

function assetName(payload: Record<string, unknown>, fallback: string): string {
  return text(payload.name, fallback);
}

function runLifecycle(snapshot?: RunSnapshot): string {
  return text(snapshot?.run.lifecycle, '未创建');
}

function jobLifecycle(snapshot?: AuthoringSnapshot): string {
  return text(snapshot?.job.lifecycle, '空闲');
}

function terminalJob(state: string) {
  return ['completed', 'cancelled', 'failed'].includes(state);
}

function clampLayout(left: number, right: number) {
  const available = Math.max(1_100, window.innerWidth);
  let nextLeft = Math.min(MAX_LEFT, Math.max(MIN_LEFT, left));
  let nextRight = Math.min(MAX_RIGHT, Math.max(MIN_RIGHT, right));
  const overflow = nextLeft + nextRight + MIN_BROWSER + 24 - available;
  if (overflow > 0) {
    const rightReduction = Math.min(overflow, nextRight - MIN_RIGHT);
    nextRight -= rightReduction;
    nextLeft = Math.max(MIN_LEFT, nextLeft - (overflow - rightReduction));
  }
  return { leftWidth: nextLeft, rightWidth: nextRight };
}

function Splitter({
  side,
  value,
  onPointerDown,
  onResize,
  onReset,
}: {
  side: 'left' | 'right';
  value: number;
  onPointerDown: (side: 'left' | 'right', event: ReactPointerEvent<HTMLDivElement>) => void;
  onResize: (side: 'left' | 'right', delta: number) => void;
  onReset: (side: 'left' | 'right') => void;
}) {
  return (
    <div
      className="semantic-splitter"
      role="separator"
      aria-label={`${side === 'left' ? '左侧上下文' : '右侧检查器'}宽度调整`}
      aria-orientation="vertical"
      aria-valuemin={side === 'left' ? MIN_LEFT : MIN_RIGHT}
      aria-valuemax={side === 'left' ? MAX_LEFT : MAX_RIGHT}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={(event) => onPointerDown(side, event)}
      onDoubleClick={() => onReset(side)}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const physical = event.key === 'ArrowRight' ? 16 : -16;
        onResize(side, side === 'left' ? physical : -physical);
      }}
    >
      <GripVertical aria-hidden="true" />
    </div>
  );
}

export function SemanticAuthoringPage() {
  return <SemanticWorkbench mode="authoring" />;
}

export function SemanticRunPage() {
  return <SemanticWorkbench mode="run" />;
}

export function SemanticWorkbench({
  mode,
  eventStreams = true,
}: {
  mode: 'authoring' | 'run';
  eventStreams?: boolean;
}) {
  const {
    projectId = '',
    versionId: pathVersionId,
    runId = '',
  } = useParams<{
    projectId: string;
    versionId: string;
    runId: string;
  }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [layout, setLayout] = useState(readPreferences);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('context');
  const [contextPreview, setContextPreview] = useState<ContextPreview>('module');

  const authoringJobId = searchParams.get('job') ?? '';
  const authoringKey = useMemo(
    () => ['semantic-authoring', authoringJobId] as const,
    [authoringJobId]
  );
  const runKey = useMemo(() => ['semantic-run', runId] as const, [runId]);

  const authoringStream = useSemanticEventStream<AuthoringSnapshot>({
    enabled: eventStreams && mode === 'authoring' && Boolean(authoringJobId),
    endpoint: `/api/v1/authoring-jobs/${encodeURIComponent(authoringJobId)}/events`,
    snapshotEvent: 'authoring.snapshot',
    queryKey: authoringKey,
  });
  const runStream = useSemanticEventStream<RunSnapshot>({
    enabled: eventStreams && mode === 'run' && Boolean(runId),
    endpoint: `/api/v1/runs/${encodeURIComponent(runId)}/events`,
    snapshotEvent: 'run.snapshot',
    queryKey: runKey,
  });

  const runQuery = useQuery({
    queryKey: runKey,
    queryFn: () => semanticApi.getRunSnapshot(runId),
    enabled: mode === 'run' && Boolean(runId),
    refetchInterval: (query) =>
      ['completed', 'cancelled'].includes(runLifecycle(query.state.data)) || runStream === 'live'
        ? false
        : 3_000,
  });
  const runVersionId = text(runQuery.data?.run.businessVersionId, '');
  const versionId = pathVersionId ?? searchParams.get('version') ?? runVersionId;
  const workspaceQuery = useQuery({
    queryKey: ['semantic-workspace', versionId],
    queryFn: () => semanticApi.getWorkspace(versionId),
    enabled: Boolean(versionId),
  });
  const authoringQuery = useQuery({
    queryKey: authoringKey,
    queryFn: () => semanticApi.getAuthoringSnapshot(authoringJobId),
    enabled: mode === 'authoring' && Boolean(authoringJobId),
    refetchInterval: (query) =>
      terminalJob(jobLifecycle(query.state.data)) || authoringStream === 'live' ? false : 3_000,
  });
  const amendmentsQuery = useQuery({
    queryKey: ['semantic-amendments', authoringJobId],
    queryFn: () => semanticApi.listAmendments(authoringJobId),
    enabled: mode === 'authoring' && Boolean(authoringJobId),
  });

  const activityContextId = mode === 'run' ? runId : authoringJobId;
  const activitySnapshot = useAgentActivityStream({
    enabled: eventStreams && Boolean(activityContextId),
    endpoint:
      mode === 'run'
        ? `/api/v1/runs/${encodeURIComponent(runId)}/activity`
        : `/api/v1/authoring-jobs/${encodeURIComponent(authoringJobId)}/activity`,
  });

  useEffect(() => {
    if (!authoringQuery.data?.seq) return;
    void queryClient.invalidateQueries({ queryKey: ['semantic-amendments', authoringJobId] });
  }, [authoringJobId, authoringQuery.data?.seq, queryClient]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }, [layout]);

  useEffect(() => {
    const onResize = () =>
      setLayout((current) => ({
        ...current,
        ...clampLayout(current.leftWidth, current.rightWidth),
      }));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const workspace = workspaceQuery.data;
  const pageParam = searchParams.get('page') ?? '';
  const moduleParam = searchParams.get('module') ?? '';
  const scenarioParam = searchParams.get('scenario') ?? '';
  const pageId = workspace?.pages.some((page) => page.id === pageParam)
    ? pageParam
    : (workspace?.functionalModules.find((module) => module.id === moduleParam)
        ?.primaryPageDefinitionId ??
      workspace?.pages[0]?.id ??
      '');
  const pageModules =
    workspace?.functionalModules.filter((module) => module.primaryPageDefinitionId === pageId) ??
    [];
  const moduleId = workspace?.functionalModules.some((module) => module.id === moduleParam)
    ? moduleParam
    : (pageModules[0]?.id ?? workspace?.functionalModules[0]?.id ?? '');
  const scenarioId = workspace?.scenarios.some((scenario) => scenario.id === scenarioParam)
    ? scenarioParam
    : (workspace?.scenarios[0]?.id ?? '');
  const currentModule = workspace?.functionalModules.find((module) => module.id === moduleId);
  const currentPage = workspace?.pages.find((page) => page.id === pageId);
  const currentScenario = workspace?.scenarios.find((scenario) => scenario.id === scenarioId);
  const browserUrl = searchParams.get('url') ?? (workspace ? pageUrl(workspace, pageId) : '');

  useEffect(() => {
    if (!workspace || !pageId || !moduleId) return;
    const next = new URLSearchParams(searchParams);
    let changed = false;
    for (const [key, value] of [
      ['page', pageId],
      ['module', moduleId],
      ['scenario', scenarioId],
    ] as const) {
      if (value && next.get(key) !== value) {
        next.set(key, value);
        changed = true;
      }
    }
    if (!next.get('url')) {
      next.set('url', pageUrl(workspace, pageId));
      changed = true;
    }
    if (mode === 'run' && versionId && !next.get('version')) {
      next.set('version', versionId);
      changed = true;
    }
    if (changed) setSearchParams(next, { replace: true });
  }, [mode, moduleId, pageId, scenarioId, searchParams, setSearchParams, versionId, workspace]);

  const updateContext = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next);
  };

  const createAuthoring = useMutation({
    mutationFn: semanticApi.createAuthoringJob,
    onSuccess: (result, input) => {
      updateContext({ job: result.id, url: input.currentUrl ?? browserUrl });
      setInspectorTab(input.intent === 'locate_in_browser' ? 'evidence' : 'diff');
      toast.success(
        input.intent === 'locate_in_browser' ? '已加入浏览器定位队列' : '已创建重新编排候选任务'
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const bootstrapStarted = useRef(false);
  useEffect(() => {
    if (
      mode !== 'authoring' ||
      searchParams.get('bootstrap') !== '1' ||
      authoringJobId ||
      !workspace ||
      !moduleId ||
      bootstrapStarted.current
    ) {
      return;
    }
    bootstrapStarted.current = true;
    createAuthoring.mutate({
      versionId,
      mode: 'bootstrap',
      intent: 'author_assets',
      targetType: 'functional_module',
      targetId: moduleId,
      currentUrl: browserUrl,
      reason: '根据 PRD、初始 semantic 资产图与真实浏览器证据完成首次编排',
    });
  }, [
    authoringJobId,
    browserUrl,
    createAuthoring,
    mode,
    moduleId,
    searchParams,
    versionId,
    workspace,
  ]);
  const createRun = useMutation({
    mutationFn: semanticApi.createRun,
    onSuccess: (result) => {
      navigate(
        `/semantic/${projectId}/runs/${result.id}?version=${encodeURIComponent(versionId)}&page=${encodeURIComponent(pageId)}&module=${encodeURIComponent(moduleId)}&scenario=${encodeURIComponent(scenarioId)}&url=${encodeURIComponent(browserUrl)}`
      );
      toast.success(
        result.admission === 'approval_required' ? '运行已创建，等待副作用审批' : '运行已创建'
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const amendmentMutation = useMutation({
    mutationFn: async (input: {
      kind: 'apply' | 'reject' | 'approve' | 'reject_decision';
      amendmentId: string;
      decisionId?: string;
    }) => {
      if (input.kind === 'apply')
        return semanticApi.commandAmendment(input.amendmentId, {
          action: 'queue_at_safe_boundary',
        });
      if (input.kind === 'reject')
        return semanticApi.commandAmendment(input.amendmentId, {
          action: 'reject',
          reason: '用户在工作台拒绝候选',
        });
      return semanticApi.answerAmendmentDecision(
        input.amendmentId,
        input.decisionId ?? '',
        input.kind === 'approve' ? 'approve' : 'reject'
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['semantic-amendments', authoringJobId] });
      void queryClient.invalidateQueries({ queryKey: authoringKey });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const runCommand = useMutation({
    mutationFn: (action: 'start' | 'pause' | 'resume' | 'cancel' | 'close_browser') =>
      semanticApi.commandRun(runId, runQuery.data?.stateVersion ?? 0, action),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: runKey }),
    onError: (error: Error) => {
      toast.error(error.message);
      void queryClient.invalidateQueries({ queryKey: runKey });
    },
  });
  const authoringCommand = useMutation({
    mutationFn: (action: 'pause' | 'resume' | 'cancel') =>
      semanticApi.commandAuthoringJob(
        authoringJobId,
        authoringQuery.data?.stateVersion ?? 0,
        action
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: authoringKey }),
    onError: (error: Error) => {
      toast.error(error.message);
      void queryClient.invalidateQueries({ queryKey: authoringKey });
    },
  });
  const runDecision = useMutation({
    mutationFn: ({ decisionId, answerKey }: { decisionId: string; answerKey: string }) =>
      semanticApi.answerRunDecision(runId, decisionId, answerKey),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: runKey }),
    onError: (error: Error) => toast.error(error.message),
  });
  const resumeTodo = useMutation({
    mutationFn: (todoId: string) => semanticApi.resumeTodo(runId, todoId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: runKey }),
    onError: (error: Error) => toast.error(error.message),
  });

  const amendments = amendmentsQuery.data ?? [];
  const latestAmendment = amendments.at(-1);
  const activeSnapshot = mode === 'run' ? runQuery.data : authoringQuery.data;
  const browserJob = activeSnapshot?.browserJob;
  const browserActive =
    Boolean(browserJob?.browserSessionId) ||
    ['acquiring', 'active', 'releasing'].includes(text(browserJob?.state));
  const operationBusy =
    createAuthoring.isPending ||
    createRun.isPending ||
    amendmentMutation.isPending ||
    authoringCommand.isPending ||
    runCommand.isPending ||
    runDecision.isPending ||
    resumeTodo.isPending;
  const workflowBusy =
    mode === 'authoring' &&
    Boolean(authoringJobId) &&
    !terminalJob(jobLifecycle(authoringQuery.data));
  const busy = operationBusy || workflowBusy;
  const streamState = mode === 'run' ? runStream : authoringStream;

  const resize = (side: 'left' | 'right', delta: number) => {
    setLayout((current) => {
      const next = clampLayout(
        side === 'left' ? current.leftWidth + delta : current.leftWidth,
        side === 'right' ? current.rightWidth + delta : current.rightWidth
      );
      return { ...current, ...next };
    });
  };
  const pointerDown = (side: 'left' | 'right', event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const start = side === 'left' ? layout.leftWidth : layout.rightWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const physical = moveEvent.clientX - startX;
      setLayout((current) => ({
        ...current,
        ...clampLayout(
          side === 'left' ? start + physical : current.leftWidth,
          side === 'right' ? start - physical : current.rightWidth
        ),
      }));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const applicable = (amendment: AuthoringAmendment) => {
    if (amendment.state !== 'candidate_ready')
      return {
        allowed: false,
        reason:
          amendment.state === 'waiting_decision'
            ? '仍有范围扩展等待审批'
            : `候选当前状态为 ${amendment.state}`,
      };
    for (const change of amendment.changes) {
      const targetModuleId = text(change.targetFunctionalModuleId, '');
      const isBootstrapCreate =
        text(authoringQuery.data?.job.mode) === 'bootstrap' &&
        text(change.baseRevisionId) === text(change.candidateRevisionId);
      if (!isBootstrapCreate && targetModuleId && targetModuleId !== moduleId)
        return { allowed: false, reason: '候选属于其他模块，切回原模块后才能应用' };
      const assetType = text(change.assetType);
      const assetId = text(change.assetId);
      const current =
        assetType === 'module_requirement'
          ? undefined
          : assetType === 'functional_module'
            ? workspace?.functionalModules.find((asset) => asset.id === assetId)?.currentRevision
            : assetType === 'functional_script'
              ? workspace?.functionalScripts.find((asset) => asset.id === assetId)?.currentRevision
              : assetType === 'test_scenario'
                ? workspace?.scenarios.find((asset) => asset.id === assetId)?.currentRevision
                : workspace?.businessModules.find((asset) => asset.id === assetId)?.currentRevision;
      if (current && current.contentSha256 !== text(change.baseRevisionSha256))
        return { allowed: false, reason: '基础修订已变化，候选已过期' };
    }
    return { allowed: true };
  };

  if (workspaceQuery.isLoading || (mode === 'run' && runQuery.isLoading))
    return <WorkbenchState label="正在加载 semantic v1 工作台…" />;
  const loadError = workspaceQuery.error ?? runQuery.error;
  if (loadError || !workspace)
    return <WorkbenchState error label={loadError?.message ?? '找不到业务版本工作区'} />;

  const defaultDeployment = workspace.version.deploymentBindings?.find(
    (binding) => binding.isDefault
  )?.deploymentRevisionId;
  const validation = workspace.validations.find(
    (entry) =>
      entry.status === 'valid' &&
      (!defaultDeployment || entry.deploymentRevisionId === defaultDeployment)
  );
  const canRun = Boolean(
    currentScenario && validation && currentScenario.currentRevision.readinessStatus === 'verified'
  );
  const runState = runLifecycle(runQuery.data);
  const interruptedTodos =
    runQuery.data?.todos.filter((todo) =>
      ['interrupted', 'outcome_unknown'].includes(text(todo.state))
    ) ?? [];

  return (
    <div
      className={`semantic-root${layout.browserFocused ? ' is-focused' : ''}`}
      data-theme={layout.theme}
    >
      <a className="semantic-skip" href="#semantic-browser">
        跳到浏览器操作区
      </a>
      <header className="semantic-topbar">
        <Link to={`/semantic/${projectId}`} className="semantic-back" aria-label="返回业务版本列表">
          <ArrowLeft aria-hidden="true" />
        </Link>
        <div className="semantic-product">
          <span className="semantic-product-mark" aria-hidden="true">
            <Orbit />
          </span>
          <div>
            <small>NEBULA E2E</small>
            <h1>{mode === 'run' ? '运行工作台' : '资产编排工作台'}</h1>
          </div>
        </div>
        <div className="semantic-context-strip">
          <ContextItem label="业务版本" value={workspace.version.name} />
          <ContextItem
            label="环境"
            value={text(
              record(validation?.verificationScope).environment,
              validation ? '已验证环境' : '未验证'
            )}
            tone={validation ? 'green' : 'amber'}
          />
          <ContextItem
            label="页面"
            value={
              currentPage
                ? assetName(currentPage.currentRevision.payload, currentPage.pageKey)
                : '—'
            }
          />
          <ContextItem
            label="模块"
            value={
              currentModule
                ? assetName(currentModule.currentRevision.payload, currentModule.moduleKey)
                : '—'
            }
          />
          <ContextItem label="场景" value={currentScenario?.name ?? '—'} />
        </div>
        <div className="semantic-top-actions">
          <span className={`semantic-stream is-${streamState}`}>
            {streamState === 'live' ? '实时同步' : streamState === 'idle' ? '按需刷新' : '正在连接'}
          </span>
          <button
            type="button"
            onClick={() =>
              setLayout((current) => ({
                ...current,
                theme:
                  current.theme === 'system'
                    ? 'dark'
                    : current.theme === 'dark'
                      ? 'light'
                      : 'system',
              }))
            }
            aria-label={`主题：${layout.theme}`}
          >
            {layout.theme === 'dark' ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={() =>
              setLayout((current) => ({ ...current, browserFocused: !current.browserFocused }))
            }
            aria-label={layout.browserFocused ? '退出浏览器专注模式' : '浏览器专注模式'}
          >
            <Focus aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        className="semantic-body"
        style={{
          gridTemplateColumns: `${layout.leftWidth}px 12px minmax(${MIN_BROWSER}px, 1fr) 12px ${layout.rightWidth}px`,
        }}
      >
        <ContextTree
          workspace={workspace}
          pageId={pageId}
          moduleId={moduleId}
          scenarioId={scenarioId}
          todos={runQuery.data?.todos}
          onPreview={(value) => {
            setContextPreview(value);
            setInspectorTab('context');
          }}
          onSelectPage={(id) => {
            const nextModule = workspace.functionalModules.find(
              (module) => module.primaryPageDefinitionId === id
            );
            updateContext({ page: id, module: nextModule?.id ?? null });
          }}
          onSelectModule={(id) => {
            const ownerPage = workspace.functionalModules.find(
              (module) => module.id === id
            )?.primaryPageDefinitionId;
            updateContext({ module: id, ...(ownerPage ? { page: ownerPage } : {}) });
          }}
          onSelectScenario={(id) => updateContext({ scenario: id })}
        />
        <Splitter
          side="left"
          value={layout.leftWidth}
          onPointerDown={pointerDown}
          onResize={resize}
          onReset={() =>
            setLayout((current) => ({ ...current, leftWidth: DEFAULT_LAYOUT.leftWidth }))
          }
        />

        <main className="semantic-browser-column" id="semantic-browser">
          <div className="semantic-browser-actions">
            <UrlEditor
              key={browserUrl}
              url={browserUrl}
              disabled={busy || mode === 'run'}
              onLocate={(url) =>
                createAuthoring.mutate({
                  versionId,
                  mode: 'recheck',
                  intent: 'locate_in_browser',
                  targetType: 'functional_module',
                  targetId: moduleId,
                  currentUrl: url,
                  reason: `在浏览器中定位 ${url}`,
                })
              }
            />
            <div className="semantic-action-cluster">
              {mode === 'authoring' ? (
                <>
                  <button
                    type="button"
                    disabled={busy || !moduleId}
                    onClick={() =>
                      createAuthoring.mutate({
                        versionId,
                        mode: 'repair',
                        intent: 'author_assets',
                        targetType: 'functional_module',
                        targetId: moduleId,
                        currentUrl: browserUrl,
                        reason: '手动触发当前模块重新编排',
                      })
                    }
                  >
                    <RefreshCw aria-hidden="true" />
                    模块重新编排
                  </button>
                  <button
                    type="button"
                    disabled={busy || !scenarioId}
                    onClick={() =>
                      createAuthoring.mutate({
                        versionId,
                        mode: 'repair',
                        intent: 'author_assets',
                        targetType: 'test_scenario',
                        targetId: scenarioId,
                        currentUrl: browserUrl,
                        reason: '手动触发当前场景重新编排',
                      })
                    }
                  >
                    <RefreshCw aria-hidden="true" />
                    场景重新编排
                  </button>
                  <button
                    type="button"
                    className="is-run"
                    disabled={!canRun || createRun.isPending}
                    title={canRun ? '创建冻结语义运行' : '需要有效验证范围与 verified 场景'}
                    onClick={() => {
                      if (!currentScenario || !validation) return;
                      createRun.mutate({
                        projectId,
                        businessVersionId: versionId,
                        scenarioRevisionId: currentScenario.currentRevision.id,
                        deploymentRevisionId: validation.deploymentRevisionId,
                      });
                    }}
                  >
                    <CirclePlay aria-hidden="true" />
                    运行场景
                  </button>
                </>
              ) : (
                <RunControls
                  state={runState}
                  busy={runCommand.isPending}
                  onCommand={(action) => runCommand.mutate(action)}
                />
              )}
            </div>
          </div>

          {mode === 'run' && (
            <div className={`semantic-run-banner is-${runState}`}>
              <span>
                <strong>运行状态：{runState}</strong>
                <small>
                  state v{runQuery.data?.stateVersion ?? 0} · {runQuery.data?.todos.length ?? 0} 个
                  TODO
                </small>
              </span>
              {interruptedTodos.map((todo) => (
                <button
                  type="button"
                  disabled={resumeTodo.isPending}
                  key={text(todo.id)}
                  onClick={() => resumeTodo.mutate(text(todo.id))}
                >
                  <RotateCcw aria-hidden="true" />
                  恢复 {text(todo.todoKey)}
                </button>
              ))}
            </div>
          )}
          {mode === 'authoring' && authoringJobId && (
            <div className={`semantic-run-banner is-${jobLifecycle(authoringQuery.data)}`}>
              <span>
                <strong>编排任务：{jobLifecycle(authoringQuery.data)}</strong>
                <small>
                  {authoringJobId.slice(0, 12)} · seq {authoringQuery.data?.seq ?? 0}
                </small>
              </span>
              <span className="semantic-action-cluster" aria-label="编排任务控制">
                {jobLifecycle(authoringQuery.data) === 'paused' ? (
                  <button
                    type="button"
                    disabled={authoringCommand.isPending}
                    onClick={() => authoringCommand.mutate('resume')}
                  >
                    <CirclePlay aria-hidden="true" />
                    继续
                  </button>
                ) : !terminalJob(jobLifecycle(authoringQuery.data)) &&
                  jobLifecycle(authoringQuery.data) !== 'cancelling' ? (
                  <button
                    type="button"
                    disabled={authoringCommand.isPending}
                    onClick={() => authoringCommand.mutate('pause')}
                  >
                    <CirclePause aria-hidden="true" />
                    暂停
                  </button>
                ) : null}
                {!terminalJob(jobLifecycle(authoringQuery.data)) &&
                jobLifecycle(authoringQuery.data) !== 'cancelling' ? (
                  <button
                    type="button"
                    disabled={authoringCommand.isPending}
                    onClick={() => authoringCommand.mutate('cancel')}
                  >
                    <XCircle aria-hidden="true" />
                    取消
                  </button>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => {
                  void authoringQuery.refetch();
                  void amendmentsQuery.refetch();
                }}
              >
                <RefreshCw aria-hidden="true" />
                刷新
              </button>
            </div>
          )}

          <BrowserStage
            url={browserUrl}
            zoom={layout.browserZoom}
            collapsed={layout.browserCollapsed}
            browserActive={browserActive}
            candidateSummary={
              latestAmendment &&
              !['activated', 'rejected', 'failed', 'stale'].includes(latestAmendment.state)
                ? latestAmendment.reason
                : undefined
            }
          />
          <div className="semantic-browser-footer">
            <button
              type="button"
              onClick={() =>
                setLayout((current) => ({
                  ...current,
                  browserCollapsed: !current.browserCollapsed,
                }))
              }
            >
              {layout.browserCollapsed ? (
                <PanelLeftOpen aria-hidden="true" />
              ) : (
                <PanelLeftClose aria-hidden="true" />
              )}
              {layout.browserCollapsed ? '恢复画面' : '收起画面'}
            </button>
            <span>持续挂载 · 布局调整不会刷新浏览器会话</span>
            <div>
              <button
                type="button"
                onClick={() =>
                  setLayout((current) => ({
                    ...current,
                    browserZoom: Math.max(50, current.browserZoom - 10),
                  }))
                }
                aria-label="缩小浏览器画面"
              >
                <ZoomOut aria-hidden="true" />
              </button>
              <output>{layout.browserZoom}%</output>
              <button
                type="button"
                onClick={() =>
                  setLayout((current) => ({
                    ...current,
                    browserZoom: Math.min(150, current.browserZoom + 10),
                  }))
                }
                aria-label="放大浏览器画面"
              >
                <ZoomIn aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setLayout((current) => ({ ...current, browserZoom: DEFAULT_LAYOUT.browserZoom }))
                }
                aria-label="复位浏览器缩放"
              >
                <Maximize2 aria-hidden="true" />
              </button>
            </div>
          </div>
        </main>

        <Splitter
          side="right"
          value={layout.rightWidth}
          onPointerDown={pointerDown}
          onResize={resize}
          onReset={() =>
            setLayout((current) => ({ ...current, rightWidth: DEFAULT_LAYOUT.rightWidth }))
          }
        />
        <aside className="semantic-right-rail">
          <InspectorPanel
            tab={inspectorTab}
            preview={contextPreview}
            workspace={workspace}
            moduleId={moduleId}
            scenarioId={scenarioId}
            amendments={amendments}
            runSnapshot={runQuery.data}
            busy={operationBusy}
            applicability={applicable}
            onTab={setInspectorTab}
            onPreview={setContextPreview}
            onApprove={(amendmentId, decisionId) =>
              amendmentMutation.mutate({ kind: 'approve', amendmentId, decisionId })
            }
            onRejectDecision={(amendmentId, decisionId) =>
              amendmentMutation.mutate({ kind: 'reject_decision', amendmentId, decisionId })
            }
            onApply={(amendmentId) => amendmentMutation.mutate({ kind: 'apply', amendmentId })}
            onRejectAmendment={(amendmentId) =>
              amendmentMutation.mutate({ kind: 'reject', amendmentId })
            }
            onRunDecision={(decisionId, answerKey) => runDecision.mutate({ decisionId, answerKey })}
          />
          <AgentActivityPanel
            collapsed={layout.chatCollapsed}
            busy={busy}
            readOnly={mode === 'run'}
            scope={{
              version: workspace.version.name,
              url: browserUrl,
              module: currentModule
                ? assetName(currentModule.currentRevision.payload, currentModule.moduleKey)
                : '—',
              revision: currentModule?.currentRevision.contentSha256 ?? '',
            }}
            snapshot={activitySnapshot}
            onToggle={() =>
              setLayout((current) => ({ ...current, chatCollapsed: !current.chatCollapsed }))
            }
            onSend={
              mode === 'authoring'
                ? (message) =>
                    createAuthoring.mutate({
                      versionId,
                      mode: 'repair',
                      intent: 'author_assets',
                      targetType: 'functional_module',
                      targetId: moduleId,
                      currentUrl: browserUrl,
                      reason: message,
                    })
                : undefined
            }
          />
          {mode === 'run' && (
            <Link
              className="semantic-run-return"
              to={`/semantic/${projectId}/authoring/${versionId}?page=${encodeURIComponent(pageId)}&module=${encodeURIComponent(moduleId)}&scenario=${encodeURIComponent(scenarioId)}&url=${encodeURIComponent(browserUrl)}`}
            >
              需要修改资产？返回编排
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}

function RunControls({
  state,
  busy,
  onCommand,
}: {
  state: string;
  busy: boolean;
  onCommand: (action: 'start' | 'pause' | 'resume' | 'cancel' | 'close_browser') => void;
}) {
  return (
    <>
      {state === 'ready' && (
        <button type="button" className="is-run" disabled={busy} onClick={() => onCommand('start')}>
          <CirclePlay aria-hidden="true" />
          开始运行
        </button>
      )}
      {state === 'running' && (
        <button type="button" disabled={busy} onClick={() => onCommand('pause')}>
          <CirclePause aria-hidden="true" />
          暂停
        </button>
      )}
      {['paused', 'interrupted'].includes(state) && (
        <button
          type="button"
          className="is-run"
          disabled={busy}
          onClick={() => onCommand('resume')}
        >
          <CirclePlay aria-hidden="true" />
          继续
        </button>
      )}
      {['ready', 'running', 'paused', 'cancelling'].includes(state) && (
        <button
          type="button"
          disabled={busy || state === 'cancelling'}
          onClick={() => onCommand('cancel')}
        >
          <XCircle aria-hidden="true" />
          取消
        </button>
      )}
      {['completed', 'cancelled'].includes(state) && (
        <button type="button" disabled={busy} onClick={() => onCommand('close_browser')}>
          <Square aria-hidden="true" />
          关闭浏览器
        </button>
      )}
    </>
  );
}

function UrlEditor({
  url,
  disabled,
  onLocate,
}: {
  url: string;
  disabled: boolean;
  onLocate: (url: string) => void;
}) {
  const [draft, setDraft] = useState(url);
  return (
    <div className="semantic-url-editor">
      <LocateFixed aria-hidden="true" />
      <input
        name="browser-target-url"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        aria-label="浏览器目标 URL"
      />
      <button
        type="button"
        className="is-primary"
        disabled={disabled || !draft.trim()}
        onClick={() => onLocate(draft.trim())}
      >
        <LocateFixed aria-hidden="true" />
        在浏览器中定位
      </button>
    </div>
  );
}

function ContextItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'green' | 'amber';
}) {
  return (
    <div className={tone ? `is-${tone}` : ''}>
      <small>{label}</small>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function WorkbenchState({ label, error = false }: { label: string; error?: boolean }) {
  return (
    <div className={`semantic-workbench-state${error ? ' is-error' : ''}`}>
      {error ? (
        <XCircle aria-hidden="true" />
      ) : (
        <RefreshCw className="is-spin" aria-hidden="true" />
      )}
      <strong>{label}</strong>
      <Link to="/">返回工作区</Link>
    </div>
  );
}
