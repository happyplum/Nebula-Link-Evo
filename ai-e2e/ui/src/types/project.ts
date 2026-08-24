export type BusinessVersionValidationStatus =
  | 'draft'
  | 'validating'
  | 'needs_recheck'
  | 'valid'
  | 'invalid'
  | 'archived';

export interface ProjectVersionSummary {
  id: string;
  versionKey: string;
  name: string;
  validationStatus: BusinessVersionValidationStatus;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  latestVersion?: ProjectVersionSummary;
}

export interface CreatedProjectWorkspace extends Project {
  versionId: string;
  deploymentRevisionId: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  versionKey: string;
  versionName: string;
  targetOrigin: string;
  environment: 'local' | 'test' | 'staging' | 'production';
  prd: { format: 'markdown' | 'plain_text'; content: string };
  createdBy: string;
}
