import React, { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Button } from '@/shared/components';
import { useModules, type FunctionalModule, type TestScenario } from '../../analysis/store/analysisApi.js';
import { useUpdateScenario, useGenerateAllScenarios, useGenerateModuleScenarios } from '../store/scenarioApi.js';
import { ScenarioEditor } from './ScenarioEditor.js';
import { UpdateScenarioRequest } from '../../../types/scenario.js';

export const ScenarioPanel: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: modules, isLoading, error } = useModules(projectId!);
  const updateScenarioMutation = useUpdateScenario(projectId!);
  const generateAllScenarios = useGenerateAllScenarios(projectId!);
  const generateModuleScenarios = useGenerateModuleScenarios(projectId!);

  const [editingScenario, setEditingScenario] = useState<TestScenario | null>(null);

  // Flatten all functional modules with their scenarios from the module tree
  const functionalModules = useMemo(() => {
    if (!modules) return [];
    const result: FunctionalModule[] = [];
    for (const bm of modules) {
      if (bm.children) {
        for (const fm of bm.children) {
          result.push(fm);
        }
      }
    }
    return result;
  }, [modules]);

  const totalScenarios = useMemo(
    () => functionalModules.reduce((sum, fm) => sum + (fm.test_scenarios?.length || 0), 0),
    [functionalModules]
  );

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
        <div>
          <h3 className="text-base font-medium">测试场景</h3>
          <p className="text-xs text-text-muted mt-1">
            共 {functionalModules.length} 个功能模块，{totalScenarios} 个测试场景
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => generateAllScenarios.mutate()}
          disabled={generateAllScenarios.isPending}
        >
          {generateAllScenarios.isPending ? '生成中...' : '批量生成场景'}
        </Button>
      </div>

      {functionalModules.length > 0 ? (
        <div className="space-y-6">
          {functionalModules.map((fm) => (
            <div key={fm.id}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-medium">{fm.name}</h4>
                  <span className="text-xs text-text-muted">
                    ({fm.test_scenarios?.length || 0} 个场景)
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => generateModuleScenarios.mutate(fm.id)}
                  disabled={generateModuleScenarios.isPending}
                >
                  {generateModuleScenarios.isPending ? '生成中...' : '生成场景'}
                </Button>
              </div>

              <div className="space-y-2">
                {fm.test_scenarios && fm.test_scenarios.length > 0 ? (
                  fm.test_scenarios.map((scenario) => (
                    <Card key={scenario.id} className="bg-surface-content border border-border-default rounded-md p-3">
                      <div className="flex items-center justify-between mb-1">
                        <h5 className="text-sm font-medium">{scenario.name}</h5>
                        <Button variant="ghost" size="sm" onClick={() => setEditingScenario(scenario)}>
                          编辑
                        </Button>
                      </div>

                      {scenario.description && (
                        <p className="text-xs text-text-muted">{scenario.description}</p>
                      )}

                      {scenario.preconditions && scenario.preconditions.length > 0 && (
                        <div className="mt-2">
                          <h6 className="text-xs font-medium text-text-secondary mb-1">前置条件</h6>
                          <ul className="text-xs text-text-muted space-y-0.5">
                            {scenario.preconditions.map((p, i) => (
                              <li key={i}>{p}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {scenario.expected_results && scenario.expected_results.length > 0 && (
                        <div className="mt-2">
                          <h6 className="text-xs font-medium text-text-secondary mb-1">预期结果</h6>
                          <ul className="text-xs text-text-muted space-y-0.5">
                            {scenario.expected_results.map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </Card>
                  ))
                ) : (
                  <div className="text-xs text-text-muted py-2 pl-2">暂无测试场景</div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center py-8 text-text-muted text-sm">暂无功能模块数据</div>
      )}

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
