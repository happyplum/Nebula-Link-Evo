import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface Script {
  id: string;
  scenario_id: string;
  scenario_name: string;
  functional_module_id: string;
  functional_module_name: string;
  business_module_id: string;
  business_module_name: string;
  content: string;
  test_data_json: string;
  status: 'draft' | 'ready' | 'failed';
  generated_by: 'ai_generated' | 'human_edited' | 'ai_auto_fix';
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ScriptVersion {
  id: string;
  script_id: string;
  version: number;
  content: string;
  generated_by: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface UpdateScriptRequest {
  content?: string;
  test_data_json?: string;
}

export interface TransitionStateRequest {
  targetStatus: string;
}

// --- API Functions ---

export const generateScripts = async (projectId: string): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}/scripts/generate-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!response.ok) throw new Error('Failed to start script generation');
};

export const generateSingleScript = async (projectId: string, scenarioId: string): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}/scripts/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario_id: scenarioId }),
  });
  if (!response.ok) throw new Error('Failed to generate script');
};

export const fetchScripts = async (projectId: string): Promise<Script[]> => {
  const response = await fetch(`/api/projects/${projectId}/scripts`);
  if (!response.ok) throw new Error('Failed to fetch scripts');
  const data = await response.json();
  return Array.isArray(data) ? data : (data.scripts || data.data || []);
};

export const fetchScript = async (projectId: string, scriptId: string): Promise<Script> => {
  const response = await fetch(`/api/projects/${projectId}/scripts/${scriptId}`);
  if (!response.ok) throw new Error('Failed to fetch script');
  const data = await response.json();
  return data.data || data;
};

export const updateScript = async (projectId: string, scriptId: string, data: UpdateScriptRequest): Promise<Script> => {
  const response = await fetch(`/api/projects/${projectId}/scripts/${scriptId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to update script');
  const resData = await response.json();
  return resData.data || resData;
};

export const fetchScriptVersions = async (projectId: string, scriptId: string): Promise<ScriptVersion[]> => {
  const response = await fetch(`/api/projects/${projectId}/scripts/${scriptId}/versions`);
  if (!response.ok) throw new Error('Failed to fetch script versions');
  const data = await response.json();
  return Array.isArray(data) ? data : (data.data || []);
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

export const scriptsKeys = {
  all: (projectId: string) => ['scripts', projectId] as const,
  list: (projectId: string) => [...scriptsKeys.all(projectId), 'list'] as const,
  detail: (projectId: string, scriptId: string) => [...scriptsKeys.all(projectId), 'detail', scriptId] as const,
  versions: (projectId: string, scriptId: string) => [...scriptsKeys.all(projectId), 'versions', scriptId] as const,
};

export const useScripts = (projectId: string) => {
  return useQuery({
    queryKey: scriptsKeys.list(projectId),
    queryFn: () => fetchScripts(projectId),
    enabled: !!projectId,
  });
};

export const useScript = (projectId: string, scriptId: string | null) => {
  return useQuery({
    queryKey: scriptsKeys.detail(projectId, scriptId!),
    queryFn: () => fetchScript(projectId, scriptId!),
    enabled: !!projectId && !!scriptId,
  });
};

export const useScriptVersions = (projectId: string, scriptId: string | null) => {
  return useQuery({
    queryKey: scriptsKeys.versions(projectId, scriptId!),
    queryFn: () => fetchScriptVersions(projectId, scriptId!),
    enabled: !!projectId && !!scriptId,
  });
};

export const useGenerateScripts = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => generateScripts(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scriptsKeys.list(projectId) });
    },
  });
};

export const useGenerateSingleScript = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scenarioId: string) => generateSingleScript(projectId, scenarioId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scriptsKeys.list(projectId) });
    },
  });
};

export const useUpdateScript = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ scriptId, data }: { scriptId: string; data: UpdateScriptRequest }) => updateScript(projectId, scriptId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: scriptsKeys.list(projectId) });
      queryClient.invalidateQueries({ queryKey: scriptsKeys.detail(projectId, variables.scriptId) });
      queryClient.invalidateQueries({ queryKey: scriptsKeys.versions(projectId, variables.scriptId) });
    },
  });
};

export const useTransitionState = (projectId: string) => {
  return useMutation({
    mutationFn: (data: TransitionStateRequest) => transitionState(projectId, data),
  });
};
