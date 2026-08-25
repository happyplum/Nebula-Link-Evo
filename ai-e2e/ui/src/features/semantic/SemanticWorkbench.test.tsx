import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SemanticWorkbench } from './SemanticWorkbench.js';
import type {
  AuthoringAmendment,
  AuthoringSnapshot,
  RunSnapshot,
  SemanticWorkspace,
} from './types.js';

const api = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  getAuthoringSnapshot: vi.fn(),
  listAmendments: vi.fn(),
  listChatMessages: vi.fn(),
  createAuthoringJob: vi.fn(),
  commandAmendment: vi.fn(),
  answerAmendmentDecision: vi.fn(),
  createRun: vi.fn(),
  getRunSnapshot: vi.fn(),
  commandRun: vi.fn(),
  answerRunDecision: vi.fn(),
  resumeTodo: vi.fn(),
}));

vi.mock('./api.js', () => ({ semanticApi: api }));

const revision = (id: string, payload: Record<string, unknown>, readinessStatus?: string) => ({
  id,
  revisionNo: 3,
  lifecycle: 'current',
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
    deploymentBindings: [{ bindingKey: 'default', deploymentRevisionId: 'dep1', isDefault: true }],
    createdAt: '2026-08-24T00:00:00Z',
    updatedAt: '2026-08-24T00:00:00Z',
  },
  prdDocuments: [
    {
      id: 'prd1',
      documentKey: 'checkout-prd',
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
  entry = '/semantic/p1/authoring/v1?url=%2Fcheckout%2Fcart_8A21&page=page1&module=m1&scenario=sc1'
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
            element={<SemanticWorkbench mode="authoring" eventStreams={false} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderRun() {
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
            element={<SemanticWorkbench mode="run" eventStreams={false} />}
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
    api.listChatMessages.mockResolvedValue([]);
    api.createAuthoringJob.mockResolvedValue({ id: 'locate-job', taskId: 'task1' });
    api.getRunSnapshot.mockResolvedValue(runSnapshot);
    api.commandRun.mockResolvedValue({ lifecycle: 'running' });
    api.resumeTodo.mockResolvedValue({ state: 'ready' });
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
});
