import type { AgentStreamSectionV1, AgentStreamSnapshotV1 } from '@nebula-link-evo/shared';
import type { ReactNode } from 'react';

export interface AgentStreamRendererSlots {
  renderMarkdown?: (markdown: string) => ReactNode;
  renderDecisionAction?: (
    section: Extract<AgentStreamSectionV1, { type: 'decision' }>
  ) => ReactNode;
  renderArtifact?: (
    reference: string,
    section: Extract<AgentStreamSectionV1, { type: 'activity' | 'media' | 'file' }>
  ) => ReactNode;
}

export interface AgentStreamRendererProps {
  snapshot: AgentStreamSnapshotV1;
  density?: 'compact' | 'comfortable';
  className?: string;
  emptyLabel?: string;
  slots?: AgentStreamRendererSlots;
}

const stateLabels: Record<string, string> = {
  queued: '排队中',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  blocked: '等待处理',
  cancelled: '已取消',
  skipped: '已跳过',
  outcome_unknown: '结果未知',
  waiting: '等待决策',
  approved: '已允许',
  rejected: '已拒绝',
  expired: '已过期',
};

const activityLabels: Record<string, string> = {
  skill: 'Skill',
  tool: '工具',
  browser: '浏览器',
  agent: 'Agent',
  evidence: '证据',
  read: '读取',
  search: '搜索',
  edit: '编辑',
  command: '命令',
  mcp: 'MCP',
};

function Markdown({ value, slots }: { value: string; slots?: AgentStreamRendererSlots }) {
  return slots?.renderMarkdown ? (
    slots.renderMarkdown(value)
  ) : (
    <div className="nebula-agent-stream__plain-text">{value}</div>
  );
}

function ActivityCard({
  section,
  slots,
}: {
  section: Extract<AgentStreamSectionV1, { type: 'activity' }>;
  slots?: AgentStreamRendererSlots;
}) {
  return (
    <article
      className="nebula-agent-stream__activity"
      data-state={section.state}
      aria-label={`${activityLabels[section.kind]}：${section.title}，${stateLabels[section.state]}`}
    >
      <div className="nebula-agent-stream__activity-heading">
        <span className="nebula-agent-stream__kind">{activityLabels[section.kind]}</span>
        <strong>{section.title}</strong>
        <span className="nebula-agent-stream__status">{stateLabels[section.state]}</span>
      </div>
      {section.summary ? <p>{section.summary}</p> : null}
      {section.version || section.contentHash ? (
        <div className="nebula-agent-stream__metadata">
          {section.version ? <span>版本 {section.version}</span> : null}
          {section.contentHash ? <span>哈希 {section.contentHash}</span> : null}
        </div>
      ) : null}
      {section.artifactRefs?.map((reference) => (
        <div className="nebula-agent-stream__artifact" key={reference}>
          {slots?.renderArtifact?.(reference, section) ?? reference}
        </div>
      ))}
    </article>
  );
}

function ActivityGroup({
  sections,
  slots,
  grouped = false,
}: {
  sections: Array<Extract<AgentStreamSectionV1, { type: 'activity' }>>;
  slots?: AgentStreamRendererSlots;
  grouped?: boolean;
}) {
  if (sections.length === 1 && !grouped) {
    return <ActivityCard section={sections[0]} slots={slots} />;
  }
  const activeCount = sections.filter((section) => section.state === 'running').length;
  const failedCount = sections.filter((section) => section.state === 'failed').length;
  const summary = activeCount
    ? `${activeCount} 项进行中`
    : failedCount
      ? `${failedCount} 项失败`
      : `${sections.length} 项活动`;
  return (
    <details
      className="nebula-agent-stream__activity-group"
      open={activeCount > 0 || failedCount > 0}
    >
      <summary>
        <span>Agent 活动</span>
        <span className="nebula-agent-stream__status">{summary}</span>
      </summary>
      <div className="nebula-agent-stream__activity-list">
        {sections.map((section) => (
          <ActivityCard key={section.sectionId} section={section} slots={slots} />
        ))}
      </div>
    </details>
  );
}

