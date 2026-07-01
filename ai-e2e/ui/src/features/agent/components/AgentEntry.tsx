import { useParams } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button.js';
import { useAgentWorkflow } from '../hooks/useAgentWorkflow.js';
import { useAgentStore } from '../store/agentStore.js';
import { AgentChat } from './AgentChat.js';

/**
 * AgentEntry — 全局 AI 助手入口（Phase B）。
 *
 * 仅在 `/project/:projectId` 路由下渲染；首页等无 projectId 的路由返回 null。
 * 关闭时渲染右下角浮动按钮；打开时渲染 AgentChat 面板。
 */
export function AgentEntry() {
  const { projectId } = useParams<{ projectId: string }>();
  const { isOpen, setOpen } = useAgentStore();
  const { send, isRunning } = useAgentWorkflow(projectId ?? '');

  if (!projectId) return null;
  if (isOpen) return <AgentChat onSend={send} isRunning={isRunning} />;

  return (
    <Button
      aria-label="打开 AI 测试助手"
      className="fixed bottom-6 right-6 z-50 h-12 w-12 rounded-full p-0 shadow-lg"
      onClick={() => setOpen(true)}
    >
      <MessageSquare size={20} />
    </Button>
  );
}
