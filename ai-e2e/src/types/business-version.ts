export type BusinessVersionValidationStatus =
  | 'draft'
  | 'validating'
  | 'needs_recheck'
  | 'valid'
  | 'invalid'
  | 'archived';

export type AssetReadinessStatus = 'unverified' | 'verified' | 'stale';

export interface GitMetadata {
  repository?: string;
  ref?: string;
  commit?: string;
  buildId?: string;
}

export interface BusinessVersion {
  id: string;
  projectId: string;
  versionKey: string;
  name: string;
  sourceVersionId?: string;
  validationStatus: BusinessVersionValidationStatus;
  schemaVersion: 1;
  git?: GitMetadata;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface AssetRevision<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  revisionNo: number;
  schemaId: string;
  payload: TPayload;
  contentSha256: string;
  validationStatus: 'pending' | 'valid' | 'invalid';
  readinessStatus?: AssetReadinessStatus;
  sourceAssetId?: string;
  sourceRevisionId?: string;
}

export interface PageAsset {
  id: string;
  pageKey: string;
  currentRevision: AssetRevision;
}

export interface BusinessModuleAsset {
  id: string;
  moduleKey: string;
  currentRevision: AssetRevision;
}

export interface FunctionalModuleAsset {
  id: string;
  businessModuleId: string;
  moduleKey: string;
  primaryPageDefinitionId: string;
  currentRevision: AssetRevision;
}

export interface FunctionalScriptAsset {
  id: string;
  functionalModuleId: string;
  scriptKey: string;
  name: string;
  currentRevision: AssetRevision;
}

export interface ScenarioAsset {
  id: string;
  scenarioKey: string;
  name: string;
  currentRevision: AssetRevision;
}

export interface BusinessVersionAssetGraph {
  pages: PageAsset[];
  businessModules: BusinessModuleAsset[];
  functionalModules: FunctionalModuleAsset[];
  functionalScripts: FunctionalScriptAsset[];
  scenarios: ScenarioAsset[];
}

export interface BusinessVersionAssetSummary {
  pages: number;
  businessModules: number;
  functionalModules: number;
  functionalScripts: number;
  scenarios: number;
  staleExecutableAssets: number;
}

export interface BusinessVersionDetail extends BusinessVersion {
  deploymentBindings: Array<{
    bindingKey: string;
    deploymentRevisionId: string;
    isDefault: boolean;
  }>;
  assets: BusinessVersionAssetSummary;
}
