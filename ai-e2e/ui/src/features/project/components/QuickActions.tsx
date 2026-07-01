import React from 'react';
import { Plus, FileText, MessageSquare } from 'lucide-react';

interface QuickActionsProps {
  onCreateProject: () => void;
}

export const QuickActions: React.FC<QuickActionsProps> = ({ onCreateProject }) => (
  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
    <button
      type="button"
      onClick={onCreateProject}
      className="flex flex-col items-start gap-2 rounded-lg border border-border-default bg-surface-elevated p-4 text-left transition-colors hover:border-border-hover"
    >
      <Plus size={20} className="text-status-info" />
      <span className="font-medium text-text-primary">新建测试项目</span>
      <span className="text-xs text-text-secondary">从目标 URL 开始构建 E2E 测试</span>
    </button>
    <button
      type="button"
      onClick={onCreateProject}
      className="flex flex-col items-start gap-2 rounded-lg border border-border-default bg-surface-elevated p-4 text-left transition-colors hover:border-border-hover"
    >
      <MessageSquare size={20} className="text-status-info" />
      <span className="font-medium text-text-primary">用一句话创建</span>
      <span className="text-xs text-text-secondary">描述功能，让 Agent 自动生成测试</span>
    </button>
    <button
      type="button"
      className="flex flex-col items-start gap-2 rounded-lg border border-border-default bg-surface-elevated p-4 text-left transition-colors hover:border-border-hover"
    >
      <FileText size={20} className="text-status-info" />
      <span className="font-medium text-text-primary">查看报告</span>
      <span className="text-xs text-text-secondary">浏览最近执行结果与失败分析</span>
    </button>
  </div>
);
