import React, { useState, useEffect } from 'react';
import { Button, Input, Modal } from '@/shared/components';
import { TestScenario, UpdateScenarioRequest } from '../../../types/scenario.js';

export interface ScenarioEditorProps {
  isOpen: boolean;
  scenario: TestScenario | null;
  onClose: () => void;
  onSave: (data: UpdateScenarioRequest) => void;
  isSaving?: boolean;
}

export const ScenarioEditor: React.FC<ScenarioEditorProps> = ({
  isOpen,
  scenario,
  onClose,
  onSave,
  isSaving = false,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [preconditions, setPreconditions] = useState<string[]>([]);
  const [expectedResults, setExpectedResults] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen && scenario) {
      setName(scenario.name);
      setDescription(scenario.description || '');
      setPreconditions(scenario.preconditions || []);
      setExpectedResults(scenario.expected_results || []);
    }
  }, [isOpen, scenario]);

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      name,
      description,
      preconditions: preconditions.filter(p => p.trim() !== ''),
      expected_results: expectedResults.filter(r => r.trim() !== ''),
    });
  };

  const handleArrayChange = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    index: number,
    value: string
  ) => {
    setter(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleArrayAdd = (setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    setter(prev => [...prev, '']);
  };

  const handleArrayRemove = (
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    index: number
  ) => {
    setter(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="编辑测试场景"
    >
      <div className="space-y-4">
        <Input
          label="场景名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
          autoFocus
        />
        <Input
          label="描述"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          fullWidth
        />
        
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">前置条件</span>
            <Button variant="ghost" size="sm" onClick={() => handleArrayAdd(setPreconditions)}>
              + 添加
            </Button>
          </div>
          {preconditions.map((p, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input
                value={p}
                onChange={(e) => handleArrayChange(setPreconditions, i, e.target.value)}
                fullWidth
              />
              <Button variant="ghost" size="sm" onClick={() => handleArrayRemove(setPreconditions, i)}>
                删除
              </Button>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">预期结果</span>
            <Button variant="ghost" size="sm" onClick={() => handleArrayAdd(setExpectedResults)}>
              + 添加
            </Button>
          </div>
          {expectedResults.map((r, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input
                value={r}
                onChange={(e) => handleArrayChange(setExpectedResults, i, e.target.value)}
                fullWidth
              />
              <Button variant="ghost" size="sm" onClick={() => handleArrayRemove(setExpectedResults, i)}>
                删除
              </Button>
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" onClick={onClose} disabled={isSaving}>
          取消
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={!name.trim() || isSaving}>
          {isSaving ? '保存中...' : '保存'}
        </Button>
      </div>
    </Modal>
  );
};
