import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface DiscoveredURL {
  id: string;
  url: string;
  title?: string;
  status: 'pending' | 'explored' | 'failed';
  screenshot_path?: string;
  created_at: string;
}

export interface ModuleBinding {
  id: string;
  url_id: string;
  module_id: string;
  confidence: number;
  status: 'proposed' | 'confirmed' | 'rejected';
  url?: DiscoveredURL;
  module?: { id: string; name: string };
}

export interface ExplorationStatus {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error';
  pages_visited: number;
  urls_found: number;
  current_url?: string;
  error?: string;
}

export interface StartExplorationRequest {
  maxDepth?: number;
  maxPages?: number;
  timeoutMs?: number;
}

export interface AddUrlRequest {
  url: string;
  title?: string;
}

export interface TransitionStateRequest {
  state: string;
}

// --- API Functions ---

export const startExploration = async (projectId: string, data: StartExplorationRequest = {}): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}/exploration/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to start exploration');
};

export const stopExploration = async (projectId: string): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}/exploration/stop`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to stop exploration');
};

export const fetchExplorationStatus = async (projectId: string): Promise<ExplorationStatus> => {
  const response = await fetch(`/api/projects/${projectId}/exploration/status`);
  if (!response.ok) throw new Error('Failed to fetch exploration status');
  const data = await response.json();
  return data.data;
};

export const fetchUrls = async (projectId: string): Promise<DiscoveredURL[]> => {
  const response = await fetch(`/api/projects/${projectId}/exploration/urls`);
  if (!response.ok) throw new Error('Failed to fetch URLs');
  const data = await response.json();
  return data.data || [];
};

export const fetchBindings = async (projectId: string): Promise<ModuleBinding[]> => {
  const response = await fetch(`/api/projects/${projectId}/exploration/bindings`);
  if (!response.ok) throw new Error('Failed to fetch bindings');
  const data = await response.json();
  return data.data || [];
};

export const addUrl = async (projectId: string, data: AddUrlRequest): Promise<DiscoveredURL> => {
  const response = await fetch(`/api/projects/${projectId}/exploration/urls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to add URL');
  const resData = await response.json();
  return resData.data;
};

export const proposeBindings = async (projectId: string): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}/exploration/bind`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to propose bindings');
};

export const confirmBinding = async (projectId: string, bindingId: string): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}/exploration/bind/${bindingId}/confirm`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to confirm binding');
};

export const rejectBinding = async (projectId: string, bindingId: string): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}/exploration/bind/${bindingId}/reject`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to reject binding');
};

export const transitionState = async (projectId: string, data: TransitionStateRequest): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}/state/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('Failed to transition state');
};

// --- React Query Hooks ---

export const explorationKeys = {
  all: (projectId: string) => ['exploration', projectId] as const,
  status: (projectId: string) => [...explorationKeys.all(projectId), 'status'] as const,
  urls: (projectId: string) => [...explorationKeys.all(projectId), 'urls'] as const,
  bindings: (projectId: string) => [...explorationKeys.all(projectId), 'bindings'] as const,
};

export const useExplorationStatus = (projectId: string) => {
  return useQuery({
    queryKey: explorationKeys.status(projectId),
    queryFn: () => fetchExplorationStatus(projectId),
    enabled: !!projectId,
  });
};

export const useUrls = (projectId: string) => {
  return useQuery({
    queryKey: explorationKeys.urls(projectId),
    queryFn: () => fetchUrls(projectId),
    enabled: !!projectId,
  });
};

export const useBindings = (projectId: string) => {
  return useQuery({
    queryKey: explorationKeys.bindings(projectId),
    queryFn: () => fetchBindings(projectId),
    enabled: !!projectId,
  });
};

export const useStartExploration = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data?: StartExplorationRequest) => startExploration(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: explorationKeys.status(projectId) });
    },
  });
};

export const useStopExploration = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => stopExploration(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: explorationKeys.status(projectId) });
    },
  });
};

export const useAddUrl = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: AddUrlRequest) => addUrl(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: explorationKeys.urls(projectId) });
    },
  });
};

export const useProposeBindings = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => proposeBindings(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: explorationKeys.bindings(projectId) });
    },
  });
};

export const useConfirmBinding = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bindingId: string) => confirmBinding(projectId, bindingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: explorationKeys.bindings(projectId) });
    },
  });
};

export const useRejectBinding = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bindingId: string) => rejectBinding(projectId, bindingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: explorationKeys.bindings(projectId) });
    },
  });
};

export const useTransitionState = (projectId: string) => {
  return useMutation({
    mutationFn: (data: TransitionStateRequest) => transitionState(projectId, data),
  });
};
