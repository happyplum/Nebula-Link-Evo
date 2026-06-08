import React, { useState } from 'react';
import { Card, Button, Modal, CodeEditor } from '@/shared/components';
import { ExecutionRun, useApproveFix, useRejectFix, useDiagnosis } from '../store/executionApi';
import styles from './DiagnosisPanel.module.css';

interface DiagnosisPanelProps {
  projectId: string;
  run: ExecutionRun;
}

export const DiagnosisPanel: React.FC<DiagnosisPanelProps> = ({
  projectId,
  run,
}) => {
  const { data: diagnosis, isLoading } = useDiagnosis(projectId, run.id);
  const { mutate: approveFix, isPending: isApproving } = useApproveFix(projectId);
  const { mutate: rejectFix, isPending: isRejecting } = useRejectFix(projectId);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  if (isLoading) {
    return (
      <Card title="AI 诊断">
        <div className={styles.emptyState}>正在生成诊断报告...</div>
      </Card>
    );
  }

  if (!diagnosis || !diagnosis.logs || diagnosis.logs.length === 0) {
    return (
      <Card title="AI 诊断">
        <div className={styles.emptyState}>暂无诊断信息</div>
      </Card>
    );
  }

  const isActionable = run.status === 'failed';
  const latestLog = diagnosis.logs[diagnosis.logs.length - 1];

  return (
    <Card title="AI 诊断报告">
      <div className={styles.container}>
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>诊断记录</h3>
          {diagnosis.logs.map((log, index) => (
            <div key={log.id} className={styles.analysisBox} style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '0.85em', color: '#888', marginBottom: '4px' }}>
                #{index + 1} — {log.action_taken || '未知操作'} ({new Date(log.created_at).toLocaleString()})
              </div>
              {log.diagnosis && <div>{log.diagnosis}</div>}
            </div>
          ))}
        </div>

        {isActionable && latestLog?.action_taken === 'pending_human_review' && (
          <div className={styles.actions}>
            <Button 
              variant="primary" 
              onClick={() => approveFix(run.id)}
              isLoading={isApproving}
              disabled={isRejecting}
            >
              采纳修复
            </Button>
            <Button 
              variant="secondary" 
              onClick={() => rejectFix(run.id)}
              isLoading={isRejecting}
              disabled={isApproving}
            >
              拒绝修复
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
};
