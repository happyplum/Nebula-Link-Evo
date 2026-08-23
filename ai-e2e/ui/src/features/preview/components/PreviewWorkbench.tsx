import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Code2,
  Columns3,
  ExternalLink,
  FileCheck2,
  FileDiff,
  FileText,
  GitBranch,
  GripVertical,
  Image,
  LoaderCircle,
  LocateFixed,
  Maximize2,
  Minus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  TerminalSquare,
  X,
  XCircle,
  ZoomIn,
} from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils.js';
import {
  createPreviewAmendment,
  previewPages,
  previewPrdFragments,
  previewRuns,
  previewScenarios,
} from '../fixtures.js';
import {
  isAmendmentApplicable,
  type PreviewAuthoringAmendment,
  type PreviewChangeTarget,
  type PreviewContextScope,
  type PreviewLayoutPreferences,
  type PreviewModule,
  type PreviewRunFixture,
  type PreviewScenario,
} from '../types.js';

const LAYOUT_STORAGE_KEY = 'ai-e2e.preview.layout';
const DEFAULT_LAYOUT: PreviewLayoutPreferences = {
  leftWidth: 276,
  rightWidth: 360,
  chatCollapsed: false,
  browserFocused: false,
  browserZoom: 90,
  theme: 'system',
};
const MIN_LEFT = 232;
const MIN_RIGHT = 312;
const MIN_BROWSER = 520;
const SPLITTER_WIDTH = 8;

type InspectorTab = 'context' | 'diff' | 'evidence';

interface ChatMessage {
  id: string;
  role: 'agent' | 'user';
  text: string;
}

