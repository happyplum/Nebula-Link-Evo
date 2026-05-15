import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Button } from '@/shared/components';
import { useModuleScenarios, useUpdateScenario } from '../store/scenarioApi.js';
import { ScenarioEditor } from './ScenarioEditor.js';
import { TestScenario, UpdateScenarioRequest } from '../../../types/scenario.js';
import styles from './ScenarioPanel.module.css';

export interface ScenarioPanelProps {
  functionalModuleId: string;
}

export const ScenarioPanel: React.FC<ScenarioPanelProps> = ({ functionalModuleId }) => {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: scenarios, isLoading, error } = useModuleScenarios(projectId!, functionalModuleId);
  const updateScenarioMutation = useUpdateScenario(projectId!);

  const [editingScenario, setEditingScenario] = useState<TestScenario | null>(null);

  if (isLoading) {
    return <div className={styles.loading}>加载中...</div>;
  }

  if (error) {
    return <div className={styles.error}>加载测试场景失败</div>;
  }

  const handleSave = (data: UpdateScenarioRequest) => {
    if (!editingScenario) return;
    updateScenarioMutation.mutate(
      { scenarioId: editingScenario.id, data },
      {
        onSuccess: () => {
          setEditingScenario(null);
        },
      }
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>测试场景</h3>
      </div>

      <div className={styles.list}>
        {scenarios && scenarios.length > 0 ? (
          scenarios.map((scenario) => (
            <Card key={scenario.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <h4 className={styles.scenarioName}>{scenario.name}</h4>
                <Button variant="ghost" size="sm" onClick={() => setEditingScenario(scenario)}>
                  编辑
                </Button>
              </div>
              
              {scenario.description && (
                <p className={styles.description}>{scenario.description}</p>
              )}

              {scenario.preconditions && scenario.preconditions.length > 0 && (
                <div className={styles.section}>
                  <h5 className={styles.sectionTitle}>前置条件</h5>
                  <ul className={styles.sectionList}>
                    {scenario.preconditions.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}

              {scenario.expected_results && scenario.expected_results.length > 0 && (
                <div className={styles.section}>
                  <h5 className={styles.sectionTitle}>预期结果</h5>
                  <ul className={styles.sectionList}>
                    {scenario.expected_results.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          ))
        ) : (
          <div className={styles.emptyState}>暂无测试场景</div>
        )}
      </div>

      <ScenarioEditor
        isOpen={!!editingScenario}
        scenario={editingScenario}
        onClose={() => setEditingScenario(null)}
        onSave={handleSave}
        isSaving={updateScenarioMutation.isPending}
      />
    </div>
  );
};