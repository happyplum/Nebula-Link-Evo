import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TestScenario, UpdateScenarioRequest } from '../../../types/scenario.js';

// --- API Functions ---

export const fetchScenario = async (projectId: string, scenarioId: string): Promise<TestScenario> => {
  const response = await fetch(`/api/projects/${projectId}/scenarios/${scenarioId}`);
  if (!response.ok) throw new Error('Failed to fetch scenario');
  return response.json();
};

export const updateScenario = async (projectId: string, scenarioId: string, data: UpdateScenarioRequest): Promise<TestScenario> => {
  const response = await fetch(`/api/projects/${projectId}/scenarios/${scenarioId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to update scenario');
  return response.json();
};

export const fetchModuleScenarios = async (projectId: string, moduleId: string): Promise<TestScenario[]> => {
  const response = await fetch(`/api/projects/${projectId}/modules/${moduleId}/scenarios`);
  if (!response.ok) throw new Error('Failed to fetch module scenarios');
  const data = await response.json();
  return data.scenarios || [];
};

export const generateAllScenarios = async (projectId: string): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}/scenarios/generate-all`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to generate all scenarios');
};

export const generateModuleScenarios = async (projectId: string, moduleId: string): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}/scenarios/modules/${moduleId}`, {
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

export const useScenario = (projectId: string, scenarioId: string) => {
  return useQuery({
    queryKey: scenarioKeys.detail(projectId, scenarioId),
    queryFn: () => fetchScenario(projectId, scenarioId),
    enabled: !!projectId && !!scenarioId,
  });
};

export const useModuleScenarios = (projectId: string, moduleId: string) => {
  return useQuery({
    queryKey: scenarioKeys.module(projectId, moduleId),
    queryFn: () => fetchModuleScenarios(projectId, moduleId),
    enabled: !!projectId && !!moduleId,
  });
};

export const useUpdateScenario = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ scenarioId, data }: { scenarioId: string; data: UpdateScenarioRequest }) => 
      updateScenario(projectId, scenarioId, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: scenarioKeys.detail(projectId, variables.scenarioId) });
      queryClient.invalidateQueries({ queryKey: scenarioKeys.module(projectId, data.functional_module_id) });
    },
  });
};

export const useGenerateAllScenarios = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => generateAllScenarios(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scenarioKeys.all(projectId) });
    },
  });
};

export const useGenerateModuleScenarios = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (moduleId: string) => generateModuleScenarios(projectId, moduleId),
    onSuccess: (_data, moduleId) => {
      queryClient.invalidateQueries({ queryKey: scenarioKeys.module(projectId, moduleId) });
    },
  });
};
