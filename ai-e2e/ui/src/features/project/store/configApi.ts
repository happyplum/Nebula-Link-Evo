import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface ProjectConfig {
  target_base_url: string;
  auth_config: {
    type: 'none' | 'login-script';
    login_script_id?: string;
  };
  seed_urls: string[];
}

export interface LoginStep {
  type: 'navigate' | 'fill' | 'click' | 'wait' | 'screenshot';
  description: string;
  url?: string;
  selector?: string;
  value?: string;
  duration?: number;
}

export interface LoginScript {
  id?: string;
  name: string;
  description?: string;
  steps: LoginStep[];
  is_reusable: boolean;
}

const API_BASE = '/api/projects';

export const fetchProjectConfig = async (projectId: string): Promise<ProjectConfig> => {
  const response = await fetch(`${API_BASE}/${projectId}/config`);
  if (!response.ok) {
    throw new Error(`Failed to fetch config for project ${projectId}`);
  }
  const data = await response.json();
  return data.data;
};

export const updateProjectConfig = async ({ projectId, config }: { projectId: string; config: ProjectConfig }): Promise<ProjectConfig> => {
  const response = await fetch(`${API_BASE}/${projectId}/config`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    throw new Error(`Failed to update config for project ${projectId}`);
  }
  const data = await response.json();
  return data.data;
};

export const createLoginScript = async ({ projectId, script }: { projectId: string; script: LoginScript }): Promise<LoginScript> => {
  const response = await fetch(`${API_BASE}/${projectId}/login-script`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(script),
  });
  if (!response.ok) {
    throw new Error(`Failed to create login script for project ${projectId}`);
  }
  const data = await response.json();
  return data.data;
};

export const testLoginScript = async ({ projectId, scriptId }: { projectId: string; scriptId: string }): Promise<unknown> => {
  const response = await fetch(`${API_BASE}/${projectId}/login-script/test`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ script_id: scriptId }),
  });
  if (!response.ok) {
    throw new Error(`Failed to test login script for project ${projectId}`);
  }
  const data = await response.json();
  return data.data;
};

export const transitionProjectState = async ({ projectId, targetStatus }: { projectId: string; targetStatus: string }): Promise<unknown> => {
  const response = await fetch(`${API_BASE}/${projectId}/state/transition`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ targetStatus }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    if (errorData && errorData.error) {
      throw errorData.error;
    }
    throw new Error(`Failed to transition state for project ${projectId}`);
  }
  const data = await response.json();
  return data.data;
};

// --- React Query Hooks ---

export const configKeys = {
  all: ['project-config'] as const,
  details: () => [...configKeys.all, 'detail'] as const,
  detail: (projectId: string) => [...configKeys.details(), projectId] as const,
};

export const useProjectConfig = (projectId: string) => {
  return useQuery({
    queryKey: configKeys.detail(projectId),
    queryFn: () => fetchProjectConfig(projectId),
    enabled: !!projectId,
  });
};

export const useUpdateProjectConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProjectConfig,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: configKeys.detail(variables.projectId) });
    },
  });
};

export const useCreateLoginScript = () => {
  return useMutation({
    mutationFn: createLoginScript,
  });
};

export const useTestLoginScript = () => {
  return useMutation({
    mutationFn: testLoginScript,
  });
};

export const useTransitionProjectState = () => {
  return useMutation({
    mutationFn: transitionProjectState,
  });
};
