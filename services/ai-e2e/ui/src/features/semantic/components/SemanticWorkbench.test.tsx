import type {
  AssetRevision,
  AssetReadinessStatus,
} from '../../../../../src/contracts/business-version.js';
import type {
  AuthoringSnapshotV1 as AuthoringSnapshot,
  RunSnapshotV1 as RunSnapshot,
  SemanticWorkspaceV1 as SemanticWorkspace,
} from '../../../../../src/contracts/semantic-control.js';
import type { AmendmentRecord as AuthoringAmendment } from '../../../../../src/contracts/semantic-authoring.js';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SemanticWorkbench } from './SemanticWorkbench.js';

const api = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  getAuthoringSnapshot: vi.fn(),
  listAmendments: vi.fn(),
  createAuthoringJob: vi.fn(),
  commandAuthoringJob: vi.fn(),
  commandAmendment: vi.fn(),
  answerAmendmentDecision: vi.fn(),
  createRun: vi.fn(),
  getRunSnapshot: vi.fn(),
  commandRun: vi.fn(),
  answerRunDecision: vi.fn(),
  resumeTodo: vi.fn(),
}));

vi.mock('../api/api.js', () => ({ semanticApi: api }));

const stream = vi.hoisted(() => {
  const state = { authoring: 'idle', run: 'idle' };
  return {
    state,
    useSemanticEventStream: vi.fn((options: { snapshotEvent?: string }) =>
      options.snapshotEvent === 'authoring.snapshot' ? state.authoring : state.run
    ),
  };
});

vi.mock('../hooks/useSemanticEventStream.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useSemanticEventStream.js')>();
  return { ...actual, useSemanticEventStream: stream.useSemanticEventStream };
});

const revision = (
  id: string,
  payload: Record<string, unknown>,
  readinessStatus?: AssetReadinessStatus
): AssetRevision => ({
  id,
  revisionNo: 3,
  schemaId: String(payload.schema),
  contentSha256: `${id}-sha`,
  validationStatus: 'valid',
  ...(readinessStatus ? { readinessStatus } : {}),
  payload,
});

const workspace: SemanticWorkspace = {
  schema: 'nebula.ai-e2e.workspace/1.0',
  version: {
    id: 'v1',
    projectId: 'p1',
    versionKey: 'checkout-v1',
    name: '结算 v1',
    validationStatus: 'valid',
    schemaVersion: 1,
    createdBy: 'fixture-user',
    assets: {
      pages: 2,
      businessModules: 0,
      functionalModules: 3,
      functionalScripts: 1,
      scenarios: 1,
      staleExecutableAssets: 0,
    },
    deploymentBindings: [{ bindingKey: 'default', deploymentRevisionId: 'dep1', isDefault: true }],
    createdAt: '2026-08-24T00:00:00Z',
    updatedAt: '2026-08-24T00:00:00Z',
  },
  prdDocuments: [
    {
      id: 'prd1',
      documentKey: 'checkout-prd',
      format: 'markdown',
      createdAt: '2026-08-24T00:00:00Z',
      rawContent: '# 结算\n确认订单和地址。',
      contentSha256: 'prd-sha',
    },
  ],
  pages: [
    {
      id: 'page1',
      pageKey: 'checkout',
      currentRevision: revision('page-r1', {
        schema: 'nebula.ai-e2e.page-definition/1.0',
        name: '结算页',
        routeTemplate: '/checkout/cart_8A21',
      }),
    },
    {
      id: 'page2',
      pageKey: 'account',
      currentRevision: revision('page-r2', {
        schema: 'nebula.ai-e2e.page-definition/1.0',
        name: '账户页',
        routeTemplate: '/account/login',
      }),
    },
  ],
  businessModules: [],
  functionalModules: [
    {
      id: 'm1',
      moduleKey: 'summary',
      businessModuleId: 'bm1',
      primaryPageDefinitionId: 'page1',
      currentRevision: revision('module-r1', {
        schema: 'nebula.ai-e2e.functional-module/1.0',
        name: '订单摘要',
      }),
    },
    {
      id: 'm2',
      moduleKey: 'address',
      businessModuleId: 'bm1',
      primaryPageDefinitionId: 'page1',
      currentRevision: revision('module-r2', {
        schema: 'nebula.ai-e2e.functional-module/1.0',
        name: '收货地址',
      }),
    },
    {
      id: 'm3',
      moduleKey: 'login',
      businessModuleId: 'bm2',
      primaryPageDefinitionId: 'page2',
      currentRevision: revision('module-r3', {
        schema: 'nebula.ai-e2e.functional-module/1.0',
        name: '登录',
      }),
    },
  ],
  functionalScripts: [
    {
      id: 'script1',
      scriptKey: 'checkout.summary',
      name: '检查摘要',
      functionalModuleId: 'm1',
      currentRevision: revision(
        'script-r1',
        { schema: 'nebula.ai-e2e.functional-script/1.0', steps: [] },
        'verified'
      ),
    },
  ],
  scenarios: [
    {
      id: 'sc1',
      scenarioKey: 'checkout-flow',
      name: '完成结算',
      currentRevision: revision(
        'scenario-r1',
        {
          schema: 'nebula.ai-e2e.scenario/1.0',
          purpose: '完成结算',
          calls: [{ callKey: 'summary', functionalScriptId: 'script1' }],
          edges: [],
        },
        'verified'
      ),
    },
  ],
  validations: [
    {
      id: 'val1',
      deploymentRevisionId: 'dep1',
      status: 'valid',
      verificationScope: { environment: 'staging' },
      assetGraphSha256: 'fixture-graph-sha',
      verificationScopeSha256: 'fixture-scope-sha',
      createdAt: '2026-08-24T00:00:00Z',
    },
  ],
};