function Section({
  section,
  slots,
}: {
  section: Exclude<AgentStreamSectionV1, { type: 'activity' }>;
  slots?: AgentStreamRendererSlots;
}) {
  switch (section.type) {
    case 'user':
    case 'content':
      return (
        <div
          className={`nebula-agent-stream__content nebula-agent-stream__content--${section.type}`}
        >
          <Markdown value={section.markdown} slots={slots} />
          {section.streaming ? (
            <span className="nebula-agent-stream__cursor" aria-label="正在生成" />
          ) : null}
        </div>
      );
    case 'reasoning': {
      const body =
        section.visibility === 'public' && section.markdown
          ? section.markdown
          : section.visibility === 'redacted'
            ? '详细思考过程未公开。'
            : section.summary;
      return (
        <details className="nebula-agent-stream__reasoning" open={section.state === 'running'}>
          <summary>
            <span>{section.summary || '思考摘要'}</span>
            <span className="nebula-agent-stream__status">
              {section.state === 'running' ? '思考中' : stateLabels[section.state]}
            </span>
          </summary>
          <Markdown value={body} slots={slots} />
        </details>
      );
    }
    case 'plan':
      return (
        <section className="nebula-agent-stream__panel" aria-label={section.title ?? '执行计划'}>
          <strong>{section.title ?? '执行计划'}</strong>
          <ol className="nebula-agent-stream__plan">
            {section.items.map((item) => (
              <li key={item.id} data-state={item.state}>
                <span>{item.label}</span>
                <span className="nebula-agent-stream__status">{stateLabels[item.state]}</span>
              </li>
            ))}
          </ol>
        </section>
      );
    case 'decision':
      return (
        <section className="nebula-agent-stream__panel" data-tone="decision">
          <div className="nebula-agent-stream__panel-heading">
            <strong>{section.title}</strong>
            <span className="nebula-agent-stream__status">{stateLabels[section.state]}</span>
          </div>
          {section.summary ? <p>{section.summary}</p> : null}
          {section.state === 'waiting' ? slots?.renderDecisionAction?.(section) : null}
        </section>
      );
    case 'agent':
      return (
        <section className="nebula-agent-stream__panel" data-state={section.state}>
          <div className="nebula-agent-stream__panel-heading">
            <strong>{section.name}</strong>
            <span className="nebula-agent-stream__status">{stateLabels[section.state]}</span>
          </div>
          {section.summary ? <p>{section.summary}</p> : null}
        </section>
      );
    case 'media':
      return (
        <section className="nebula-agent-stream__panel">
          <strong>{section.title}</strong>
          <div className="nebula-agent-stream__artifact">
            {slots?.renderArtifact?.(section.artifactRef, section) ?? section.artifactRef}
          </div>
        </section>
      );
    case 'file':
      return (
        <section className="nebula-agent-stream__panel">
          <strong>{section.name}</strong>
          <div className="nebula-agent-stream__artifact">
            {slots?.renderArtifact?.(section.artifactRef, section) ?? section.artifactRef}
          </div>
        </section>
      );
    case 'notice':
      return (
        <aside className="nebula-agent-stream__notice" data-tone={section.tone} role="status">
          <strong>{section.title}</strong>
          {section.message ? <p>{section.message}</p> : null}
        </aside>
      );
    case 'error':
      return (
        <aside className="nebula-agent-stream__notice" data-tone="error" role="alert">
          <strong>{section.title}</strong>
          <p>{section.message}</p>
        </aside>
      );
    case 'turn-summary':
      return (
        <footer className="nebula-agent-stream__turn-summary">
          <span>{section.summary}</span>
          {section.usage?.durationMs !== undefined ? (
            <span>{Math.round(section.usage.durationMs / 100) / 10} 秒</span>
          ) : null}
        </footer>
      );
  }
}

function renderSections(sections: AgentStreamSectionV1[], slots?: AgentStreamRendererSlots) {
  const nodes: ReactNode[] = [];
  let activities: Array<Extract<AgentStreamSectionV1, { type: 'activity' }>> = [];
  const flush = () => {
    if (!activities.length) return;
    const grouped = activities.length > 1;
    for (let index = 0; index < activities.length; index += 32) {
      const group = activities.slice(index, index + 32);
      nodes.push(
        <ActivityGroup key={group[0].sectionId} sections={group} slots={slots} grouped={grouped} />
      );
    }
    activities = [];
  };

  for (const section of sections) {
    if (section.type === 'activity') {
      activities.push(section);
      continue;
    }
    flush();
    nodes.push(<Section key={section.sectionId} section={section} slots={slots} />);
  }
  flush();
  return nodes;
}

export function AgentStreamRenderer({
  snapshot,
  density = 'comfortable',
  className,
  emptyLabel = '暂无 Agent 活动',
  slots,
}: AgentStreamRendererProps) {
  if (!snapshot.turns.length) {
    return (
      <div
        className={`nebula-agent-stream nebula-agent-stream--${density}${className ? ` ${className}` : ''}`}
        data-stream-state={snapshot.state}
      >
        <p className="nebula-agent-stream__empty">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div
      className={`nebula-agent-stream nebula-agent-stream--${density}${className ? ` ${className}` : ''}`}
      data-stream-state={snapshot.state}
      aria-live="polite"
      aria-busy={snapshot.state === 'streaming'}
    >
      {snapshot.turns.map((turn) => (
        <article
          className={`nebula-agent-stream__turn nebula-agent-stream__turn--${turn.role}`}
          data-state={turn.state}
          key={turn.turnId}
        >
          {renderSections(turn.sections, slots)}
        </article>
      ))}
    </div>
  );
}
