import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateProjectInput, CreatedProjectWorkspace, Project } from '@/types/project.js';

const API_BASE = '/api/v1/projects';

interface ApiSuccess<T> {
  data: T;
}

async function read<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiSuccess<T> | { message?: string; code?: string };
  if (!response.ok) {
    throw new Error('message' in body && body.message ? body.message : `请求失败 (${response.status})`);
  }
  return (body as ApiSuccess<T>).data;
}

export async function fetchProjects(): Promise<Project[]> {
  const data = await read<{ projects: Project[] }>(await fetch(API_BASE));
  return data.projects;
}

export async function fetchProject(id: string): Promise<Project> {
  return read<Project>(await fetch(`${API_BASE}/${encodeURIComponent(id)}`));
}

export async function createProject(input: CreateProjectInput): Promise<CreatedProjectWorkspace> {
  return read<CreatedProjectWorkspace>(
    await fetch(API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(input),
    })
  );
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
