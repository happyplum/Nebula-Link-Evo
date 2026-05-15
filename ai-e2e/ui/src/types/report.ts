export type FailureType = 'selector' | 'timing' | 'assertion' | 'environment' | 'data' | 'unknown';

export interface ProjectFailureDistributionItem {
  type: FailureType;
  count: number;
}

export interface ProjectRecentFailureItem {
  runId: string;
  failureType: FailureType;
  diagnosis: string;
  timestamp: string;
}

export interface ProjectDiagnosisReport {
  projectId: string;
  totalRuns: number;
  failedRuns: number;
  diagnosedRuns: number;
  undiagnosedRuns: number;
  failureDistribution: ProjectFailureDistributionItem[];
  recentFailures: ProjectRecentFailureItem[];
}
