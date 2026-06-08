import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectKeys } from '@/features/project/store/projectApi.js';

export interface TestScenario {
  id: string;
  functional_module_id: string;
  name: string;
  description: string;
  preconditions?: string[];
  expected_results?: string[];
  source?: string;
  created_at: string;
  updated_at: string;
}

export interface FunctionalModule extends AnalysisModule {
  test_scenarios?: TestScenario[];
}

export interface AnalysisModule {
  id: string;
  name: string;
  description?: string;
  parent_id?: string;
  source?: 'ai' | 'manual';
  children?: FunctionalModule[];
}

export interface UploadPRDRequest {
  content: string;
  format?: string;
}

export interface CreateModuleRequest {
  name: string;
  description?: string;
  parent_id?: string;
}

export interface UpdateModuleRequest {
  name: string;
  description?: string;
}

export interface TransitionStateRequest {
  targetStatus: string;
}

// --- API Functions ---

export interface PRDDocument {
  id: string;
  project_id: string;
  raw_content: string;
  format: string;
  created_at: string;
}

export const fetchDocuments = async (projectId: string): Promise<PRDDocument[]> => {
  const response = await fetch(`/api/projects/${projectId}/analysis/documents`);
  if (!response.ok) throw new Error('Failed to fetch PRD documents');
  const data = await response.json();
  return Array.isArray(data) ? data : (data.documents || []);
};

export const uploadPRD = async (projectId: string, data: UploadPRDRequest): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}/analysis/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to upload PRD');
};

export const analyzePRD = async (projectId: string, content: string, format?: string): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}/analysis/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, format }),
  });
  if (!response.ok) throw new Error('Failed to start analysis');
};

export const fetchModules = async (projectId: string): Promise<AnalysisModule[]> => {
  const response = await fetch(`/api/projects/${projectId}/analysis/modules`);
  if (!response.ok) throw new Error('Failed to fetch modules');
  const data = await response.json();
  
  const businessModules = data.business_modules || [];
  return businessModules.map((bm: any) => ({
    id: bm.id,
    name: bm.name,
    description: bm.description || undefined,
    source: bm.source === 'ai_generated' ? 'ai' : 'manual',
    children: (bm.functional_modules || []).map((fm: any) => ({
      id: fm.id,
      name: fm.name,
      description: fm.description || undefined,
      parent_id: bm.id,
      source: fm.source === 'ai_generated' ? 'ai' : 'manual',
      test_scenarios: fm.test_scenarios || [],
    })),
  }));
};

export const createModule = async (projectId: string, data: CreateModuleRequest): Promise<{ id: string }> => {
  const payload = {
    ...data,
    level: data.parent_id ? 'functional' : 'business',
  };
  const response = await fetch(`/api/projects/${projectId}/analysis/modules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error('Failed to create module');
  const resData = await response.json();
  return resData.data || resData;
};

export const updateModule = async (projectId: string, moduleId: string, data: UpdateModuleRequest): Promise<{ success: boolean }> => {
  const response = await fetch(`/api/projects/${projectId}/analysis/modules/${moduleId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to update module');
  const resData = await response.json();
  return resData.data || resData;
};

export const deleteModule = async (projectId: string, moduleId: string): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}/analysis/modules/${moduleId}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete module');
};

export const decomposeAll = async (projectId: string): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}/analysis/decompose-all`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to decompose all modules');
};

export const transitionState = async (projectId: string, data: TransitionStateRequest): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}/state/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    if (errorData && errorData.error) {
      throw errorData.error;
    }
    throw new Error('Failed to transition state');
  }
};

// --- React Query Hooks ---

export const analysisKeys = {
  all: (projectId: string) => ['analysis', projectId] as const,
  modules: (projectId: string) => [...analysisKeys.all(projectId), 'modules'] as const,
  documents: (projectId: string) => [...analysisKeys.all(projectId), 'documents'] as const,
};

export const useDocuments = (projectId: string) => {
  return useQuery({
    queryKey: analysisKeys.documents(projectId),
    queryFn: () => fetchDocuments(projectId),
    enabled: !!projectId,
  });
};

export const useModules = (projectId: string) => {
  return useQuery({
    queryKey: analysisKeys.modules(projectId),
    queryFn: () => fetchModules(projectId),
    enabled: !!projectId,
  });
};

export const useUploadPRD = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UploadPRDRequest) => uploadPRD(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analysisKeys.documents(projectId) });
    },
  });
};

export const useAnalyzePRD = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ content, format }: { content: string; format?: string }) => analyzePRD(projectId, content, format),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analysisKeys.modules(projectId) });
    },
  });
};

export const useCreateModule = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateModuleRequest) => createModule(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analysisKeys.modules(projectId) });
    },
  });
};

export const useUpdateModule = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ moduleId, data }: { moduleId: string; data: UpdateModuleRequest }) => updateModule(projectId, moduleId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analysisKeys.modules(projectId) });
    },
  });
};

export const useDeleteModule = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (moduleId: string) => deleteModule(projectId, moduleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analysisKeys.modules(projectId) });
    },
  });
};

export const useDecomposeAll = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => decomposeAll(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: analysisKeys.modules(projectId) });
    },
  });
};

export const useTransitionState = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: TransitionStateRequest) => transitionState(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
};
