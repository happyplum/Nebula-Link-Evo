import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Activity,
  Archive,
  Bot,
  Braces,
  CheckCircle2,
  ChevronRight,
  CircleGauge,
  Clock3,
  FileCheck2,
  FileText,
  FlaskConical,
  GitBranch,
  Layers3,
  Moon,
  Play,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
} from 'lucide-react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils.js';
import { previewPages, previewRuns, previewScenarios } from './fixtures.js';
import type { PreviewThemePreference } from './types.js';
import { PreviewWorkbench } from './components/PreviewWorkbench.js';
import './preview.css';

const THEME_STORAGE_KEY = 'ai-e2e.preview.theme';

const navigation = [
  { to: '/__preview/overview', label: '总览', icon: CircleGauge },
  { to: '/__preview/versions', label: '业务版本', icon: GitBranch },
  { to: '/__preview/assets', label: '资产中心', icon: Layers3 },
  { to: '/__preview/authoring', label: '资产编排', icon: Sparkles },
  { to: '/__preview/runs', label: '运行中心', icon: Play },
  { to: '/__preview/decisions', label: '决策中心', icon: ShieldCheck },
  { to: '/__preview/evidence', label: '证据库', icon: Archive },
  { to: '/__preview/settings', label: '设置', icon: Settings2 },
] as const;

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function usePreviewTheme() {
  const [preference, setPreference] = useState<PreviewThemePreference>(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  });
  const [systemTheme, setSystemTheme] = useState(getSystemTheme);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemTheme(media.matches ? 'dark' : 'light');
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  const setTheme = (next: PreviewThemePreference) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    setPreference(next);
  };

  return {
    preference,
    resolvedTheme: preference === 'system' ? systemTheme : preference,
    setTheme,
  };
}

function StatusPill({
  tone,
  children,
}: {
  tone: 'blue' | 'cyan' | 'green' | 'amber' | 'red';
  children: ReactNode;
}) {
  return <span className={`preview-status preview-status-${tone}`}>{children}</span>;
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'blue',
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  tone?: 'blue' | 'cyan' | 'green' | 'amber';
}) {
  return (
    <article className="preview-card preview-metric-card">
      <div className={`preview-icon-box preview-icon-${tone}`}>
        <Icon aria-hidden="true" />
      </div>
      <div>
        <p className="preview-kicker">{label}</p>
        <strong>{value}</strong>
        <p className="preview-muted">{detail}</p>
      </div>
    </article>
  );
}

