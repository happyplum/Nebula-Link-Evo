import { Type, type Static } from '@sinclair/typebox';
export type BusinessVersionValidationStatus = BusinessVersion['validationStatus'];

export type AssetReadinessStatus = 'unverified' | 'verified' | 'stale';

export type GitMetadata = Static<typeof GitMetadataSchema>;

export type BusinessVersion = Static<typeof BusinessVersionSchema>;

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

export type BusinessVersionAssetSummary = Static<typeof AssetSummarySchema>;

export type BusinessVersionDetail = Static<typeof BusinessVersionDetailSchema>;

export const GitMetadataSchema = Type.Object(
  {
    repository: Type.Optional(Type.String({ maxLength: 500 })),
    ref: Type.Optional(Type.String({ maxLength: 500 })),
    commit: Type.Optional(Type.String({ maxLength: 500 })),
    buildId: Type.Optional(Type.String({ maxLength: 500 })),
  },
  { additionalProperties: false }
);

export const BusinessVersionSchema = Type.Object(
  {
    id: Type.String(),
    projectId: Type.String(),
    versionKey: Type.String(),
    name: Type.String(),
    sourceVersionId: Type.Optional(Type.String()),
    validationStatus: Type.Union([
      Type.Literal('draft'),
      Type.Literal('validating'),
      Type.Literal('needs_recheck'),
      Type.Literal('valid'),
      Type.Literal('invalid'),
      Type.Literal('archived'),
    ]),
    schemaVersion: Type.Literal(1),
    git: Type.Optional(GitMetadataSchema),
    createdBy: Type.String(),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    archivedAt: Type.Optional(Type.String()),
  },
  { additionalProperties: false }
);

export const AssetSummarySchema = Type.Object(
  {
    pages: Type.Integer({ minimum: 0 }),
    businessModules: Type.Integer({ minimum: 0 }),
    functionalModules: Type.Integer({ minimum: 0 }),
    functionalScripts: Type.Integer({ minimum: 0 }),
    scenarios: Type.Integer({ minimum: 0 }),
    staleExecutableAssets: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false }
);

export const BusinessVersionDetailSchema = Type.Object(
  {
    ...BusinessVersionSchema.properties,
    deploymentBindings: Type.Array(
      Type.Object(
        {
          bindingKey: Type.String(),
          deploymentRevisionId: Type.String(),
          isDefault: Type.Boolean(),
        },
        { additionalProperties: false }
      )
    ),
    assets: AssetSummarySchema,
  },
  { additionalProperties: false }
);
