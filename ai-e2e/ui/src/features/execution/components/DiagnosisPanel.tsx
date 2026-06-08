import React, { useState } from 'react';
import { Card, Button, CodeEditor } from '@/shared/components';
import { ExecutionRun, useApproveFix, useRejectFix, useDiagnosis } from '../store/executionApi';

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
        <div className="flex items-center justify-center py-8 text-text-muted text-sm">正在生成诊断报告...</div>
      </Card>
    );
  }

  if (!diagnosis || !diagnosis.logs || diagnosis.logs.length === 0) {
    return (
      <Card title="AI 诊断">
        <div className="flex items-center justify-center py-8 text-text-muted text-sm">暂无诊断信息</div>
      </Card>
    );
  }

  const isActionable = run.status === 'failed';
  const latestLog = diagnosis.logs[diagnosis.logs.length - 1];

  return (
    <Card title="AI 诊断报告">
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium mb-2">诊断记录</h3>
          {diagnosis.logs.map((log, index) => (
            <div key={log.id} className="bg-surface-content rounded-md p-3 text-sm mb-2">
              <div className="text-xs text-text-muted mb-1">
                #{index + 1} — {log.action_taken || '未知操作'} ({new Date(log.created_at).toLocaleString()})
              </div>
              {log.diagnosis && <div>{log.diagnosis}</div>}
            </div>
          ))}
        </div>

        {isActionable && latestLog?.action_taken === 'pending_human_review' && (
          <div className="flex gap-2">
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
