import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Project } from '@/types/project';

// Base API URL
const API_BASE = '/api/projects';

// Fetch all projects
export const fetchProjects = async (): Promise<Project[]> => {
  const response = await fetch(API_BASE);
  if (!response.ok) {
    throw new Error('Failed to fetch projects');
  }
  const data = await response.json();
  return data.projects || [];
};

// Fetch single project
export const fetchProject = async (id: string): Promise<Project> => {
  const response = await fetch(`${API_BASE}/${id}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch project ${id}`);
  }
  const data = await response.json();
  return data.data || data;
};

// Create project
export const createProject = async (projectData: Partial<Project>): Promise<Project> => {
  const response = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(projectData),
  });
  if (!response.ok) {
    throw new Error('Failed to create project');
  }
  const data = await response.json();
  return data.data || data;
};

// Update project
export const updateProject = async ({ id, ...projectData }: Partial<Project> & { id: string }): Promise<Project> => {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(projectData),
  });
  if (!response.ok) {
    throw new Error(`Failed to update project ${id}`);
  }
  const data = await response.json();
  return data.data || data;
};

// Delete project
export const deleteProject = async (id: string): Promise<void> => {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to delete project ${id}`);
  }
};

// --- React Query Hooks ---

export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: (filters: string) => [...projectKeys.lists(), { filters }] as const,
  details: () => [...projectKeys.all, 'detail'] as const,
  detail: (id: string) => [...projectKeys.details(), id] as const,
};

export const useProjects = () => {
  return useQuery({
    queryKey: projectKeys.lists(),
    queryFn: fetchProjects,
  });
};

export const useProject = (id: string) => {
  return useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => fetchProject(id),
    enabled: !!id,
  });
};

export const useCreateProject = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
};

export const useUpdateProject = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateProject,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(data.id) });
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
};

export const useDeleteProject = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteProject,
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      queryClient.removeQueries({ queryKey: projectKeys.detail(id) });
    },
  });
};