function readLayoutPreferences(): PreviewLayoutPreferences {
  try {
    const stored = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!stored) return DEFAULT_LAYOUT;
    const value = JSON.parse(stored) as Partial<PreviewLayoutPreferences>;
    return {
      ...DEFAULT_LAYOUT,
      ...value,
      leftWidth: Number.isFinite(value.leftWidth)
        ? Number(value.leftWidth)
        : DEFAULT_LAYOUT.leftWidth,
      rightWidth: Number.isFinite(value.rightWidth)
        ? Number(value.rightWidth)
        : DEFAULT_LAYOUT.rightWidth,
      browserZoom: Number.isFinite(value.browserZoom)
        ? Number(value.browserZoom)
        : DEFAULT_LAYOUT.browserZoom,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function runTone(run: PreviewRunFixture): 'cyan' | 'amber' | 'red' | 'green' {
  if (run.state === 'completed') return 'green';
  if (run.state === 'failed') return 'red';
  if (run.state === 'waiting_decision' || run.state === 'interrupted') return 'amber';
  return 'cyan';
}

function statusIcon(status: PreviewRunFixture['todos'][number]['status']) {
  if (status === 'passed') return CheckCircle2;
  if (status === 'running') return LoaderCircle;
  if (status === 'failed') return XCircle;
  if (status === 'skipped') return Minus;
  if (status === 'blocked') return ShieldAlert;
  return Circle;
}

function cloneScope(scope: PreviewContextScope): PreviewContextScope {
  return {
    ...scope,
    visibleScenarioIds: [...scope.visibleScenarioIds],
    baseRevisionHashes: { ...scope.baseRevisionHashes },
  };
}

function Splitter({
  side,
  value,
  onPointerDown,
  onKeyboardResize,
  onReset,
}: {
  side: 'left' | 'right';
  value: number;
  onPointerDown: (side: 'left' | 'right', event: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyboardResize: (side: 'left' | 'right', delta: number) => void;
  onReset: (side: 'left' | 'right') => void;
}) {
  return (
    <div
      className="preview-splitter"
      role="separator"
      aria-label={`${side === 'left' ? '左侧上下文' : '右侧检查器'}宽度调整`}
      aria-orientation="vertical"
      aria-valuemin={side === 'left' ? MIN_LEFT : MIN_RIGHT}
      aria-valuemax={side === 'left' ? 420 : 520}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={(event) => onPointerDown(side, event)}
      onDoubleClick={() => onReset(side)}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const physicalDelta = event.key === 'ArrowRight' ? 16 : -16;
        onKeyboardResize(side, side === 'left' ? physicalDelta : -physicalDelta);
      }}
    >
      <GripVertical aria-hidden="true" />
    </div>
  );
}

const BrowserStage = memo(function BrowserStage({
  url,
  selectedModule,
  amendment,
  zoom,
  run,
  locatePulse,
}: {
  url: string;
  selectedModule: PreviewModule;
  amendment: PreviewAuthoringAmendment | null;
  zoom: number;
  run?: PreviewRunFixture;
  locatePulse: number;
}) {
  const mountId = useRef(`browser-${Math.random().toString(36).slice(2)}`);
  const selectedLabel = selectedModule.name;
  const isPayment = selectedModule.id === 'module-payment';
  const isAddress = selectedModule.id === 'module-address';

  return (
    <section
      className="preview-browser-stage"
      data-testid="preview-browser-stage"
      data-mount-id={mountId.current}
      aria-label="只读浏览器画面"
    >
      <div className="preview-browser-toolbar">
        <div className="preview-browser-dots">
          <i />
          <i />
          <i />
        </div>
        <button type="button" aria-label="后退">
          <ChevronLeft aria-hidden="true" />
        </button>
        <button type="button" aria-label="前进">
          <ChevronRight aria-hidden="true" />
        </button>
        <button type="button" aria-label="重新加载">
          <RefreshCw aria-hidden="true" />
        </button>
        <div className="preview-address-bar">
          <ShieldCheck aria-hidden="true" />
          <span data-testid="browser-url">{url}</span>
        </div>
        <span className="preview-browser-readonly">只读观察</span>
      </div>
      <div className="preview-browser-viewport">
        <div className="preview-browser-canvas" style={{ transform: `scale(${zoom / 100})` }}>
          <header className="shop-header">
            <strong>NORTHSTAR</strong>
            <nav aria-label="模拟站点导航">
              <span>新品</span>
              <span>女装</span>
              <span>男装</span>
              <span>会员</span>
            </nav>
            <div>
              <SearchGlyph />
              <span className="shop-bag">2</span>
            </div>
          </header>
          <div className="shop-steps">
            <span className="is-done">
              <Check aria-hidden="true" />
              购物袋
            </span>
            <i />
            <span className="is-current">2</span>
            <strong>确认订单</strong>
            <i />
            <span>3</span>
            <em>完成支付</em>
          </div>
          <div className="shop-content" role="region" aria-label="模拟结算页面内容">
            <section
              className={cn(
                'shop-main-panel',
                selectedModule.id === 'module-order-summary' && 'is-selected'
              )}
            >
              <div className="shop-section-title">
                <div>
                  <small>ORDER SUMMARY</small>
                  <h2>订单摘要</h2>
                </div>
                <span>2 件商品</span>
              </div>
              <div className="shop-product">
                <div className="shop-product-image" />
                <div>
                  <strong>Aero 编织跑鞋</strong>
                  <span>雾蓝 / 42</span>
                  <div className="shop-quantity">
                    <button type="button" aria-label="减少跑鞋数量">
                      −
                    </button>
                    <span>1</span>
                    <button type="button" aria-label="增加跑鞋数量">
                      +
                    </button>
                  </div>
                </div>
                <strong>¥899.00</strong>
              </div>
              <div className="shop-product">
                <div className="shop-product-image is-dark" />
                <div>
                  <strong>轻量训练夹克</strong>
                  <span>深空灰 / L</span>
                  <div className="shop-quantity">
                    <button type="button" aria-label="减少夹克数量">
                      −
                    </button>
                    <span>1</span>
                    <button type="button" aria-label="增加夹克数量">
                      +
                    </button>
                  </div>
                </div>
                <strong>¥699.00</strong>
              </div>
              <div className={cn('shop-address', isAddress && 'is-selected')}>
                <div className="shop-section-title">
                  <div>
                    <small>DELIVERY</small>
                    <h2>配送地址</h2>
                  </div>
                  <button type="button">更换</button>
                </div>
                <strong>林知远 · 138 **** 6024</strong>
                <p>上海市徐汇区虹桥路 1001 号 · 200030</p>
              </div>
            </section>
            <aside className={cn('shop-summary-card', isPayment && 'is-selected')}>
              <small>PAYMENT</small>
              <h2>订单金额</h2>
              <dl>
                <div>
                  <dt>商品小计</dt>
                  <dd>¥1,598.00</dd>
                </div>
                <div>
                  <dt>会员优惠</dt>
                  <dd className="is-discount">−¥160.00</dd>
                </div>
                <div>
                  <dt>配送费</dt>
                  <dd>¥0.00</dd>
                </div>
              </dl>
              <div className="shop-total">
                <span>应付金额</span>
                <strong>¥1,438.00</strong>
              </div>
              <label className="shop-payment">
                <input type="radio" checked readOnly />
                <span>
                  <strong>支付宝</strong>
                  <small>推荐使用</small>
                </span>
                <Check aria-hidden="true" />
              </label>
              <button type="button" className="shop-submit">
                确认并支付 ¥1,438.00 <ArrowRight aria-hidden="true" />
              </button>
              <p className="shop-secure">
                <ShieldCheck aria-hidden="true" />
                支付信息已加密保护
              </p>
            </aside>
          </div>
        </div>
        <div className={cn('preview-selection-tag', locatePulse > 0 && 'is-pulsing')}>
          <LocateFixed aria-hidden="true" />
          当前上下文：{selectedLabel}
        </div>
        {run && (
          <div className={`preview-operation-banner preview-operation-${runTone(run)}`}>
            <Activity aria-hidden="true" />
            <div>
              <strong>{run.statusLabel}</strong>
              <span>{run.description}</span>
            </div>
            <span className="preview-mono">{run.elapsed}</span>
          </div>
        )}
        {amendment && !['activated', 'rejected', 'stale'].includes(amendment.status) && (
          <div className="preview-candidate-overlay">
            <FileDiff aria-hidden="true" />
            <div>
              <strong>候选变更预览</strong>
              <span>{amendment.summary}</span>
            </div>
            <span>{amendment.status === 'waiting_decision' ? '等待决策' : '未激活'}</span>
          </div>
        )}
      </div>
    </section>
  );
});

function SearchGlyph() {
  return <ZoomIn aria-hidden="true" />;
}

function ContextTree({
  pageId,
  moduleId,
  scenarioId,
  run,
  onSelectPage,
  onSelectModule,
  onSelectScenario,
}: {
  pageId: string;
  moduleId: string;
  scenarioId: string;
  run?: PreviewRunFixture;
  onSelectPage: (pageId: string) => void;
  onSelectModule: (moduleId: string) => void;
  onSelectScenario: (scenarioId: string) => void;
}) {
  return (
    <aside className="preview-context-tree" aria-label="PRD、页面、模块和场景">
      <div className="preview-panel-heading">
        <div>
          <span>上下文</span>
          <strong>结算中心 PRD v3.4</strong>
        </div>
        <button type="button" aria-label="折叠全部">
          <ChevronDown aria-hidden="true" />
        </button>
      </div>
      <div className="preview-tree-scroll">
        <section className="preview-tree-section">
          <h2>
            <FileText aria-hidden="true" />
            PRD 结构<span>4</span>
          </h2>
          {previewPrdFragments.slice(0, 3).map((fragment) => (
            <button type="button" className="preview-tree-leaf" key={fragment.id}>
              <span>{fragment.heading}</span>
            </button>
          ))}
        </section>
        <section className="preview-tree-section">
          <h2>
            <Layers3Icon />
            页面与模块<span>{previewPages.length}</span>
          </h2>
          {previewPages.map((page) => (
            <div className="preview-tree-group" key={page.id}>
              <button
                type="button"
                className={cn('preview-tree-parent', page.id === pageId && 'is-active')}
                onClick={() => onSelectPage(page.id)}
              >
                <ChevronDown aria-hidden="true" />
                <span>
                  <strong>{page.name}</strong>
                  <small>{page.routeTemplate}</small>
                </span>
              </button>
              {page.id === pageId && (
                <div className="preview-tree-children">
                  {page.modules.map((module) => (
                    <button
                      type="button"
                      className={cn(module.id === moduleId && 'is-active')}
                      key={module.id}
                      onClick={() => onSelectModule(module.id)}
                    >
                      <span className="preview-tree-node-dot" />
                      <span>
                        <strong>{module.name}</strong>
                        <small>
                          {module.scripts.length} 个功能脚本 · {module.coverage}%
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
        <section className="preview-tree-section">
          <h2>
            <GitBranch aria-hidden="true" />
            关联场景
            <span>
              {
                previewScenarios.filter((scenario) => scenario.pageDefinitionIds.includes(pageId))
                  .length
              }
            </span>
          </h2>
          {previewScenarios
            .filter((scenario) => scenario.pageDefinitionIds.includes(pageId))
            .map((scenario) => (
              <button
                type="button"
                className={cn('preview-scenario-leaf', scenario.id === scenarioId && 'is-active')}
                onClick={() => onSelectScenario(scenario.id)}
                key={scenario.id}
              >
                <span>
                  <GitBranch aria-hidden="true" />
                  <span>
                    <strong>{scenario.name}</strong>
                    <small>
                      {scenario.nodes.length} 个调用 ·{' '}
                      {scenario.pageDefinitionIds.length > 1 ? '跨 URL' : '当前 URL'}
                    </small>
                  </span>
                </span>
                {scenario.pageDefinitionIds.length > 1 && <ExternalLink aria-label="跨 URL 场景" />}
              </button>
            ))}
        </section>
        {run && (
          <section className="preview-tree-section preview-todo-section">
            <h2>
              <Activity aria-hidden="true" />
              运行 TODO<span>{run.todos.length}</span>
            </h2>
            {run.todos.map((todo) => {
              const Icon = statusIcon(todo.status);
              return (
                <button
                  type="button"
                  className={cn('preview-todo-item', `is-${todo.status}`)}
                  key={todo.id}
                >
                  <Icon aria-hidden="true" />
                  <span>
                    <strong>{todo.label}</strong>
                    <small>{todo.detail}</small>
                  </span>
                </button>
              );
            })}
          </section>
        )}
      </div>
    </aside>
  );
}

function Layers3Icon() {
  return <Columns3 aria-hidden="true" />;
}

function ScenarioGraph({
  scenario,
  selectedModuleId,
}: {
  scenario: PreviewScenario;
  selectedModuleId: string;
}) {
  return (
    <div className="preview-scenario-graph" aria-label={`${scenario.name}调用图`}>
      {scenario.nodes.map((node, index) => (
        <div className="preview-graph-step" key={node.id}>
          <div
            className={cn(
              'preview-graph-node',
              node.moduleId === selectedModuleId && 'is-current',
              node.pageDefinitionId !== 'page-checkout' && 'is-cross-url'
            )}
          >
            <span>{index + 1}</span>
            <div>
              <strong>{node.label}</strong>
              <small>
                {
                  previewPages
                    .flatMap((page) => page.modules)
                    .find((module) => module.id === node.moduleId)?.name
                }
              </small>
            </div>
            {node.pageDefinitionId !== 'page-checkout' && <ExternalLink aria-label="跨 URL 节点" />}
          </div>
          {index < scenario.nodes.length - 1 && <ArrowRight aria-hidden="true" />}
        </div>
      ))}
    </div>
  );
}

function ContextInspector({
  module,
  scenario,
  onReorchestrateScenario,
}: {
  module: PreviewModule;
  scenario: PreviewScenario;
  onReorchestrateScenario: () => void;
}) {
  const fragments = previewPrdFragments.filter((fragment) =>
    module.prdFragmentIds.includes(fragment.id)
  );
  return (
    <div className="preview-inspector-scroll">
      <section className="preview-inspector-section">
        <div className="preview-inspector-title">
          <span>模块需求</span>
          <span className="preview-mono">{module.revision}</span>
        </div>
        <h2>{module.name}</h2>
        <p>{module.purpose}</p>
        <div className="preview-coverage">
          <span>
            <i style={{ width: `${module.coverage}%` }} />
          </span>
          <strong>{module.coverage}% 覆盖</strong>
        </div>
      </section>
      <section className="preview-inspector-section">
        <div className="preview-inspector-title">
          <span>PRD 原文</span>
          <button type="button">
            <ExternalLink aria-hidden="true" />
            展开
          </button>
        </div>
        {fragments.map((fragment) => (
          <blockquote key={fragment.id}>
            <strong>{fragment.heading}</strong>
            <p>{fragment.content}</p>
            <cite>{fragment.source}</cite>
          </blockquote>
        ))}
      </section>
      <section className="preview-inspector-section">
        <div className="preview-inspector-title">
          <span>功能点与验收</span>
          <span>{module.functionalPoints.length}</span>
        </div>
        <ul className="preview-check-list">
          {module.acceptanceCriteria.map((criterion) => (
            <li key={criterion}>
              <Check aria-hidden="true" />
              {criterion}
            </li>
          ))}
        </ul>
      </section>
      <section className="preview-inspector-section">
        <div className="preview-inspector-title">
          <span>功能脚本</span>
          <span>{module.scripts.length}</span>
        </div>
        <div className="preview-script-list">
          {module.scripts.map((script) => (
            <button type="button" key={script.id}>
              <Code2 aria-hidden="true" />
              <span>
                <strong>{script.name}</strong>
                <small>
                  {script.assertions} 项断言 · {script.status}
                </small>
              </span>
              <ChevronRight aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>
      <section className="preview-inspector-section">
        <div className="preview-inspector-title">
          <span>场景调用图</span>
          <button type="button" onClick={onReorchestrateScenario}>
            <RefreshCw aria-hidden="true" />
            重新编排
          </button>
        </div>
        <h3>{scenario.name}</h3>
        <ScenarioGraph scenario={scenario} selectedModuleId={module.id} />
        <div className="preview-io-row">
          <span>输入：{scenario.inputs.join(' · ')}</span>
          <span>输出：{scenario.outputs.join(' · ')}</span>
        </div>
      </section>
    </div>
  );
}

function DiffInspector({
  amendment,
  isApplicable,
  onApprove,
  onReject,
  onApply,
  onFail,
  onReachSafeBoundary,
}: {
  amendment: PreviewAuthoringAmendment | null;
  isApplicable: boolean;
  onApprove: () => void;
  onReject: () => void;
  onApply: () => void;
  onFail: () => void;
  onReachSafeBoundary: () => void;
}) {
  if (!amendment)
    return (
      <div className="preview-empty-state">
        <FileDiff aria-hidden="true" />
        <strong>还没有候选变更</strong>
        <p>点击“一键重新编排”，或在 Chat 中描述需要调整的方向。</p>
      </div>
    );
  return (
    <div className="preview-inspector-scroll">
      <section className="preview-inspector-section preview-amendment-summary">
        <div className="preview-inspector-title">
          <span>结构化候选</span>
          <span className={`preview-amendment-status is-${amendment.status}`}>
            {amendment.status}
          </span>
        </div>
        <h2>{amendment.summary}</h2>
        <p>{amendment.reason}</p>
        <div className="preview-scope-lock">
          <ShieldCheck aria-hidden="true" />
          <span>
            <strong>作用域已锁定</strong>
            {amendment.scope.pageLabel} · {amendment.scope.selectedModuleId}
          </span>
        </div>
        {amendment.auditNote && <p className="preview-audit-note">{amendment.auditNote}</p>}
      </section>
      {amendment.decision?.status === 'pending' && (
        <section className="preview-impact-card">
          <div>
            <ShieldAlert aria-hidden="true" />
            <span>
              <strong>
                {amendment.decision.kind === 'cross_url' ? '跨 URL 范围扩展' : '同页其他模块资产'}
              </strong>
              <small>未经批准不会修改 current 资产</small>
            </span>
          </div>
          <dl>
            <div>
              <dt>URL</dt>
              <dd>{amendment.decision.affectedUrls.join('、')}</dd>
            </div>
            <div>
              <dt>模块</dt>
              <dd>{amendment.decision.affectedModules.join('、')}</dd>
            </div>
            <div>
              <dt>场景</dt>
              <dd>{amendment.decision.affectedScenarios.join('、')}</dd>
            </div>
            <div>
              <dt>基础修订</dt>
              <dd className="preview-mono">{amendment.decision.baseRevisions.join('、')}</dd>
            </div>
            <div>
              <dt>候选修订</dt>
              <dd className="preview-mono">{amendment.decision.targetRevision}</dd>
            </div>
            <div>
              <dt>副作用</dt>
              <dd>{amendment.decision.sideEffects.join('；')}</dd>
            </div>
          </dl>
          <div className="preview-action-row">
            <button
              type="button"
              className="preview-button preview-button-secondary"
              onClick={onReject}
            >
              <X aria-hidden="true" />
              拒绝
            </button>
            <button
              type="button"
              className="preview-button preview-button-primary"
              onClick={onApprove}
            >
              <ShieldCheck aria-hidden="true" />
              批准范围
            </button>
          </div>
        </section>
      )}
      <section className="preview-inspector-section">
        <div className="preview-inspector-title">
          <span>候选差异</span>
          <span>{amendment.diff.length} 行</span>
        </div>
        <div className="preview-diff-block">
          {amendment.diff.map((line, index) => (
            <div className={`is-${line.kind}`} key={`${line.text}-${index}`}>
              <span>{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}</span>
              <code>{line.text}</code>
            </div>
          ))}
        </div>
      </section>
      <section className="preview-inspector-section">
        <div className="preview-inspector-title">
          <span>验证与激活</span>
          <span className="preview-mono">{amendment.jobId}</span>
        </div>
        <ol className="preview-verification-list">
          {amendment.verificationPlan.map((step, index) => (
            <li key={step}>
              <span>{index + 1}</span>
              {step}
            </li>
          ))}
        </ol>
        {amendment.status === 'queued_at_safe_boundary' ? (
          <button
            type="button"
            className="preview-button preview-button-primary preview-full-button"
            onClick={onReachSafeBoundary}
          >
            <Play aria-hidden="true" />
            模拟到达安全边界
          </button>
        ) : (
          <div className="preview-verification-actions">
            {amendment.status === 'candidate_ready' && (
              <button
                type="button"
                className="preview-button preview-button-secondary"
                onClick={onFail}
              >
                <XCircle aria-hidden="true" />
                模拟验证失败
              </button>
            )}
            <button
              type="button"
              className="preview-button preview-button-primary"
              disabled={!isApplicable}
              onClick={onApply}
            >
              {amendment.status === 'verifying' ? (
                <LoaderCircle className="preview-spin" aria-hidden="true" />
              ) : amendment.status === 'activated' ? (
                <Check aria-hidden="true" />
              ) : amendment.status === 'failed' || amendment.status === 'rejected' ? (
                <XCircle aria-hidden="true" />
              ) : (
                <ShieldCheck aria-hidden="true" />
              )}
              {amendment.status === 'activated'
                ? '候选已激活'
                : amendment.status === 'verifying'
                  ? '正在真实验证'
                  : amendment.status === 'stale'
                    ? '上下文已变化，候选过期'
                    : amendment.status === 'failed'
                      ? '验证失败，current 未变'
                      : amendment.status === 'rejected'
                        ? '范围已拒绝，current 未变'
                        : '在安全边界应用'}
            </button>
          </div>
        )}
        {!isApplicable && amendment.status === 'candidate_ready' && (
          <p className="preview-inline-warning">
            <AlertTriangle aria-hidden="true" />
            当前上下文与候选基础修订不一致，禁止应用。
          </p>
        )}
      </section>
    </div>
  );
}

function EvidenceInspector({ run }: { run?: PreviewRunFixture }) {
  const items = [
    ['after screenshot', 'ev_903', '刚刚'],
    ['DOM capture', 'ev_902', '12 秒前'],
    ['assertion result', 'ev_901', '18 秒前'],
  ];
  return (
    <div className="preview-inspector-scroll">
      <section className="preview-inspector-section">
        <div className="preview-inspector-title">
          <span>证据上下文</span>
          <span>{run ? run.id : 'authoring verification'}</span>
        </div>
        <p>所有预览证据均为 fixtures；正式工作台只渲染后端 snapshot 与不可变 evidence manifest。</p>
      </section>
      <section className="preview-inspector-section">
        <div className="preview-evidence-preview">
          <Image aria-hidden="true" />
          <div>
            <span>浏览器截图预览</span>
            <strong>订单结算页 · 支付确认</strong>
          </div>
        </div>
        <div className="preview-evidence-list">
          {items.map(([label, id, time]) => (
            <button type="button" key={id}>
              <FileCheck2 aria-hidden="true" />
              <span>
                <strong>{label}</strong>
                <small>
                  {id} · {time}
                </small>
              </span>
              <ExternalLink aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function AgentChat({
  collapsed,
  messages,
  amendment,
  scope,
  onToggle,
  onSend,
}: {
  collapsed: boolean;
  messages: ChatMessage[];
  amendment: PreviewAuthoringAmendment | null;
  scope: PreviewContextScope;
  onToggle: () => void;
  onSend: (message: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const submit = () => {
    const message = draft.trim();
    if (!message) return;
    onSend(message);
    setDraft('');
  };
  return (
    <section
      className={cn('preview-agent-chat', collapsed && 'is-collapsed')}
      aria-label="当前上下文 Agent Chat"
    >
      <header>
        <div>
          <span className="preview-agent-avatar">
            <Bot aria-hidden="true" />
          </span>
          <div>
            <strong>编排 Agent</strong>
            <small>
              <ShieldCheck aria-hidden="true" />
              {scope.pageLabel} · 当前模块写入
            </small>
          </div>
        </div>
        <button type="button" onClick={onToggle} aria-label={collapsed ? '展开 Chat' : '折叠 Chat'}>
          {collapsed ? <ChevronLeft aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </button>
      </header>
      {!collapsed && (
        <>
          <div className="preview-chat-messages" aria-live="polite">
            {messages.map((message) => (
              <div className={`preview-chat-message is-${message.role}`} key={message.id}>
                {message.role === 'agent' && <Bot aria-hidden="true" />}
                <p>{message.text}</p>
              </div>
            ))}
            {amendment && (
              <button type="button" className="preview-chat-candidate">
                <FileDiff aria-hidden="true" />
                <span>
                  <strong>已生成结构化候选</strong>
                  <small>
                    {amendment.status} · {amendment.affectedAssetIds.length} 个影响对象
                  </small>
                </span>
                <ChevronRight aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="preview-chat-suggestions">
            <button type="button" onClick={() => onSend('重新编排当前场景的调用顺序')}>
              重排当前场景
            </button>
            <button type="button" onClick={() => onSend('同步修改支付模块的提交校验')}>
              涉及其他模块
            </button>
            <button type="button" onClick={() => onSend('跨页面补充登录后的会话恢复')}>
              跨 URL 恢复
            </button>
          </div>
          <div className="preview-chat-input">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder="描述需要调整的编排方向…"
              aria-label="编排调整指令"
            />
            <button type="button" onClick={submit} aria-label="发送指令" disabled={!draft.trim()}>
              <Send aria-hidden="true" />
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export function PreviewWorkbench({ mode }: { mode: 'authoring' | 'run' }) {
  const { runId } = useParams<{ runId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [layout, setLayout] = useState(readLayoutPreferences);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const intentHandled = useRef(false);

  const requestedPage = searchParams.get('page');
  const selectedPage = previewPages.find((page) => page.id === requestedPage) || previewPages[0];
  const requestedModule = searchParams.get('module');
  const selectedModule =
    selectedPage.modules.find((module) => module.id === requestedModule) || selectedPage.modules[0];
  const pageScenarios = previewScenarios.filter((scenario) =>
    scenario.pageDefinitionIds.includes(selectedPage.id)
  );
  const requestedScenario = searchParams.get('scenario');
  const selectedScenario =
    pageScenarios.find((scenario) => scenario.id === requestedScenario) || pageScenarios[0];
  const selectedRun =
    mode === 'run' ? previewRuns.find((run) => run.id === runId) || previewRuns[0] : undefined;

  const scope = useMemo<PreviewContextScope>(
    () => ({
      businessVersionId: searchParams.get('version') || 'bv-checkout-34',
      businessVersionLabel: 'checkout-release-3.4',
      deployment: 'staging@8f12cd',
      pageDefinitionId: selectedPage.id,
      pageLabel: selectedPage.name,
      url: selectedPage.liveUrl,
      selectedModuleId: selectedModule.id,
      visibleScenarioIds: pageScenarios.map((scenario) => scenario.id),
      baseRevisionHashes: {
        [selectedModule.id]: selectedModule.requirementHash,
        [selectedScenario.id]: selectedScenario.revision,
      },
    }),
    [pageScenarios, searchParams, selectedModule, selectedPage, selectedScenario]
  );

  const [browserUrl, setBrowserUrl] = useState(selectedRun?.browserUrl || selectedPage.liveUrl);
  const [locatePulse, setLocatePulse] = useState(0);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('context');
  const [amendment, setAmendment] = useState<PreviewAuthoringAmendment | null>(null);
  const [controlNotice, setControlNotice] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'agent',
      text: '我已加载当前 URL 的全部关联场景。可以直接描述要调整的方向；跨模块资产或跨 URL 修改会先进入人工决策。',
    },
  ]);

  useEffect(() => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  }, [layout]);

  const createAmendment = useCallback(
    (target: PreviewChangeTarget, reason: string) => {
      const next = createPreviewAmendment(cloneScope(scope), target, reason);
      setAmendment(next);
      setInspectorTab('diff');
      return next;
    },
    [scope]
  );

  useEffect(() => {
    if (intentHandled.current || searchParams.get('intent') !== 'cross-url') return;
    intentHandled.current = true;
    createAmendment('cross_url_asset', '补充会话失效后的跨页面恢复路径，并保持支付副作用可追溯。');
  }, [createAmendment, searchParams]);

  const markPendingAmendmentStale = () => {
    setAmendment((current) => {
      if (!current || ['activated', 'rejected', 'failed', 'stale'].includes(current.status))
        return current;
      return { ...current, status: 'stale', auditNote: '工作台上下文已切换，旧候选禁止应用。' };
    });
  };

  const updateContext = (updates: Record<string, string>) => {
    markPendingAmendmentStale();
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => next.set(key, value));
    setSearchParams(next, { replace: false });
  };

  const selectPage = (pageId: string) => {
    const page = previewPages.find((candidate) => candidate.id === pageId) || previewPages[0];
    const scenario = previewScenarios.find((candidate) =>
      candidate.pageDefinitionIds.includes(page.id)
    );
    updateContext({ page: page.id, module: page.modules[0].id, scenario: scenario?.id || '' });
  };

  const selectModule = (moduleId: string) => updateContext({ module: moduleId });
  const selectScenario = (scenarioId: string) => updateContext({ scenario: scenarioId });

  const locateInBrowser = () => {
    setBrowserUrl(selectedPage.liveUrl);
    setLocatePulse((value) => value + 1);
    setControlNotice(`已显式定位到 ${selectedPage.name}，浏览器上下文未因模块切换而自动跳转。`);
  };

  const resizeWithinBounds = useCallback(
    (side: 'left' | 'right', requested: number, containerWidth: number) => {
      setLayout((current) => {
        if (side === 'left') {
          const maxLeft = Math.max(
            MIN_LEFT,
            Math.min(420, containerWidth - current.rightWidth - MIN_BROWSER - SPLITTER_WIDTH * 2)
          );
          return { ...current, leftWidth: Math.max(MIN_LEFT, Math.min(maxLeft, requested)) };
        }
        const maxRight = Math.max(
          MIN_RIGHT,
          Math.min(520, containerWidth - current.leftWidth - MIN_BROWSER - SPLITTER_WIDTH * 2)
        );
        return { ...current, rightWidth: Math.max(MIN_RIGHT, Math.min(maxRight, requested)) };
      });
    },
    []
  );

  const handleResizeStart = (side: 'left' | 'right', event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setIsDragging(true);
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const requested =
        side === 'left' ? moveEvent.clientX - rect.left : rect.right - moveEvent.clientX;
      resizeWithinBounds(side, requested, rect.width);
    };
    const handlePointerUp = () => {
      setIsDragging(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const keyboardResize = (side: 'left' | 'right', delta: number) => {
    const containerWidth = containerRef.current?.getBoundingClientRect().width || 1200;
    resizeWithinBounds(
      side,
      (side === 'left' ? layout.leftWidth : layout.rightWidth) + delta,
      containerWidth
    );
  };

  const approveDecision = () =>
    setAmendment((current) =>
      current?.decision
        ? {
            ...current,
            status: 'candidate_ready',
            decision: { ...current.decision, status: 'approved' },
            auditNote: '人工已批准范围扩展，仍需确认应用并完成验证。',
          }
        : current
    );
  const rejectDecision = () =>
    setAmendment((current) =>
      current?.decision
        ? {
            ...current,
            status: 'rejected',
            decision: { ...current.decision, status: 'rejected' },
            auditNote: '人工拒绝范围扩展，current 资产保持不变。',
          }
        : current
    );
  const amendmentApplicable = amendment ? isAmendmentApplicable(amendment, scope) : false;
  const atomicOperationActive = selectedRun?.state === 'running';

  const verifyAndActivate = () => {
    setAmendment((current) => (current ? { ...current, status: 'verifying' } : current));
    window.setTimeout(
      () =>
        setAmendment((current) =>
          current?.status === 'verifying'
            ? {
                ...current,
                status: 'activated',
                auditNote: '静态校验与真实浏览器验证通过，候选已原子激活。',
              }
            : current
        ),
      700
    );
  };

  const failVerification = () => {
    setAmendment((current) =>
      current
        ? {
            ...current,
            status: 'failed',
            auditNote: '候选未通过真实浏览器验证，current 修订保持不变。',
          }
        : current
    );
  };

  const applyAmendment = () => {
    if (!amendment || !amendmentApplicable) return;
    if (atomicOperationActive) {
      setAmendment({
        ...amendment,
        status: 'queued_at_safe_boundary',
        auditNote: '浏览器原子操作进行中，候选已排队等待安全边界。',
      });
      return;
    }
    verifyAndActivate();
  };

  const handleChatSend = (message: string) => {
    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: 'user', text: message },
    ]);
    let target: PreviewChangeTarget = 'current_module_asset';
    if (/跨页面|跨\s*url|登录|会话恢复/i.test(message)) target = 'cross_url_asset';
    else if (/其他模块|支付模块|地址模块/.test(message)) target = 'same_url_foreign_module_asset';
    else if (/场景|调用顺序|编排/.test(message)) target = 'same_url_scenario_graph';
    const next = createAmendment(target, message);
    const response =
      next.status === 'waiting_decision'
        ? '已生成影响分析。该调整超出默认资产写入范围，我不会直接修改；请先在上方 Diff 中审查并批准范围。'
        : '已把你的方向转换为结构化候选。右侧可即时查看差异；确认后只会在安全边界进入真实验证与原子激活。';
    setMessages((current) => [
      ...current,
      { id: `agent-${Date.now()}`, role: 'agent', text: response },
    ]);
  };

  const gridStyle = layout.browserFocused
    ? { gridTemplateColumns: `0px 0px minmax(${MIN_BROWSER}px, 1fr) 0px 0px` }
    : {
        gridTemplateColumns: `${layout.leftWidth}px ${SPLITTER_WIDTH}px minmax(${MIN_BROWSER}px, 1fr) ${SPLITTER_WIDTH}px ${layout.rightWidth}px`,
      };

  return (
    <main className="preview-workbench" id="preview-main">
      <header className="preview-context-bar">
        <div className="preview-context-title">
          <span className={mode === 'run' ? 'is-run' : 'is-authoring'}>
            {mode === 'run' ? <Activity aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
          </span>
          <div>
            <small>{mode === 'run' ? '运行工作台' : '资产编排工作台'}</small>
            <strong>{mode === 'run' ? selectedRun?.name : '结算体验资产复核'}</strong>
          </div>
        </div>
        <div className="preview-context-selects">
          <label>
            <span>业务版本</span>
            <select
              aria-label="业务版本"
              value={scope.businessVersionId}
              onChange={(event) => updateContext({ version: event.target.value })}
            >
              <option value="bv-checkout-34">checkout-release-3.4</option>
              <option value="bv-checkout-35">checkout-release-3.5-candidate</option>
            </select>
          </label>
          <label>
            <span>环境</span>
            <select aria-label="部署环境" defaultValue="staging">
              <option value="staging">staging · 8f12cd</option>
              <option value="local">local · working tree</option>
            </select>
          </label>
          <label>
            <span>页面 / URL</span>
            <select
              aria-label="当前页面"
              value={selectedPage.id}
              onChange={(event) => selectPage(event.target.value)}
            >
              {previewPages.map((page) => (
                <option value={page.id} key={page.id}>
                  {page.name} · {page.routeTemplate}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>模块</span>
            <select
              aria-label="当前模块"
              value={selectedModule.id}
              onChange={(event) => selectModule(event.target.value)}
            >
              {selectedPage.modules.map((module) => (
                <option value={module.id} key={module.id}>
                  {module.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>场景</span>
            <select
              aria-label="当前场景"
              value={selectedScenario.id}
              onChange={(event) => selectScenario(event.target.value)}
            >
              {pageScenarios.map((scenario) => (
                <option value={scenario.id} key={scenario.id}>
                  {scenario.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="preview-context-actions">
          <button
            type="button"
            className="preview-button preview-button-secondary"
            onClick={locateInBrowser}
          >
            <LocateFixed aria-hidden="true" />
            在浏览器中定位
          </button>
          <button
            type="button"
            className="preview-button preview-button-primary"
            onClick={() =>
              createAmendment(
                'current_module_asset',
                `重新编排 ${selectedModule.name} 的功能脚本与验收步骤。`
              )
            }
          >
            <RefreshCw aria-hidden="true" />
            一键重新编排
          </button>
        </div>
      </header>

      {controlNotice && (
        <div className="preview-live-notice" role="status">
          <CheckCircle2 aria-hidden="true" />
          {controlNotice}
          <button type="button" aria-label="关闭提示" onClick={() => setControlNotice(null)}>
            <X aria-hidden="true" />
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className={cn(
          'preview-workbench-grid',
          isDragging && 'is-dragging',
          layout.browserFocused && 'is-browser-focused'
        )}
        style={gridStyle}
      >
        <ContextTree
          pageId={selectedPage.id}
          moduleId={selectedModule.id}
          scenarioId={selectedScenario.id}
          run={selectedRun}
          onSelectPage={selectPage}
          onSelectModule={selectModule}
          onSelectScenario={selectScenario}
        />
        <Splitter
          side="left"
          value={layout.leftWidth}
          onPointerDown={handleResizeStart}
          onKeyboardResize={keyboardResize}
          onReset={() =>
            setLayout((current) => ({ ...current, leftWidth: DEFAULT_LAYOUT.leftWidth }))
          }
        />
        <section className="preview-browser-column">
          <div className="preview-browser-commandbar">
            <div>
              <span className="preview-live-dot" />
              <strong>browser-session-01</strong>
              <small>
                {atomicOperationActive
                  ? '当前子代理持有控制 · UI 只读'
                  : '观察模式 · 无活动原子操作'}
              </small>
            </div>
            <div className="preview-browser-controls">
              <button
                type="button"
                onClick={() =>
                  setLayout((current) => ({
                    ...current,
                    browserZoom: Math.max(70, current.browserZoom - 5),
                  }))
                }
                aria-label="缩小浏览器内容"
              >
                <Minus aria-hidden="true" />
              </button>
              <label>
                <span className="sr-only">浏览器缩放</span>
                <input
                  type="range"
                  min="70"
                  max="110"
                  value={layout.browserZoom}
                  onChange={(event) =>
                    setLayout((current) => ({
                      ...current,
                      browserZoom: Number(event.target.value),
                    }))
                  }
                />
                <strong>{layout.browserZoom}%</strong>
              </label>
              <button
                type="button"
                onClick={() =>
                  setLayout((current) => ({
                    ...current,
                    browserZoom: Math.min(110, current.browserZoom + 5),
                  }))
                }
                aria-label="放大浏览器内容"
              >
                <Plus aria-hidden="true" />
              </button>
              <span className="preview-toolbar-divider" />
              <button
                type="button"
                onClick={() =>
                  setLayout((current) => ({
                    ...current,
                    leftWidth: 360,
                    rightWidth: 480,
                    browserFocused: false,
                  }))
                }
                aria-label="缩小浏览器面板"
                title="缩小浏览器"
              >
                <Columns3 aria-hidden="true" />
              </button>
              <button
                type="button"
                className={cn(layout.browserFocused && 'is-active')}
                onClick={() =>
                  setLayout((current) => ({ ...current, browserFocused: !current.browserFocused }))
                }
                aria-label={layout.browserFocused ? '恢复三栏布局' : '聚焦浏览器'}
                title={layout.browserFocused ? '恢复三栏布局' : '聚焦浏览器'}
              >
                {layout.browserFocused ? (
                  <RotateCcw aria-hidden="true" />
                ) : (
                  <Maximize2 aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
          <BrowserStage
            url={browserUrl}
            selectedModule={selectedModule}
            amendment={amendment}
            zoom={layout.browserZoom}
            run={selectedRun}
            locatePulse={locatePulse}
          />
          <div className="preview-browser-statusbar">
            <div>
              <TerminalSquare aria-hidden="true" />
              <span>
                {atomicOperationActive ? 'operation_execute · op_8F21' : '等待受控浏览器操作'}
              </span>
            </div>
            {mode === 'run' && (
              <div className="preview-run-controls">
                {selectedRun?.state === 'running' && (
                  <button
                    type="button"
                    onClick={() => setControlNotice('暂停已请求，将在当前原子操作结束后生效。')}
                  >
                    <Pause aria-hidden="true" />
                    安全暂停
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setControlNotice('取消已记录为独立命令和取消态，并将在安全边界收敛。')
                  }
                >
                  <Square aria-hidden="true" />
                  取消运行
                </button>
              </div>
            )}
          </div>
        </section>
        <Splitter
          side="right"
          value={layout.rightWidth}
          onPointerDown={handleResizeStart}
          onKeyboardResize={keyboardResize}
          onReset={() =>
            setLayout((current) => ({ ...current, rightWidth: DEFAULT_LAYOUT.rightWidth }))
          }
        />
        <aside className="preview-right-panel">
          <section className="preview-inspector">
            <div className="preview-inspector-tabs" role="tablist" aria-label="上下文检查器">
              <button
                id="preview-inspector-tab-context"
                aria-controls="preview-inspector-panel"
                type="button"
                role="tab"
                aria-selected={inspectorTab === 'context'}
                className={cn(inspectorTab === 'context' && 'is-active')}
                onClick={() => setInspectorTab('context')}
              >
                <FileText aria-hidden="true" />
                上下文
              </button>
              <button
                id="preview-inspector-tab-diff"
                aria-controls="preview-inspector-panel"
                type="button"
                role="tab"
                aria-selected={inspectorTab === 'diff'}
                className={cn(inspectorTab === 'diff' && 'is-active')}
                onClick={() => setInspectorTab('diff')}
              >
                <FileDiff aria-hidden="true" />
                Diff{amendment && <i />}
              </button>
              <button
                id="preview-inspector-tab-evidence"
                aria-controls="preview-inspector-panel"
                type="button"
                role="tab"
                aria-selected={inspectorTab === 'evidence'}
                className={cn(inspectorTab === 'evidence' && 'is-active')}
                onClick={() => setInspectorTab('evidence')}
              >
                <Image aria-hidden="true" />
                证据
              </button>
            </div>
            <div
              id="preview-inspector-panel"
              className="preview-inspector-content"
              role="tabpanel"
              aria-labelledby={`preview-inspector-tab-${inspectorTab}`}
            >
              {inspectorTab === 'context' ? (
                <ContextInspector
                  module={selectedModule}
                  scenario={selectedScenario}
                  onReorchestrateScenario={() =>
                    createAmendment(
                      'same_url_scenario_graph',
                      `重新编排当前 URL 下的场景 ${selectedScenario.name}。`
                    )
                  }
                />
              ) : inspectorTab === 'diff' ? (
                <DiffInspector
                  amendment={amendment}
                  isApplicable={amendmentApplicable}
                  onApprove={approveDecision}
                  onReject={rejectDecision}
                  onApply={applyAmendment}
                  onFail={failVerification}
                  onReachSafeBoundary={verifyAndActivate}
                />
              ) : (
                <EvidenceInspector run={selectedRun} />
              )}
            </div>
          </section>
          <AgentChat
            collapsed={layout.chatCollapsed}
            messages={messages}
            amendment={amendment}
            scope={scope}
            onToggle={() =>
              setLayout((current) => ({ ...current, chatCollapsed: !current.chatCollapsed }))
            }
            onSend={handleChatSend}
          />
        </aside>
      </div>
    </main>
  );
}