function OverviewPage() {
  return (
    <PreviewPageFrame
      eyebrow="工作区总览"
      title="让每一次浏览器操作都有上下文"
      description="从 PRD 到运行证据，编排、执行、决策和恢复保持在同一个业务版本内。"
      action={
        <Link className="preview-button preview-button-primary" to="/__preview/authoring">
          <Sparkles aria-hidden="true" /> 进入资产编排
        </Link>
      }
    >
      <section className="preview-metric-grid" aria-label="关键指标">
        <MetricCard label="业务版本" value="3" detail="1 个版本等待复核" icon={GitBranch} />
        <MetricCard
          label="语义资产"
          value="24"
          detail="21 个已通过真实验证"
          icon={Braces}
          tone="cyan"
        />
        <MetricCard
          label="运行成功率"
          value="96.4%"
          detail="过去 7 天共 83 次运行"
          icon={CheckCircle2}
          tone="green"
        />
        <MetricCard
          label="待处理决策"
          value="2"
          detail="跨 URL 编排与副作用审批"
          icon={ShieldCheck}
          tone="amber"
        />
      </section>

      <section className="preview-overview-grid">
        <article className="preview-card preview-hero-card">
          <div className="preview-section-heading">
            <div>
              <p className="preview-kicker">正在运行</p>
              <h2>结算主链路回归</h2>
            </div>
            <StatusPill tone="cyan">
              <span className="preview-live-dot" />
              浏览器受控执行
            </StatusPill>
          </div>
          <div className="preview-run-overview">
            <div className="preview-ring" style={{ '--progress': '62%' } as CSSProperties}>
              <strong>62%</strong>
              <span>12 / 19 TODO</span>
            </div>
            <div className="preview-run-copy">
              <p>当前页面</p>
              <strong>订单结算页</strong>
              <p>当前步骤</p>
              <strong>提交订单前副作用检查</strong>
              <Link to="/__preview/runs/run-live" className="preview-text-link">
                打开运行工作台 <ChevronRight aria-hidden="true" />
              </Link>
            </div>
          </div>
        </article>

        <article className="preview-card">
          <div className="preview-section-heading">
            <div>
              <p className="preview-kicker">版本健康度</p>
              <h2>checkout-release-3.4</h2>
            </div>
            <StatusPill tone="green">可运行</StatusPill>
          </div>
          <div className="preview-health-list">
            {[
              ['需求覆盖', '88%', 'green'],
              ['脚本验证', '21 / 24', 'cyan'],
              ['页面基线', '2 / 2', 'blue'],
              ['待复核资产', '3', 'amber'],
            ].map(([label, value, tone]) => (
              <div key={label}>
                <span className={`preview-health-dot preview-health-${tone}`} />
                {label}
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <Link to="/__preview/versions" className="preview-text-link">
            查看业务版本 <ChevronRight aria-hidden="true" />
          </Link>
        </article>
      </section>

      <section className="preview-card">
        <div className="preview-section-heading">
          <div>
            <p className="preview-kicker">需要关注</p>
            <h2>可行动的问题，而不是噪声</h2>
          </div>
          <Link to="/__preview/decisions" className="preview-text-link">
            查看全部
          </Link>
        </div>
        <div className="preview-attention-grid">
          <Link to="/__preview/authoring?intent=cross-url" className="preview-attention-item">
            <ShieldCheck aria-hidden="true" />
            <div>
              <strong>跨 URL 场景修订等待审批</strong>
              <span>会话失效后恢复结算 · 影响 2 个页面</span>
            </div>
            <ChevronRight aria-hidden="true" />
          </Link>
          <Link to="/__preview/runs/run-interrupted" className="preview-attention-item">
            <Clock3 aria-hidden="true" />
            <div>
              <strong>1 次运行结果未知</strong>
              <span>需要检查订单副作用后决定恢复策略</span>
            </div>
            <ChevronRight aria-hidden="true" />
          </Link>
        </div>
      </section>
    </PreviewPageFrame>
  );
}

function VersionsPage() {
  const versions = [
    {
      id: 'bv-checkout-34',
      name: 'checkout-release-3.4',
      status: '可运行',
      tone: 'green' as const,
      source: 'release/3.4 · staging@8f12cd',
      coverage: '88%',
    },
    {
      id: 'bv-checkout-35',
      name: 'checkout-release-3.5-candidate',
      status: '等待复核',
      tone: 'amber' as const,
      source: 'feature/new-payment · staging@c9e24a',
      coverage: '73%',
    },
    {
      id: 'bv-checkout-33',
      name: 'checkout-release-3.3',
      status: '已归档',
      tone: 'blue' as const,
      source: 'release/3.3 · production@71ab92',
      coverage: '91%',
    },
  ];
  return (
    <PreviewPageFrame
      eyebrow="版本治理"
      title="业务版本"
      description="资产、决策和运行只在所属版本内演进，复制后保持独立。"
    >
      <div className="preview-table-card">
        <div className="preview-table-header">
          <span>版本</span>
          <span>来源与部署</span>
          <span>覆盖率</span>
          <span>状态</span>
          <span />
        </div>
        {versions.map((version) => (
          <Link
            className="preview-table-row"
            key={version.id}
            to={`/__preview/authoring?version=${version.id}`}
          >
            <span>
              <GitBranch aria-hidden="true" />
              <strong>{version.name}</strong>
              <small>{version.id}</small>
            </span>
            <span>{version.source}</span>
            <span>{version.coverage}</span>
            <span>
              <StatusPill tone={version.tone}>{version.status}</StatusPill>
            </span>
            <ChevronRight aria-hidden="true" />
          </Link>
        ))}
      </div>
    </PreviewPageFrame>
  );
}

function AssetsPage() {
  return (
    <PreviewPageFrame
      eyebrow="语义资产"
      title="资产中心"
      description="从页面锚点到场景调用图，按稳定身份查看当前修订与验证状态。"
    >
      <div className="preview-asset-grid">
        {previewPages.map((page) => (
          <article className="preview-card preview-asset-card" key={page.id}>
            <div className="preview-section-heading">
              <div className="preview-icon-box preview-icon-blue">
                <FileText aria-hidden="true" />
              </div>
              <StatusPill tone="green">基线有效</StatusPill>
            </div>
            <p className="preview-kicker">页面 · {page.routeTemplate}</p>
            <h2>{page.name}</h2>
            <p className="preview-muted">
              {page.modules.length} 个模块 ·{' '}
              {
                previewScenarios.filter((scenario) => scenario.pageDefinitionIds.includes(page.id))
                  .length
              }{' '}
              个关联场景
            </p>
            <div className="preview-chip-row">
              {page.modules.map((module) => (
                <span key={module.id}>{module.name}</span>
              ))}
            </div>
            <Link
              className="preview-button preview-button-secondary"
              to={`/__preview/authoring?page=${page.id}&module=${page.modules[0].id}`}
            >
              打开编排工作台 <ChevronRight aria-hidden="true" />
            </Link>
          </article>
        ))}
      </div>
    </PreviewPageFrame>
  );
}

function RunsPage() {
  return (
    <PreviewPageFrame
      eyebrow="执行与恢复"
      title="运行中心"
      description="分层呈现 Run、TODO、尝试、决策与证据，不从本地百分比猜测权威状态。"
      action={
        <Link className="preview-button preview-button-primary" to="/__preview/runs/run-live">
          <Play aria-hidden="true" />
          打开实时运行
        </Link>
      }
    >
      <div className="preview-run-list">
        {previewRuns.map((run) => {
          const tone =
            run.state === 'completed'
              ? 'green'
              : run.state === 'failed'
                ? 'red'
                : run.state === 'waiting_decision' || run.state === 'interrupted'
                  ? 'amber'
                  : 'cyan';
          return (
            <Link to={`/__preview/runs/${run.id}`} className="preview-run-row" key={run.id}>
              <div className={`preview-run-state preview-run-state-${tone}`}>
                <Activity aria-hidden="true" />
              </div>
              <div>
                <strong>{run.name}</strong>
                <span>{run.description}</span>
              </div>
              <div className="preview-run-progress">
                <span>
                  <i style={{ width: `${run.progress}%` }} />
                </span>
                <small>{run.progress}%</small>
              </div>
              <StatusPill tone={tone}>{run.statusLabel}</StatusPill>
              <ChevronRight aria-hidden="true" />
            </Link>
          );
        })}
      </div>
    </PreviewPageFrame>
  );
}

function DecisionsPage() {
  return (
    <PreviewPageFrame
      eyebrow="人工控制点"
      title="决策中心"
      description="只有明确的范围扩展或副作用风险才打断流程，并展示完整影响。"
    >
      <div className="preview-decision-grid">
        <article className="preview-card preview-decision-card">
          <div>
            <StatusPill tone="amber">等待决定</StatusPill>
            <span className="preview-mono">dec_scope_302</span>
          </div>
          <h2>允许修改登录页的会话恢复资产？</h2>
          <p>Agent 发现结算恢复场景需要跨 URL 调整，但当前授权范围仅覆盖订单结算页。</p>
          <dl>
            <div>
              <dt>影响 URL</dt>
              <dd>/checkout/:cartId、/account/login</dd>
            </div>
            <div>
              <dt>影响资产</dt>
              <dd>2 个模块、1 个场景、2 个脚本</dd>
            </div>
            <div>
              <dt>激活条件</dt>
              <dd>批准后仍需静态校验与真实浏览器验证</dd>
            </div>
          </dl>
          <Link
            to="/__preview/authoring?intent=cross-url"
            className="preview-button preview-button-primary"
          >
            查看影响并决策 <ChevronRight aria-hidden="true" />
          </Link>
        </article>
        <article className="preview-card preview-decision-card">
          <div>
            <StatusPill tone="cyan">运行决策</StatusPill>
            <span className="preview-mono">dec_effect_117</span>
          </div>
          <h2>结果未知：检查副作用后恢复</h2>
          <p>订单提交响应中断，系统等待人工选择恢复检查，而不是使用新操作 ID 重放。</p>
          <dl>
            <div>
              <dt>运行</dt>
              <dd>订单恢复验证</dd>
            </div>
            <div>
              <dt>当前操作</dt>
              <dd>op_8F21 · outcome unknown</dd>
            </div>
          </dl>
          <Link
            to="/__preview/runs/run-interrupted"
            className="preview-button preview-button-secondary"
          >
            进入恢复工作台 <ChevronRight aria-hidden="true" />
          </Link>
        </article>
      </div>
    </PreviewPageFrame>
  );
}

function EvidencePage() {
  const evidence = [
    ['ev_903', '提交订单 · after screenshot', 'image/webp', '已封存'],
    ['ev_902', '配送地址 · DOM capture', 'application/json', '已封存'],
    ['ev_901', '订单金额 · assertion result', 'application/json', '已封存'],
    ['ev_884', '优惠错误 · failure screenshot', 'image/webp', '待关联'],
  ];
  return (
    <PreviewPageFrame
      eyebrow="不可变证据"
      title="证据库"
      description="从运行、TODO 和原子操作回溯截图、DOM 与断言结果。"
    >
      <div className="preview-table-card">
        <div className="preview-table-header preview-evidence-columns">
          <span>证据</span>
          <span>类型</span>
          <span>关联</span>
          <span>状态</span>
        </div>
        {evidence.map(([id, name, type, status]) => (
          <button type="button" className="preview-table-row preview-evidence-columns" key={id}>
            <span>
              <FileCheck2 aria-hidden="true" />
              <strong>{name}</strong>
              <small>{id}</small>
            </span>
            <span className="preview-mono">{type}</span>
            <span>run-live / todo-payment</span>
            <span>
              <StatusPill tone={status === '已封存' ? 'green' : 'amber'}>{status}</StatusPill>
            </span>
          </button>
        ))}
      </div>
    </PreviewPageFrame>
  );
}

function SettingsPage({
  theme,
  onThemeChange,
}: {
  theme: PreviewThemePreference;
  onThemeChange: (theme: PreviewThemePreference) => void;
}) {
  return (
    <PreviewPageFrame
      eyebrow="预览偏好"
      title="设置"
      description="这些选项只保存在当前浏览器，不会写入生产配置。"
    >
      <article className="preview-card preview-settings-card">
        <div>
          <h2>界面主题</h2>
          <p className="preview-muted">默认跟随系统，也可以为体验原型单独指定。</p>
        </div>
        <div className="preview-theme-options" role="radiogroup" aria-label="界面主题">
          {(['system', 'light', 'dark'] as const).map((value) => (
            <button
              type="button"
              role="radio"
              aria-checked={theme === value}
              className={cn(theme === value && 'is-active')}
              onClick={() => onThemeChange(value)}
              key={value}
            >
              {value === 'system' ? (
                <CircleGauge aria-hidden="true" />
              ) : value === 'light' ? (
                <Sun aria-hidden="true" />
              ) : (
                <Moon aria-hidden="true" />
              )}
              <span>{value === 'system' ? '跟随系统' : value === 'light' ? '浅色' : '深色'}</span>
            </button>
          ))}
        </div>
      </article>
      <article className="preview-card preview-settings-card">
        <div>
          <h2>浏览器工作台</h2>
          <p className="preview-muted">列宽、Chat 状态与浏览器缩放会自动持久化。</p>
        </div>
        <button
          className="preview-button preview-button-secondary"
          type="button"
          onClick={() => window.localStorage.removeItem('ai-e2e.preview.layout')}
        >
          清除布局偏好
        </button>
      </article>
    </PreviewPageFrame>
  );
}

function PreviewPageFrame({
  eyebrow,
  title,
  description,
  action,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="preview-page" id="preview-main" tabIndex={-1}>
      <header className="preview-page-header">
        <div>
          <p className="preview-kicker">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {action}
      </header>
      {children}
    </main>
  );
}

export function PreviewApp() {
  const { preference, resolvedTheme, setTheme } = usePreviewTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const currentNav = useMemo(
    () => navigation.find((item) => location.pathname.startsWith(item.to)),
    [location.pathname]
  );

  const cycleTheme = () => {
    setTheme(preference === 'system' ? 'light' : preference === 'light' ? 'dark' : 'system');
  };

  return (
    <div className="preview-root" data-theme={resolvedTheme}>
      <a href="#preview-main" className="preview-skip-link">
        跳到主要内容
      </a>
      <div className="preview-viewport-warning" role="status">
        <FlaskConical aria-hidden="true" />
        <strong>体验原型面向 1440px 及以上桌面</strong>
        <span>请扩大窗口后继续预览浏览器中心工作台。</span>
      </div>
      <aside className="preview-sidebar">
        <div className="preview-brand">
          <span>
            <Bot aria-hidden="true" />
          </span>
          <div>
            <strong>Nebula E2E</strong>
            <small>Semantic workspace</small>
          </div>
        </div>
        <div className="preview-badge">
          <FlaskConical aria-hidden="true" />
          开发体验原型
        </div>
        <nav aria-label="体验原型导航">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => cn(isActive && 'is-active')}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
              {to === '/__preview/decisions' && <i>2</i>}
            </NavLink>
          ))}
        </nav>
        <div className="preview-sidebar-footer">
          <div>
            <span className="preview-live-dot" />
            <div>
              <strong>staging</strong>
              <small>浏览器网关就绪</small>
            </div>
          </div>
          <button type="button" onClick={() => navigate('/')} aria-label="返回旧版工作区">
            返回旧版
          </button>
        </div>
      </aside>

      <section className="preview-shell">
        <header className="preview-topbar">
          <div>
            <span>AI E2E</span>
            <ChevronRight aria-hidden="true" />
            <strong>{currentNav?.label || '体验原型'}</strong>
          </div>
          <div className="preview-topbar-actions">
            <label className="preview-search">
              <Search aria-hidden="true" />
              <span className="sr-only">搜索</span>
              <input placeholder="搜索版本、模块、运行…" />
            </label>
            <button
              type="button"
              className="preview-icon-button"
              onClick={cycleTheme}
              aria-label={`切换主题，当前为${preference}`}
              title={`主题：${preference}`}
            >
              {resolvedTheme === 'dark' ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
            </button>
            <button type="button" className="preview-user" aria-label="打开 LZ 用户菜单">
              LZ
            </button>
          </div>
        </header>
        <div className="preview-content">
          <Routes>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<OverviewPage />} />
            <Route path="versions" element={<VersionsPage />} />
            <Route path="assets" element={<AssetsPage />} />
            <Route path="authoring" element={<PreviewWorkbench mode="authoring" />} />
            <Route path="runs" element={<RunsPage />} />
            <Route path="runs/:runId" element={<PreviewWorkbench mode="run" />} />
            <Route path="decisions" element={<DecisionsPage />} />
            <Route path="evidence" element={<EvidencePage />} />
            <Route
              path="settings"
              element={<SettingsPage theme={preference} onThemeChange={setTheme} />}
            />
            <Route path="*" element={<Navigate to="overview" replace />} />
          </Routes>
        </div>
      </section>
    </div>
  );
}
