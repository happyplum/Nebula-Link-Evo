import React from 'react';
import { ModuleBinding } from '../store/explorationApi';
import { Table, Column, Button } from '@/shared/components';
import { cn } from '@/lib/utils';

interface BindingEditorProps {
  bindings: ModuleBinding[];
  onProposeBindings: () => void;
  onConfirmBinding: (bindingId: string) => void;
  onRejectBinding: (bindingId: string) => void;
  isProposing: boolean;
}

const confidenceClassMap: Record<string, string> = {
  high: 'text-status-success',
  medium: 'text-status-warning',
  low: 'text-status-error',
};

const statusClassMap: Record<string, string> = {
  proposed: 'text-text-muted',
  confirmed: 'text-status-success',
  rejected: 'text-status-error',
};

const statusTextMap: Record<string, string> = {
  proposed: '待确认',
  confirmed: '已确认',
  rejected: '已拒绝',
};

function getConfidenceKey(confidence: number): string {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}

export const BindingEditor: React.FC<BindingEditorProps> = ({
  bindings,
  onProposeBindings,
  onConfirmBinding,
  onRejectBinding,
  isProposing,
}) => {
  const columns: Column<ModuleBinding>[] = [
    {
      key: 'url',
      title: 'URL',
      render: (_, record) => (
        <div title={record.url?.url}>
          {record.url?.title || record.url?.url || '未知 URL'}
        </div>
      ),
    },
    {
      key: 'module',
      title: '绑定模块',
      render: (_, record) => record.module?.name || '未知模块',
    },
    {
      key: 'confidence',
      title: '置信度',
      render: (_, record) => (
        <span className={confidenceClassMap[getConfidenceKey(record.confidence)]}>
          {Math.round(record.confidence * 100)}%
        </span>
      ),
      width: '100px',
    },
    {
      key: 'status',
      title: '状态',
      render: (_, record) => (
        <span className={statusClassMap[record.status] ?? ''}>
          {statusTextMap[record.status] ?? record.status}
        </span>
      ),
      width: '100px',
    },
    {
      key: 'actions',
      title: '操作',
      render: (_, record) => (
        <div className="flex gap-1">
          {(record.status === 'proposed' || record.status === 'rejected') && (
            <Button 
              variant="primary" 
              size="sm" 
              onClick={() => onConfirmBinding(record.id)}
            >
              确认
            </Button>
          )}
          {(record.status === 'proposed' || record.status === 'confirmed') && (
            <Button 
              variant="danger" 
              size="sm" 
              onClick={() => onRejectBinding(record.id)}
            >
              拒绝
            </Button>
          )}
        </div>
      ),
      width: '150px',
    },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3">
        <div className="text-sm font-medium">URL 模块绑定</div>
        <div className="flex gap-2">
          <Button 
            variant="secondary" 
            onClick={onProposeBindings}
            isLoading={isProposing}
          >
            AI 智能绑定
          </Button>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto">
        <Table
          columns={columns}
          data={bindings}
          rowKey="id"
          emptyText="暂无绑定建议，请点击「AI 智能绑定」生成"
        />
      </div>
    </div>
  );
};
