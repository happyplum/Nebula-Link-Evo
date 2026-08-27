import { Bot, ChevronDown, ChevronUp, LockKeyhole, Send } from 'lucide-react';
import { useState } from 'react';
import { AgentStreamRenderer } from '@nebula-link-evo/agent-activity-ui';
import type { AgentStreamSnapshotV1 } from '@nebula-link-evo/shared/types/agent-stream';

export function AgentActivityPanel({
  collapsed,
  busy,
  readOnly = false,
  scope,
  snapshot,
  onToggle,
  onSend,
}: {
  collapsed: boolean;
  busy: boolean;
  readOnly?: boolean;
  scope: { version: string; url: string; module: string; revision: string };
  snapshot: AgentStreamSnapshotV1 | null;
  onToggle: () => void;
  onSend?: (message: string) => void;
}) {
  const [message, setMessage] = useState('');
  const submit = () => {
    const normalized = message.trim();
    if (!normalized || busy || readOnly || !onSend) return;
    onSend(normalized);
    setMessage('');
  };

  return (
    <section
      className={`semantic-chat${collapsed ? ' is-collapsed' : ''}`}
      aria-label={readOnly ? '运行 Agent 活动' : '结构化编排活动'}
    >
      <header>
        <div>
          <Bot aria-hidden="true" />
          <span>
            <strong>{readOnly ? '运行活动' : '编排 Agent'}</strong>
            <small>{busy ? '活动执行中…' : readOnly ? '只读活动流' : '作用域已锁定'}</small>
          </span>
        </div>
        <button type="button" onClick={onToggle} aria-label={collapsed ? '展开活动' : '折叠活动'}>
          {collapsed ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </button>
      </header>
      {!collapsed && (
        <>
          <div className="semantic-scope-lock">
            <LockKeyhole aria-hidden="true" />
            <div>
              <strong>
                {scope.version} · {scope.module}
              </strong>
              <small>{scope.url}</small>
              <code>{scope.revision.slice(0, 12)}</code>
            </div>
          </div>
          <div className="semantic-chat-messages">
            {snapshot ? (
              <AgentStreamRenderer
                snapshot={snapshot}
                density="compact"
                emptyLabel={
                  readOnly ? '运行尚未产生 Agent 活动' : '描述希望修改的需求、脚本或场景顺序'
                }
              />
            ) : (
              <p className="semantic-chat-empty">正在连接活动流…</p>
            )}
          </div>
          {!readOnly && (
            <div className="semantic-chat-composer">
              <textarea
                name="agent-amendment"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder="例如：保留异常断言，将支付失败节点移动到库存检查之后"
                aria-label="向编排 Agent 发送修改要求"
              />
              <button
                type="button"
                className="is-primary"
                disabled={busy || !message.trim()}
                onClick={submit}
                aria-label="发送修改要求"
              >
                <Send aria-hidden="true" />
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