const snapshot: AuthoringSnapshot = {
  schema: 'nebula.ai-e2e.authoring-snapshot/1.0',
  job: { id: 'job1', lifecycle: 'waiting_decision' },
  tasks: [],
  attempts: [],
  decisions: [],
  contextThreads: [{ id: 'thread1' }],
  amendments: [],
  seq: 3,
  stateVersion: 2,
};

const amendment: AuthoringAmendment = {
  id: 'a1',
  jobId: 'job1',
  threadId: 'thread1',
  state: 'candidate_ready',
  reason: '更新订单摘要断言',
  category: 'repair',
  createdBy: 'fixture-user',
  impact: { affectedUrls: ['/checkout/cart_8A21'] },
  validationPlan: { strategy: 'browser' },
  decisionIds: [],
  decisions: [],
  changes: [
    {
      id: 'c1',
      assetType: 'functional_module',
      assetId: 'm1',
      baseRevisionId: 'module-r1',
      baseRevisionSha256: 'module-r1-sha',
      candidateRevisionId: 'module-r4',
      targetFunctionalModuleId: 'm1',
      diff: { changedFields: ['acceptance'] },
    },
  ],
  createdAt: '2026-08-24T00:00:00Z',
  updatedAt: '2026-08-24T00:00:00Z',
};

const runSnapshot: RunSnapshot = {
  schema: 'nebula.ai-e2e.run-snapshot/1.0',
  run: { id: 'run1', lifecycle: 'paused', businessVersionId: 'v1' },
  plan: {},
  amendments: [],
  todos: [{ id: 'todo1', todoKey: 'summary', state: 'interrupted' }],
  dependencies: [],
  pageTasks: [],
  attempts: [],
  decisions: [],
  evidence: [],
  browserJob: { state: 'completed', browserSessionId: 'browser-session-1' },
  seq: 5,
  stateVersion: 4,
};

