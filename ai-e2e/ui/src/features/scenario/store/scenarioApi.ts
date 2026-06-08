import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TestScenario, UpdateScenarioRequest } from '../../../types/scenario.js';
import { analysisKeys } from '../../analysis/store/analysisApi.js';

// --- API Functions ---

export const updateScenario = async (projectId: string, scenarioId: string, data: UpdateScenarioRequest): Promise<TestScenario> => {
  const response = await fetch(`/api/projects/${projectId}/scenarios/${scenarioId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to update scenario');
  return response.json();
};

export const generateAllScenarios = async (projectId: string): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}/analysis/generate-all-scenarios`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to generate all scenarios');
};

export const generateModuleScenarios = async (projectId: string, moduleId: string): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}/analysis/modules/${moduleId}/generate-scenarios`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to generate module scenarios');
};

// --- React Query Hooks ---

export const scenarioKeys = {
  all: (projectId: string) => ['scenarios', projectId] as const,
  module: (projectId: string, moduleId: string) => [...scenarioKeys.all(projectId), 'module', moduleId] as const,
  detail: (projectId: string, scenarioId: string) => [...scenarioKeys.all(projectId), 'detail', scenarioId] as const,
};

export const useUpdateScenario = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ scenarioId, data }: { scenarioId: string; data: UpdateScenarioRequest }) => 
      updateScenario(projectId, scenarioId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analysisKeys.modules(projectId) });
    },
  });
};

export const useGenerateAllScenarios = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => generateAllScenarios(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analysisKeys.modules(projectId) });
    },
  });
};

export const useGenerateModuleScenarios = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (moduleId: string) => generateModuleScenarios(projectId, moduleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analysisKeys.modules(projectId) });
    },
  });
};
