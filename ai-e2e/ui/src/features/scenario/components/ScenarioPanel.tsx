import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Button } from '@/shared/components';
import { useModuleScenarios, useUpdateScenario, useGenerateAllScenarios, useGenerateModuleScenarios } from '../store/scenarioApi.js';
import { ScenarioEditor } from './ScenarioEditor.js';
import { TestScenario, UpdateScenarioRequest } from '../../../types/scenario.js';

export interface ScenarioPanelProps {
  functionalModuleId: string;
}

export const ScenarioPanel: React.FC<ScenarioPanelProps> = ({ functionalModuleId }) => {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: scenarios, isLoading, error } = useModuleScenarios(projectId!, functionalModuleId);
  const updateScenarioMutation = useUpdateScenario(projectId!);
  const generateAllScenarios = useGenerateAllScenarios(projectId!);
  const generateModuleScenarios = useGenerateModuleScenarios(projectId!);

  const [editingScenario, setEditingScenario] = useState<TestScenario | null>(null);

  if (isLoading) {
    return <div className="flex items-center justify-center py-8">加载中...</div>;
  }

  if (error) {
    return <div className="flex items-center justify-center py-8 text-text-muted">加载测试场景失败</div>;
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
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-medium">测试场景</h3>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => generateAllScenarios.mutate()}
          disabled={generateAllScenarios.isPending}
        >
          {generateAllScenarios.isPending ? '生成中...' : '批量生成场景'}
        </Button>
      </div>

      <div className="space-y-3">
        {scenarios && scenarios.length > 0 ? (
          scenarios.map((scenario) => (
            <Card key={scenario.id} className="bg-surface-content border border-border-default rounded-md p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium">{scenario.name}</h4>
                <Button variant="ghost" size="sm" onClick={() => setEditingScenario(scenario)}>
                  编辑
                </Button>
              </div>
              
              {scenario.description && (
                <p className="text-xs text-text-muted">{scenario.description}</p>
              )}

              {scenario.preconditions && scenario.preconditions.length > 0 && (
                <div className="mt-3">
                  <h5 className="text-xs font-medium text-text-secondary mb-1">前置条件</h5>
                  <ul className="space-y-1">
                    {scenario.preconditions.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}

              {scenario.expected_results && scenario.expected_results.length > 0 && (
                <div className="mt-3">
                  <h5 className="text-xs font-medium text-text-secondary mb-1">预期结果</h5>
                  <ul className="space-y-1">
                    {scenario.expected_results.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          ))
        ) : (
          <div className="flex items-center justify-center py-8 text-text-muted text-sm">暂无测试场景</div>
        )}
      </div>

      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => generateModuleScenarios.mutate(functionalModuleId)}
          disabled={generateModuleScenarios.isPending}
        >
          {generateModuleScenarios.isPending ? '生成中...' : '生成场景'}
        </Button>
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
