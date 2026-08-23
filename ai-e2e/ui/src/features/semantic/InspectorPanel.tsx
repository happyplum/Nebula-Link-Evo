import {
  AlertTriangle,
  ArrowDown,
  Check,
  FileDiff,
  FileText,
  GitCommitHorizontal,
  Network,
  ShieldAlert,
  ShieldCheck,
  TestTube2,
  X,
} from 'lucide-react';
import type { AuthoringAmendment, RunSnapshot, SemanticWorkspace } from './types.js';
import { list, record, text } from './types.js';

export type InspectorTab = 'context' | 'diff' | 'evidence';
export type ContextPreview = 'prd' | 'module' | 'scenario';

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function statusTone(state: string) {
  if (state === 'activated' || state === 'completed' || state === 'valid') return 'green';
  if (state === 'failed' || state === 'rejected' || state === 'stale') return 'red';
  if (state === 'waiting_decision' || state === 'queued_at_safe_boundary') return 'amber';
  return 'cyan';
}

export function InspectorPanel({
  tab,
  preview,
  workspace,
  moduleId,
  scenarioId,
  amendments,
  runSnapshot,
  busy,
  applicability,
  onTab,
  onPreview,
  onApprove,
  onRejectDecision,
  onApply,
  onRejectAmendment,
  onRunDecision,
}: {
  tab: InspectorTab;
  preview: ContextPreview;
  workspace: SemanticWorkspace;
  moduleId: string;
  scenarioId: string;
  amendments: AuthoringAmendment[];
  runSnapshot?: RunSnapshot;
  busy: boolean;
  applicability: (amendment: AuthoringAmendment) => { allowed: boolean; reason?: string };
  onTab: (tab: InspectorTab) => void;
  onPreview: (preview: ContextPreview) => void;
  onApprove: (amendmentId: string, decisionId: string) => void;
  onRejectDecision: (amendmentId: string, decisionId: string) => void;
  onApply: (amendmentId: string) => void;
  onRejectAmendment: (amendmentId: string) => void;
  onRunDecision: (decisionId: string, answerKey: string) => void;
}) {
  return (
    <section className="semantic-inspector" aria-label="上下文、差异与证据">
      <div className="semantic-tabs" role="tablist" aria-label="检查器视图">
        {(
          [
            ['context', '上下文'],
            ['diff', `Diff ${amendments.length || ''}`],
            ['evidence', '证据'],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? 'is-active' : ''}
            onClick={() => onTab(value)}
            key={value}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="semantic-inspector-scroll">
        {tab === 'context' && (
          <ContextPane
            preview={preview}
            workspace={workspace}
            moduleId={moduleId}
            scenarioId={scenarioId}
            onPreview={onPreview}
          />
        )}
        {tab === 'diff' && (
          <DiffPane
            amendments={amendments}
            busy={busy}
            applicability={applicability}
            onApprove={onApprove}
            onRejectDecision={onRejectDecision}
            onApply={onApply}
            onRejectAmendment={onRejectAmendment}
          />
        )}
        {tab === 'evidence' && (
          <EvidencePane snapshot={runSnapshot} busy={busy} onRunDecision={onRunDecision} />
        )}
      </div>
    </section>
  );
}

function ContextPane({
  preview,
  workspace,
  moduleId,
  scenarioId,
  onPreview,
}: {
  preview: ContextPreview;
  workspace: SemanticWorkspace;
  moduleId: string;
  scenarioId: string;
  onPreview: (preview: ContextPreview) => void;
}) {
  const module = workspace.functionalModules.find((entry) => entry.id === moduleId);
  const page = workspace.pages.find((entry) => entry.id === module?.primaryPageDefinitionId);
  const scripts = workspace.functionalScripts.filter(
    (entry) => entry.functionalModuleId === moduleId
  );
  const scriptIds = new Set(scripts.map((entry) => entry.id));
  const linkedScenarios = workspace.scenarios.filter((scenario) =>
    list(scenario.currentRevision.payload.calls).some((call) =>
      scriptIds.has(text(record(call).functionalScriptId, ''))
    )
  );
  const scenario = workspace.scenarios.find((entry) => entry.id === scenarioId);
  const verified = scripts.filter(
    (entry) => entry.currentRevision.readinessStatus === 'verified'
  ).length;

  return (
    <>
      <div className="semantic-preview-switch" aria-label="上下文预览类型">
        <button
          type="button"
          className={preview === 'prd' ? 'is-active' : ''}
          onClick={() => onPreview('prd')}
        >
          <FileText aria-hidden="true" />
          PRD
        </button>
        <button
          type="button"
          className={preview === 'module' ? 'is-active' : ''}
          onClick={() => onPreview('module')}
        >
          <GitCommitHorizontal aria-hidden="true" />
          模块
        </button>
        <button
          type="button"
          className={preview === 'scenario' ? 'is-active' : ''}
          onClick={() => onPreview('scenario')}
        >
          <Network aria-hidden="true" />
          场景
        </button>
      </div>

      {preview === 'prd' && (
        <div className="semantic-inspector-stack">
          <InfoHeader
            eyebrow="关联需求"
            title={
              module ? text(module.currentRevision.payload.name, module.moduleKey) : '当前模块'
            }
            icon={FileText}
          />
          {workspace.prdDocuments.length === 0 ? (
            <Empty label="当前版本没有 PRD 文档" />
          ) : (
            workspace.prdDocuments.map((document) => (
              <article className="semantic-info-card" key={document.id}>
                <div className="semantic-card-title">
                  <strong>{document.documentKey}</strong>
                  <span>{document.contentSha256.slice(0, 8)}</span>
                </div>
                <pre className="semantic-prd-content">{document.rawContent.slice(0, 3_000)}</pre>
                <div className="semantic-source-ref">
                  来源：{document.sourceUri ?? '版本内嵌文档'}
                </div>
              </article>
            ))
          )}
          <JsonSection
            title="PRD 来源定位"
            value={module?.currentRevision.payload.prdSourceRefs ?? []}
          />
        </div>
      )}

      {preview === 'module' && (
        <div className="semantic-inspector-stack">
          <InfoHeader
            eyebrow="功能模块"
            title={
              module ? text(module.currentRevision.payload.name, module.moduleKey) : '未选择模块'
            }
            icon={GitCommitHorizontal}
          />
          <div className="semantic-metric-grid">
            <Metric label="功能脚本" value={scripts.length} />
            <Metric label="关联场景" value={linkedScenarios.length} />
            <Metric
              label="验证覆盖"
              value={scripts.length ? `${Math.round((verified / scripts.length) * 100)}%` : '0%'}
            />
            <Metric label="修订" value={module ? `r${module.currentRevision.revisionNo}` : '—'} />
          </div>
          <article className="semantic-info-card">
            <Field
              label="主页面"
              value={page ? text(page.currentRevision.payload.name, page.pageKey) : '—'}
            />
            <Field
              label="目标"
              value={text(
                module?.currentRevision.payload.purpose ?? module?.currentRevision.payload.goal,
                '未声明'
              )}
            />
            <Field
              label="验证状态"
              value={
                module?.currentRevision.readinessStatus ??
                module?.currentRevision.validationStatus ??
                '—'
              }
            />
          </article>
          <div className="semantic-list-card">
            <strong>功能脚本</strong>
            {scripts.map((script) => (
              <div key={script.id}>
                <span>{script.name}</span>
                <small>
                  {script.currentRevision.readinessStatus ??
                    script.currentRevision.validationStatus}
                </small>
              </div>
            ))}
            {scripts.length === 0 && <small>暂无脚本</small>}
          </div>
          <JsonSection
            title="验收标准"
            value={
              module?.currentRevision.payload.acceptanceCriteria ??
              module?.currentRevision.payload.acceptance ??
              []
            }
          />
        </div>
      )}

      {preview === 'scenario' && (
        <div className="semantic-inspector-stack">
          <InfoHeader eyebrow="调用场景" title={scenario?.name ?? '未选择场景'} icon={Network} />
          <p className="semantic-summary">
            {text(scenario?.currentRevision.payload.purpose, '尚未声明场景目标')}
          </p>
          <div className="semantic-dag">
            {list(scenario?.currentRevision.payload.calls).map((rawCall, index) => {
              const call = record(rawCall);
              const script = workspace.functionalScripts.find(
                (entry) => entry.id === call.functionalScriptId
              );
              const owner = workspace.functionalModules.find(
                (entry) => entry.id === script?.functionalModuleId
              );
              const targetPage = workspace.pages.find(
                (entry) => entry.id === owner?.primaryPageDefinitionId
              );
              return (
                <div key={text(call.callKey, String(index))}>
                  <span>{index + 1}</span>
                  <section>
                    <strong>{text(call.callKey, script?.name ?? `节点 ${index + 1}`)}</strong>
                    <small>{script?.name ?? text(call.functionalScriptId)}</small>
                    <em>
                      {targetPage
                        ? text(targetPage.currentRevision.payload.routeTemplate, targetPage.pageKey)
                        : '跨 URL 未解析'}
                    </em>
                  </section>
                  {index < list(scenario?.currentRevision.payload.calls).length - 1 && (
                    <ArrowDown aria-hidden="true" />
                  )}
                </div>
              );
            })}
          </div>
          <JsonSection title="依赖边" value={scenario?.currentRevision.payload.edges ?? []} />
          <JsonSection
            title="输入与最终验收"
            value={{
              inputs: scenario?.currentRevision.payload.inputs ?? [],
              finalAcceptance: scenario?.currentRevision.payload.finalAcceptance ?? [],
            }}
          />
        </div>
      )}
    </>
  );
}

function DiffPane({
  amendments,
  busy,
  applicability,
  onApprove,
  onRejectDecision,
  onApply,
  onRejectAmendment,
}: {
  amendments: AuthoringAmendment[];
  busy: boolean;
  applicability: (amendment: AuthoringAmendment) => { allowed: boolean; reason?: string };
  onApprove: (amendmentId: string, decisionId: string) => void;
  onRejectDecision: (amendmentId: string, decisionId: string) => void;
  onApply: (amendmentId: string) => void;
  onRejectAmendment: (amendmentId: string) => void;
}) {
  if (amendments.length === 0)
    return <Empty label="重新编排或在 Chat 中提出修改后，结构化 Diff 会显示在这里" />;
  return (
    <div className="semantic-inspector-stack">
      {amendments.map((amendment) => {
        const check = applicability(amendment);
        const openDecisions = amendment.decisions.filter(
          (decision) => text(decision.status) === 'open'
        );
        return (
          <article className="semantic-amendment" key={amendment.id}>
            <div className="semantic-card-title">
              <span className={`semantic-status is-${statusTone(amendment.state)}`}>
                {amendment.state}
              </span>
              <small>{amendment.category}</small>
            </div>
            <h3>{amendment.reason}</h3>
            <div className="semantic-impact-grid">
              <Field
                label="受影响 URL"
                value={
                  list(amendment.impact.urls ?? amendment.impact.affectedUrls)
                    .map(String)
                    .join(', ') || '当前 URL'
                }
              />
              <Field label="变更数量" value={String(amendment.changes.length)} />
              <Field
                label="基础 → 目标"
                value={amendment.changes
                  .map(
                    (change) =>
                      `${text(change.baseRevisionId).slice(0, 8)} → ${text(change.candidateRevisionId).slice(0, 8)}`
                  )
                  .join(', ')}
              />
            </div>
            {amendment.changes.map((change, index) => (
              <div className="semantic-diff-block" key={text(change.id, String(index))}>
                <strong>
                  {text(change.assetType)} · {text(change.assetId).slice(0, 12)}
                </strong>
                <pre>{pretty(record(change.diff).changedFields ?? change.diff)}</pre>
              </div>
            ))}
            <JsonSection
              title="潜在副作用与验证计划"
              value={{ impact: amendment.impact, validationPlan: amendment.validationPlan }}
            />
            {openDecisions.map((decision) => (
              <div className="semantic-approval" key={text(decision.id)}>
                <ShieldAlert aria-hidden="true" />
                <div>
                  <strong>{text(decision.question, '范围扩展需要人工审批')}</strong>
                  <p>{pretty(decision.impact)}</p>
                </div>
                <div className="semantic-button-row">
                  <button
                    type="button"
                    disabled={busy}
                    className="is-primary"
                    onClick={() => onApprove(amendment.id, text(decision.id))}
                  >
                    <Check aria-hidden="true" />
                    批准
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRejectDecision(amendment.id, text(decision.id))}
                  >
                    <X aria-hidden="true" />
                    拒绝
                  </button>
                </div>
              </div>
            ))}
            {!check.allowed && (
              <div className="semantic-inline-warning">
                <AlertTriangle aria-hidden="true" />
                {check.reason}
              </div>
            )}
            {['candidate_ready', 'waiting_decision'].includes(amendment.state) && (
              <div className="semantic-button-row">
                <button
                  type="button"
                  className="is-primary"
                  disabled={busy || !check.allowed || openDecisions.length > 0}
                  onClick={() => onApply(amendment.id)}
                >
                  <ShieldCheck aria-hidden="true" />
                  在安全边界应用
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRejectAmendment(amendment.id)}
                >
                  <X aria-hidden="true" />
                  拒绝候选
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function EvidencePane({
  snapshot,
  busy,
  onRunDecision,
}: {
  snapshot?: RunSnapshot;
  busy: boolean;
  onRunDecision: (decisionId: string, answerKey: string) => void;
}) {
  if (!snapshot) return <Empty label="运行后将在这里显示持久化尝试、决策与证据引用" />;
  const openDecisions = snapshot.decisions.filter((decision) => text(decision.status) === 'open');
  return (
    <div className="semantic-inspector-stack">
      {openDecisions.map((decision) => (
        <article className="semantic-info-card" key={text(decision.id)}>
          <div className="semantic-card-title">
            <strong>等待人工决策</strong>
            <ShieldAlert aria-hidden="true" />
          </div>
          <p className="semantic-summary">{text(decision.question)}</p>
          <div className="semantic-button-row">
            {list(decision.options).map((rawOption, index) => {
              const option = record(rawOption);
              const key = text(option.key ?? option.answerKey, String(index));
              return (
                <button
                  type="button"
                  className={key === decision.recommendationKey ? 'is-primary' : ''}
                  disabled={busy}
                  key={key}
                  onClick={() => onRunDecision(text(decision.id), key)}
                >
                  {text(option.label ?? option.title, key)}
                </button>
              );
            })}
          </div>
        </article>
      ))}
      <InfoHeader
        eyebrow="EVIDENCE"
        title={`${snapshot.evidence.length} 条证据`}
        icon={TestTube2}
      />
      {snapshot.evidence.map((evidence, index) => (
        <article className="semantic-evidence-card" key={text(evidence.id, String(index))}>
          <FileDiff aria-hidden="true" />
          <div>
            <strong>{text(evidence.kind ?? evidence.type, '运行证据')}</strong>
            <small>{text(evidence.createdAt ?? evidence.occurredAt)}</small>
            <code>
              {text(evidence.artifactRef ?? evidence.uri ?? evidence.sha256, '持久化记录')}
            </code>
          </div>
        </article>
      ))}
      {snapshot.evidence.length === 0 && <Empty label="当前运行尚未落库证据" />}
      <JsonSection title="执行尝试" value={snapshot.attempts} />
    </div>
  );
}

function InfoHeader({
  eyebrow,
  title,
  icon: Icon,
}: {
  eyebrow: string;
  title: string;
  icon: typeof FileText;
}) {
  return (
    <div className="semantic-info-header">
      <span>
        <Icon aria-hidden="true" />
      </span>
      <div>
        <small>{eyebrow}</small>
        <h2>{title}</h2>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="semantic-field">
      <small>{label}</small>
      <span>{value}</span>
    </div>
  );
}
function Empty({ label }: { label: string }) {
  return (
    <div className="semantic-empty">
      <FileDiff aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}
function JsonSection({ title, value }: { title: string; value: unknown }) {
  return (
    <details className="semantic-json">
      <summary>{title}</summary>
      <pre>{pretty(value)}</pre>
    </details>
  );
}
