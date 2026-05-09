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

  if (!diagnosis) {
    return (
      <Card title="AI 诊断">
        <div className={styles.emptyState}>暂无诊断信息</div>
      </Card>
    );
  }

  const isLowConfidence = diagnosis.confidence < 30;
  const isActionable = run.status === 'failed';

  const handleApprove = () => {
    if (isLowConfidence) {
      setShowConfirmModal(true);
    } else {
      approveFix(run.id);
    }
  };

  const handleConfirmApprove = () => {
    setShowConfirmModal(false);
    approveFix(run.id);
  };

  const handleReject = () => {
    rejectFix(run.id);
  };

  return (
    <Card title="AI 诊断报告">
      <div className={styles.container}>
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>错误分析</h3>
          <div className={styles.analysisBox}>{diagnosis.error_analysis}</div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>修复建议</h3>
          <div className={styles.analysisBox}>{diagnosis.suggested_fix}</div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>推理过程</h3>
          <div className={styles.analysisBox}>{diagnosis.reasoning}</div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>代码变更 (Diff)</h3>
          <CodeEditor
            value={diagnosis.fix_diff}
            readOnly
            language="diff"
            rows={10}
          />
        </div>

        <div className={`${styles.confidenceBox} ${isLowConfidence ? styles.low : styles.high}`}>
          置信度: {diagnosis.confidence}%
          {isLowConfidence && ' (置信度较低，请仔细确认)'}
        </div>

        {isActionable && (
          <div className={styles.actions}>
            <Button 
              variant="primary" 
              onClick={handleApprove}
              isLoading={isApproving}
              disabled={isRejecting}
            >
              采纳修复
            </Button>
            <Button 
              variant="secondary" 
              onClick={handleReject}
              isLoading={isRejecting}
              disabled={isApproving}
            >
              拒绝修复
            </Button>
          </div>
        )}
      </div>

      <Modal
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        title="低置信度警告"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowConfirmModal(false)}>取消</Button>
            <Button variant="danger" onClick={handleConfirmApprove}>确认采纳</Button>
          </>
        }
      >
        <div className={styles.warningText}>
          当前 AI 修复建议的置信度低于 30% ({diagnosis.confidence}%)。
          采纳此修复可能会导致意外行为，请确认您已仔细检查了代码变更。
        </div>
        <p>是否确认采纳此修复？</p>
      </Modal>
    </Card>
  );
};
