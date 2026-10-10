import { requestJson } from '../../../shared/api/request.js';
import type {
  CreateProjectInput,
  SemanticProjectWorkspace as CreatedProjectWorkspace,
  SemanticProjectSummary as Project,
} from '../../../../../src/contracts/semantic-project.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const API_BASE = '/api/v1/projects';

export async function fetchProjects(): Promise<Project[]> {
  return (await requestJson<{ projects: Project[] }>(API_BASE)).data.projects;
}

export async function fetchProject(id: string): Promise<Project> {
  return (await requestJson<Project>(`${API_BASE}/${encodeURIComponent(id)}`)).data;
}

export async function createProject(input: CreateProjectInput): Promise<CreatedProjectWorkspace> {
  return (
    await requestJson<CreatedProjectWorkspace>(API_BASE, {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(input),
    })
  ).data;
}

export const projectKeys = {
  all: ['semantic-projects'] as const,
  lists: () => ['semantic-projects', 'list'] as const,
  detail: (id: string) => ['semantic-projects', 'detail', id] as const,
};

export const useProjects = () =>
  useQuery({ queryKey: projectKeys.lists(), queryFn: fetchProjects });

export const useProject = (id: string) =>
  useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => fetchProject(id),
    enabled: Boolean(id),
  });

export const useCreateProject = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProject,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
  });
};
