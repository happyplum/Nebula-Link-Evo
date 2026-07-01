import { useParams } from 'react-router-dom';
import { Sparkles } from 'lucide-react';

export interface AgentEntryProps {
  onClick?: () => void;
}

/**
 * AgentEntry — 全局 AI 助手入口占位（Phase A）。
 *
 * 仅在 `/project/:projectId` 路由下渲染；首页等无 projectId 的路由返回 null。
 * 当前不连接任何 Phase B 逻辑（无 API、无 SSE），点击仅记录占位日志或调用传入的 onClick。
 */
export function AgentEntry({ onClick }: AgentEntryProps) {
  const { projectId } = useParams<{ projectId: string }>();

  if (!projectId) {
    return null;
  }

  const handleClick = () => {
    if (onClick) {
      onClick();
      return;
    }
    // Phase B placeholder — no real agent logic wired yet.
    console.info('[AgentEntry] AI 助手入口已点击（占位，Phase B 尚未接入）');
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-border-default bg-surface-elevated px-3 py-1.5 text-[13px] font-medium text-text-primary transition-colors hover:border-border-hover hover:bg-surface-panel focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-status-info"
      aria-label="AI 助手"
      title="AI 助手（即将推出）"
    >
      <Sparkles size={14} className="text-status-info" aria-hidden="true" />
      <span>AI 助手</span>
    </button>
  );
}
