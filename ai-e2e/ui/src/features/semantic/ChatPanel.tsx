import { Bot, ChevronDown, ChevronUp, LockKeyhole, Send, Sparkles, UserRound } from 'lucide-react';
import { useState } from 'react';
import { record, text } from './types.js';

export function ChatPanel({
  collapsed,
  busy,
  scope,
  messages,
  onToggle,
  onSend,
}: {
  collapsed: boolean;
  busy: boolean;
  scope: { version: string; url: string; module: string; revision: string };
  messages: Array<Record<string, unknown>>;
  onToggle: () => void;
  onSend: (message: string) => void;
}) {
  const [message, setMessage] = useState('');
  const submit = () => {
    const normalized = message.trim();
    if (!normalized || busy) return;
    onSend(normalized);
    setMessage('');
  };

  return (
    <section
      className={`semantic-chat${collapsed ? ' is-collapsed' : ''}`}
      aria-label="结构化编排 Chat"
    >
      <header>
        <div>
          <Bot aria-hidden="true" />
          <span>
            <strong>编排 Agent</strong>
            <small>{busy ? '正在处理结构化候选…' : '作用域已锁定'}</small>
          </span>
        </div>
        <button type="button" onClick={onToggle} aria-label={collapsed ? '展开 Chat' : '折叠 Chat'}>
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
          <div className="semantic-chat-messages" aria-live="polite">
            {messages.length === 0 && (
              <div className="semantic-chat-empty">
                <Sparkles aria-hidden="true" />
                <p>
                  描述希望修改的需求、脚本或场景顺序。Agent
                  会先生成结构化候选，不会直接覆盖当前资产。
                </p>
              </div>
            )}
            {messages.map((raw, index) => {
              const item = record(raw);
              const role = text(item.role, 'assistant');
              return (
                <article className={`is-${role}`} key={text(item.id, String(index))}>
                  {role === 'user' ? <UserRound aria-hidden="true" /> : <Bot aria-hidden="true" />}
                  <div>
                    <small>{role === 'user' ? '你' : 'Agent'}</small>
                    <p>{text(item.content)}</p>
                  </div>
                </article>
              );
            })}
            {busy && (
              <article className="is-assistant is-thinking">
                <Bot aria-hidden="true" />
                <div>
                  <small>Agent</small>
                  <p>正在分析浏览器证据与冻结修订…</p>
                </div>
              </article>
            )}
          </div>
          <div className="semantic-chat-composer">
            <textarea
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
        </>
      )}
    </section>
  );
}
