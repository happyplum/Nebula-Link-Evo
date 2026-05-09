import React from 'react';
import { ModuleBinding } from '../store/explorationApi';
import { Table, Column, Button } from '@/shared/components';
import styles from './BindingEditor.module.css';

interface BindingEditorProps {
  bindings: ModuleBinding[];
  onProposeBindings: () => void;
  onConfirmBinding: (bindingId: string) => void;
  onRejectBinding: (bindingId: string) => void;
  isProposing: boolean;
}

export const BindingEditor: React.FC<BindingEditorProps> = ({
  bindings,
  onProposeBindings,
  onConfirmBinding,
  onRejectBinding,
  isProposing,
}) => {
  const getConfidenceClass = (confidence: number) => {
    if (confidence >= 0.8) return styles.confidenceHigh;
    if (confidence >= 0.5) return styles.confidenceMedium;
    return styles.confidenceLow;
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'proposed': return <span className={styles.statusProposed}>待确认</span>;
      case 'confirmed': return <span className={styles.statusConfirmed}>已确认</span>;
      case 'rejected': return <span className={styles.statusRejected}>已拒绝</span>;
      default: return status;
    }
  };

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
        <span className={getConfidenceClass(record.confidence)}>
          {Math.round(record.confidence * 100)}%
        </span>
      ),
      width: '100px',
    },
    {
      key: 'status',
      title: '状态',
      render: (_, record) => getStatusText(record.status),
      width: '100px',
    },
    {
      key: 'actions',
      title: '操作',
      render: (_, record) => (
        <div className={styles.actionButtons}>
          {record.status === 'proposed' && (
            <>
              <Button 
                variant="primary" 
                size="sm" 
                onClick={() => onConfirmBinding(record.id)}
              >
                确认
              </Button>
              <Button 
                variant="danger" 
                size="sm" 
                onClick={() => onRejectBinding(record.id)}
              >
                拒绝
              </Button>
            </>
          )}
        </div>
      ),
      width: '150px',
    },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.title}>URL 模块绑定</div>
        <div className={styles.actions}>
          <Button 
            variant="secondary" 
            onClick={onProposeBindings}
            isLoading={isProposing}
          >
            AI 智能绑定
          </Button>
        </div>
      </div>
      
      <div className={styles.tableContainer}>
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