function renderAuthoring(
  entry = '/semantic/p1/authoring/v1?url=%2Fcheckout%2Fcart_8A21&page=page1&module=m1&scenario=sc1',
  options: { eventStreams?: boolean } = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="/semantic/:projectId/authoring/:versionId"
            element={
              <SemanticWorkbench mode="authoring" eventStreams={options.eventStreams ?? false} />
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderRun(options: { eventStreams?: boolean } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[
          '/semantic/p1/runs/run1?version=v1&url=%2Fcheckout%2Fcart_8A21&page=page1&module=m1&scenario=sc1',
        ]}
      >
        <Routes>
          <Route
            path="/semantic/:projectId/runs/:runId"
            element={<SemanticWorkbench mode="run" eventStreams={options.eventStreams ?? false} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SemanticWorkbench', () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    Object.values(api).forEach((mock) => mock.mockReset());
    api.getWorkspace.mockResolvedValue(workspace);
    api.getAuthoringSnapshot.mockResolvedValue(snapshot);
    api.listAmendments.mockResolvedValue([]);
    api.createAuthoringJob.mockResolvedValue({ id: 'locate-job', taskId: 'task1' });
    api.commandAuthoringJob.mockResolvedValue({ lifecycle: 'paused', stateVersion: 3 });
    api.getRunSnapshot.mockResolvedValue(runSnapshot);
    api.commandRun.mockResolvedValue({ lifecycle: 'running' });
    api.resumeTodo.mockResolvedValue({ state: 'ready' });
    stream.state.authoring = 'idle';
    stream.state.run = 'idle';
    stream.useSemanticEventStream.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('切换模块只改变上下文，不重挂载或导航浏览器；显式定位才创建安全任务', async () => {
    renderAuthoring();
    expect(await screen.findByRole('button', { name: /订单摘要/ })).toBeInTheDocument();
    const browser = screen.getByTestId('semantic-browser-stage');
    const mountId = browser.getAttribute('data-mount-id');

    fireEvent.click(screen.getByRole('button', { name: /收货地址/ }));
    expect(screen.getByTestId('browser-url')).toHaveTextContent('/checkout/cart_8A21');
    expect(screen.getByTestId('semantic-browser-stage')).toBe(browser);
    expect(screen.getByTestId('semantic-browser-stage')).toHaveAttribute('data-mount-id', mountId);
    expect(api.createAuthoringJob).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('浏览器目标 URL'), {
      target: { value: '/account/login' },
    });
    fireEvent.click(screen.getByRole('button', { name: '在浏览器中定位' }));
    await waitFor(() =>
      expect(api.createAuthoringJob.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          intent: 'locate_in_browser',
          targetId: 'm2',
          currentUrl: '/account/login',
        })
      )
    );
    await waitFor(() =>
      expect(screen.getByTestId('browser-url')).toHaveTextContent('/account/login')
    );
  });

  it('新项目深链接只自动创建一次 bootstrap Agent 任务', async () => {
    renderAuthoring(
      '/semantic/p1/authoring/v1?bootstrap=1&url=https%3A%2F%2Fexample.test%2F&page=page1&module=m1&scenario=sc1'
    );
    await screen.findByRole('button', { name: /订单摘要/ });
    await waitFor(() => expect(api.createAuthoringJob).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.getAuthoringSnapshot).toHaveBeenCalledWith('locate-job'));
    expect(api.createAuthoringJob.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        versionId: 'v1',
        mode: 'bootstrap',
        intent: 'author_assets',
        targetId: 'm1',
        currentUrl: 'https://example.test/',
      })
    );
  });

  it('支持键盘调宽、持久化和双击复位', async () => {
    renderAuthoring();
    const splitter = await screen.findByRole('separator', { name: '左侧上下文宽度调整' });
    expect(splitter).toHaveAttribute('aria-valuenow', '272');
    fireEvent.keyDown(splitter, { key: 'ArrowRight' });
    expect(splitter).toHaveAttribute('aria-valuenow', '288');
    expect(
      JSON.parse(window.localStorage.getItem('ai-e2e.semantic.layout.v1') ?? '{}')
    ).toMatchObject({ leftWidth: 288 });
    fireEvent.doubleClick(splitter);
    expect(splitter).toHaveAttribute('aria-valuenow', '272');
  });

  it('约束损坏的持久化布局偏好', async () => {
    window.localStorage.setItem(
      'ai-e2e.semantic.layout.v1',
      JSON.stringify({ leftWidth: 99_999, rightWidth: -10, browserZoom: 999, theme: 'unknown' })
    );
    renderAuthoring();
    const left = await screen.findByRole('separator', { name: '左侧上下文宽度调整' });
    const right = screen.getByRole('separator', { name: '右侧检查器宽度调整' });
    expect(Number(left.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(420);
    expect(Number(right.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(320);
    expect(screen.getByText('150%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '主题：system' })).toBeInTheDocument();
  });

  it('从深链接恢复页面、模块与场景选择', async () => {
    renderAuthoring('/semantic/p1/authoring/v1?url=%2Fcheckout&page=page1&module=m2&scenario=sc1');
    expect(await screen.findByRole('button', { name: /收货地址/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /收货地址/ })).toHaveClass('is-active');
    expect(screen.getByRole('button', { name: /完成结算/ })).toHaveClass('is-active');
  });

  it('按快照版本暂停 Authoring 作业', async () => {
    renderAuthoring(
      '/semantic/p1/authoring/v1?job=job1&url=%2Fcheckout&page=page1&module=m1&scenario=sc1'
    );
    fireEvent.click(await screen.findByRole('button', { name: '暂停' }));
    await waitFor(() => expect(api.commandAuthoringJob).toHaveBeenCalledWith('job1', 2, 'pause'));
  });

  it('区分副作用审批和范围扩展，展示精确风险并传递审批类别', async () => {
    api.listAmendments.mockResolvedValue([
      {
        ...amendment,
        state: 'waiting_decision',
        decisionIds: ['effect-decision'],
        decisions: [
          {
            id: 'effect-decision',
            category: 'side_effect_approval',
            status: 'open',
            question: '批准精确候选验证？',
            facts: {
              environment: 'staging',
              deploymentRevisionId: 'dep-exact',
              policyVersion: 'side-effect-policy/1.0',
              projectionSha256: 'a'.repeat(64),
              sourcePlanSha256: 'b'.repeat(64),
              projection: {
                effects: [
                  {
                    kind: 'delete',
                    resourceType: 'order',
                    maxAffectedItems: 1,
                    reversibility: 'irreversible',
                    stepId: 'verify-1-1-step_delete',
                  },
                ],
              },
            },
          },
        ],
      },
    ]);
    api.answerAmendmentDecision.mockResolvedValue(amendment);
    renderAuthoring(
      '/semantic/p1/authoring/v1?job=job1&url=%2Fcheckout&page=page1&module=m1&scenario=sc1'
    );
    fireEvent.click(await screen.findByRole('tab', { name: /Diff/ }));
    expect(await screen.findByText('副作用验证审批')).toBeInTheDocument();
    expect(screen.getByText('dep-exact')).toBeInTheDocument();
    expect(screen.getByText('a'.repeat(64))).toBeInTheDocument();
    expect(screen.getByText(/delete · order ≤ 1 · irreversible/)).toBeInTheDocument();
    expect(screen.getByText('仍有副作用验证等待审批')).toBeInTheDocument();
    expect(screen.queryByText('仍有范围扩展等待审批')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /在安全边界应用/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '批准' }));
    await waitFor(() =>
      expect(api.answerAmendmentDecision).toHaveBeenCalledWith(
        'a1',
        'effect-decision',
        'approve',
        'side_effect_approval'
      )
    );
  });

  it.each([
    {
      categories: ['authoring_scope_expansion'],
      reason: '仍有范围扩展等待审批',
    },
    {
      categories: ['authoring_scope_expansion', 'side_effect_approval'],
      reason: '仍有范围扩展与副作用验证等待审批',
    },
    {
      categories: ['side_effect_approval'],
      reason: '仍有副作用验证等待审批',
    },
    { categories: [], reason: '仍有决策等待回答' },
  ])('仅按未回答决策类别提示应用阻断：$reason', async ({ categories, reason }) => {
    api.listAmendments.mockResolvedValue([
      {
        ...amendment,
        state: 'waiting_decision',
        decisions: [
          { id: 'closed-scope', category: 'authoring_scope_expansion', status: 'answered' },
          ...categories.map((category, index) => ({
            id: `open-${index}`,
            category,
            status: 'open',
          })),
        ],
      },
    ]);
    renderAuthoring(
      '/semantic/p1/authoring/v1?job=job1&url=%2Fcheckout&page=page1&module=m1&scenario=sc1'
    );
    fireEvent.click(await screen.findByRole('tab', { name: /Diff/ }));
    expect(await screen.findByText(reason)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /在安全边界应用/ })).toBeDisabled();
  });

  it('模块切换后禁止把旧候选应用到错误模块', async () => {
    api.listAmendments.mockResolvedValue([amendment]);
    renderAuthoring(
      '/semantic/p1/authoring/v1?job=job1&url=%2Fcheckout&page=page1&module=m1&scenario=sc1'
    );
    fireEvent.click(await screen.findByRole('tab', { name: /Diff/ }));
    expect(screen.getByRole('button', { name: /在安全边界应用/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /收货地址/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Diff/ }));
    expect(screen.getByText('候选属于其他模块，切回原模块后才能应用')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /在安全边界应用/ })).toBeDisabled();
  });

  it('PRD bootstrap 允许在当前上下文应用跨模块新建资产', async () => {
    api.getAuthoringSnapshot.mockResolvedValue({
      ...snapshot,
      job: { ...snapshot.job, mode: 'bootstrap' },
    });
    api.listAmendments.mockResolvedValue([
      {
        ...amendment,
        changes: [
          ...amendment.changes,
          {
            assetType: 'functional_module',
            assetId: 'm-new',
            targetFunctionalModuleId: 'm-new',
            baseRevisionId: 'new-revision',
            candidateRevisionId: 'new-revision',
            baseRevisionSha256: 'new-revision-sha',
          },
        ],
      },
    ]);
    renderAuthoring(
      '/semantic/p1/authoring/v1?job=job1&url=%2Fcheckout&page=page1&module=m1&scenario=sc1'
    );
    fireEvent.click(await screen.findByRole('tab', { name: /Diff/ }));
    expect(screen.getByRole('button', { name: /在安全边界应用/ })).toBeEnabled();
  });

  it('运行页以持久化状态提供暂停运行、恢复 TODO 和证据入口', async () => {
    renderRun();
    expect(await screen.findByText('运行状态：paused')).toBeInTheDocument();
    expect(screen.getByAltText('当前受控浏览器实时画面')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    await waitFor(() => expect(api.commandRun).toHaveBeenCalledWith('run1', 4, 'resume'));
    fireEvent.click(screen.getByRole('button', { name: /恢复 summary/ }));
    await waitFor(() => expect(api.resumeTodo).toHaveBeenCalledWith('run1', 'todo1'));
    fireEvent.click(screen.getByRole('tab', { name: '证据' }));
    expect(screen.getByText('当前运行尚未落库证据')).toBeInTheDocument();
  });

  describe('snapshot 轮询与 SSE live 协同', () => {
    const AUTHORING_ENTRY =
      '/semantic/p1/authoring/v1?job=job1&url=%2Fcheckout&page=page1&module=m1&scenario=sc1';

    async function flushAsyncWork() {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    async function advanceTimers(ms: number) {
      await act(async () => {
        vi.advanceTimersByTime(ms);
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    it('authoring SSE live 时停止自身 snapshot 轮询，workspace 不加轮询', async () => {
      vi.useFakeTimers();
      stream.state.authoring = 'live';
      renderAuthoring(AUTHORING_ENTRY, { eventStreams: true });
      await flushAsyncWork();
      expect(api.getAuthoringSnapshot).toHaveBeenCalledTimes(1);
      expect(api.getWorkspace).toHaveBeenCalledTimes(1);
      expect(stream.useSemanticEventStream).toHaveBeenCalledWith(
        expect.objectContaining({ snapshotEvent: 'authoring.snapshot', enabled: true })
      );
      expect(stream.useSemanticEventStream).toHaveBeenCalledWith(
        expect.objectContaining({ snapshotEvent: 'run.snapshot', enabled: false })
      );
      await advanceTimers(9_000);
      expect(api.getAuthoringSnapshot).toHaveBeenCalledTimes(1);
      expect(api.getWorkspace).toHaveBeenCalledTimes(1);
    });

    it('run SSE live 时停止自身 snapshot 轮询，workspace 不加轮询', async () => {
      vi.useFakeTimers();
      stream.state.run = 'live';
      renderRun({ eventStreams: true });
      await flushAsyncWork();
      expect(api.getRunSnapshot).toHaveBeenCalledTimes(1);
      expect(api.getWorkspace).toHaveBeenCalledTimes(1);
      expect(stream.useSemanticEventStream).toHaveBeenCalledWith(
        expect.objectContaining({ snapshotEvent: 'run.snapshot', enabled: true })
      );
      await advanceTimers(9_000);
      expect(api.getRunSnapshot).toHaveBeenCalledTimes(1);
      expect(api.getWorkspace).toHaveBeenCalledTimes(1);
    });

    it('authoring SSE connecting 时仍按 3 秒轮询', async () => {
      vi.useFakeTimers();
      stream.state.authoring = 'connecting';
      renderAuthoring(AUTHORING_ENTRY, { eventStreams: true });
      await flushAsyncWork();
      expect(api.getAuthoringSnapshot).toHaveBeenCalledTimes(1);
      await advanceTimers(3_000);
      expect(api.getAuthoringSnapshot).toHaveBeenCalledTimes(2);
    });

    it('run SSE reconnecting 时仍按 3 秒轮询', async () => {
      vi.useFakeTimers();
      stream.state.run = 'reconnecting';
      renderRun({ eventStreams: true });
      await flushAsyncWork();
      expect(api.getRunSnapshot).toHaveBeenCalledTimes(1);
      await advanceTimers(3_000);
      expect(api.getRunSnapshot).toHaveBeenCalledTimes(2);
    });

    it('authoring SSE idle 时仍按 3 秒轮询', async () => {
      vi.useFakeTimers();
      renderAuthoring(AUTHORING_ENTRY, { eventStreams: true });
      await flushAsyncWork();
      expect(api.getAuthoringSnapshot).toHaveBeenCalledTimes(1);
      await advanceTimers(3_000);
      expect(api.getAuthoringSnapshot).toHaveBeenCalledTimes(2);
    });

    it('未启用事件流时 run snapshot 仍按 3 秒轮询', async () => {
      vi.useFakeTimers();
      renderRun();
      await flushAsyncWork();
      expect(api.getRunSnapshot).toHaveBeenCalledTimes(1);
      await advanceTimers(3_000);
      expect(api.getRunSnapshot).toHaveBeenCalledTimes(2);
    });

    it.each(['failed', 'completed', 'cancelled'])(
      'authoring 终态 %s 即使 SSE connecting 也停止轮询',
      async (lifecycle) => {
        vi.useFakeTimers();
        stream.state.authoring = 'connecting';
        api.getAuthoringSnapshot.mockResolvedValue({
          ...snapshot,
          job: { ...snapshot.job, lifecycle },
        });
        renderAuthoring(AUTHORING_ENTRY, { eventStreams: true });
        await flushAsyncWork();
        expect(api.getAuthoringSnapshot).toHaveBeenCalledTimes(1);
        await advanceTimers(9_000);
        expect(api.getAuthoringSnapshot).toHaveBeenCalledTimes(1);
      }
    );

    it.each(['completed', 'cancelled'])('run 终态 %s 停止轮询', async (lifecycle) => {
      vi.useFakeTimers();
      api.getRunSnapshot.mockResolvedValue({
        ...runSnapshot,
        run: { ...runSnapshot.run, lifecycle },
      });
      renderRun({ eventStreams: true });
      await flushAsyncWork();
      expect(api.getRunSnapshot).toHaveBeenCalledTimes(1);
      await advanceTimers(9_000);
      expect(api.getRunSnapshot).toHaveBeenCalledTimes(1);
    });

    it('run failed 不是停止条件，SSE idle 时仍按 3 秒轮询', async () => {
      vi.useFakeTimers();
      api.getRunSnapshot.mockResolvedValue({
        ...runSnapshot,
        run: { ...runSnapshot.run, lifecycle: 'failed' },
      });
      renderRun({ eventStreams: true });
      await flushAsyncWork();
      expect(api.getRunSnapshot).toHaveBeenCalledTimes(1);
      await advanceTimers(3_000);
      expect(api.getRunSnapshot).toHaveBeenCalledTimes(2);
    });
  });
});
