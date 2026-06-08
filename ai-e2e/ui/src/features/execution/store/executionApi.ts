import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface ExecutionRun {
  id: string;
  project_id: string;
  script_id: string;
  script_name: string;
  status: 'pending' | 'running' | 'pass' | 'fail' | 'error' | 'timeout' | 'passed' | 'failed' | 'fix_applied' | 'fix_rejected';
  started_at: string;
  completed_at: string;
  duration_ms: number | null;
  error_message: string | null;
  screenshot_base64: string | null;
  steps_json: string;
  ai_fix_applied: boolean;
  ai_fix_confidence: number | null;
}

export interface AIDiagnosis {
  runId: string;
  logs: Array<{
    id: string;
    diagnosis: string | null;
    action_taken: string | null;
    created_at: string;
  }>;
}

// --- API Functions ---

export const runScript = async (projectId: string, scriptId: string): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}/execution/run/${scriptId}`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to run script');
};

export const runAllScripts = async (projectId: string): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}/execution/run-all`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to run all scripts');
};

export const fetchRuns = async (projectId: string): Promise<ExecutionRun[]> => {
  const response = await fetch(`/api/projects/${projectId}/execution/runs`);
  if (!response.ok) throw new Error('Failed to fetch runs');
  const data = await response.json();
  return data.runs || data.data || [];
};

export const fetchRunDetail = async (projectId: string, runId: string): Promise<ExecutionRun> => {
  const response = await fetch(`/api/projects/${projectId}/execution/runs/${runId}`);
  if (!response.ok) throw new Error('Failed to fetch run detail');
  const data = await response.json();
  return data.data || data;
};

export const approveFix = async (projectId: string, runId: string): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}/execution/runs/${runId}/approve-fix`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to approve fix');
};

export const rejectFix = async (projectId: string, runId: string): Promise<void> => {
  const response = await fetch(`/api/projects/${projectId}/execution/runs/${runId}/reject-fix`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to reject fix');
};

export const fetchDiagnosis = async (projectId: string, runId: string): Promise<AIDiagnosis> => {
  const response = await fetch(`/api/projects/${projectId}/execution/diagnosis/${runId}`);
  if (!response.ok) throw new Error('Failed to fetch diagnosis');
  const data = await response.json();
  return data.data || data;
};

// --- React Query Hooks ---

export const executionKeys = {
  all: (projectId: string) => ['execution', projectId] as const,
  runs: (projectId: string) => [...executionKeys.all(projectId), 'runs'] as const,
  runDetail: (projectId: string, runId: string) => [...executionKeys.runs(projectId), runId] as const,
  diagnosis: (projectId: string, runId: string) => [...executionKeys.runDetail(projectId, runId), 'diagnosis'] as const,
};

export const useRuns = (projectId: string) => {
  return useQuery({
    queryKey: executionKeys.runs(projectId),
    queryFn: () => fetchRuns(projectId),
    enabled: !!projectId,
  });
};

export const useRunDetail = (projectId: string, runId: string) => {
  return useQuery({
    queryKey: executionKeys.runDetail(projectId, runId),
    queryFn: () => fetchRunDetail(projectId, runId),
    enabled: !!projectId && !!runId,
  });
};

export const useDiagnosis = (projectId: string, runId: string) => {
  return useQuery({
    queryKey: executionKeys.diagnosis(projectId, runId),
    queryFn: () => fetchDiagnosis(projectId, runId),
    enabled: !!projectId && !!runId,
  });
};

export const useRunScript = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scriptId: string) => runScript(projectId, scriptId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: executionKeys.runs(projectId) });
    },
  });
};

export const useRunAllScripts = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => runAllScripts(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: executionKeys.runs(projectId) });
    },
  });
};

export const useApproveFix = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => approveFix(projectId, runId),
    onSuccess: (_, runId) => {
      queryClient.invalidateQueries({ queryKey: executionKeys.runs(projectId) });
      queryClient.invalidateQueries({ queryKey: executionKeys.runDetail(projectId, runId) });
    },
  });
};

export const useRejectFix = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => rejectFix(projectId, runId),
    onSuccess: (_, runId) => {
      queryClient.invalidateQueries({ queryKey: executionKeys.runs(projectId) });
      queryClient.invalidateQueries({ queryKey: executionKeys.runDetail(projectId, runId) });
    },
  });
};
