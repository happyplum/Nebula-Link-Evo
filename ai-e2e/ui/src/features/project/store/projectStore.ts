import { create } from 'zustand';
import { Project } from '../../../../src/types/project';

export interface ProjectState {
  currentProject: Project | null;
  projects: Project[];
  isLoading: boolean;
  error: string | null;
  
  // Actions
  setCurrentProject: (project: Project | null) => void;
  setProjects: (projects: Project[]) => void;
  setLoading: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  updateProjectInList: (project: Project) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  currentProject: null,
  projects: [],
  isLoading: false,
  error: null,

  setCurrentProject: (project) => set({ currentProject: project }),
  
  setProjects: (projects) => set({ projects }),
  
  setLoading: (isLoading) => set({ isLoading }),
  
  setError: (error) => set({ error }),
  
  updateProjectInList: (updatedProject) => set((state) => ({
    projects: state.projects.map(p => p.id === updatedProject.id ? updatedProject : p),
    currentProject: state.currentProject?.id === updatedProject.id ? updatedProject : state.currentProject
  })),
}));
