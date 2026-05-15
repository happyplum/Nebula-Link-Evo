import { useQuery } from '@tanstack/react-query';
import { ProjectDiagnosisReport } from '@/types/report';

export const fetchProjectReport = async (projectId: string): Promise<ProjectDiagnosisReport> => {
  const response = await fetch(`/api/projects/${projectId}/diagnosis/report`);
  if (!response.ok) {
    throw new Error('Failed to fetch project report');
  }
  const data: ProjectDiagnosisReport = await response.json();
  return data;
};

export const reportKeys = {
  all: (projectId: string) => ['report', projectId] as const,
  detail: (projectId: string) => [...reportKeys.all(projectId), 'detail'] as const,
};

export const useProjectReport = (projectId: string) => {
  return useQuery({
    queryKey: reportKeys.detail(projectId),
    queryFn: () => fetchProjectReport(projectId),
    enabled: !!projectId,
  });
};
