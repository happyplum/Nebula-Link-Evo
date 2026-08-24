export type DeploymentEnvironment = 'local' | 'test' | 'staging' | 'production';

export interface SemanticProjectVersionSummary {
  id: string;
  versionKey: string;
  name: string;
  validationStatus: 'draft' | 'validating' | 'needs_recheck' | 'valid' | 'invalid' | 'archived';
}

export interface SemanticProjectSummary {
  id: string;
  name: string;
  description?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  latestVersion?: SemanticProjectVersionSummary;
}

export interface SemanticProjectWorkspace extends SemanticProjectSummary {
  versionId: string;
  deploymentRevisionId: string;
}
