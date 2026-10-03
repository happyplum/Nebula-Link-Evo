import { BusinessVersionSchema } from './business-version.js';
import { Type, type Static } from '@sinclair/typebox';
export type DeploymentEnvironment = CreateProjectInput['environment'];

export type SemanticProjectVersionSummary = Static<typeof VersionSummarySchema>;

export type SemanticProjectSummary = Static<typeof ProjectSummarySchema>;

export type SemanticProjectWorkspace = Static<typeof ProjectWorkspaceSchema>;

export type CreateProjectInput = Static<typeof CreateProjectBodySchema>;

const ValidationStatusSchema = BusinessVersionSchema.properties.validationStatus;
export const VersionSummarySchema = Type.Object(
  {
    id: Type.String(),
    versionKey: Type.String(),
    name: Type.String(),
    validationStatus: ValidationStatusSchema,
  },
  { additionalProperties: false }
);
export const ProjectSummarySchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    description: Type.Optional(Type.String()),
    createdBy: Type.String(),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    latestVersion: Type.Optional(VersionSummarySchema),
  },
  { additionalProperties: false }
);
export const ProjectWorkspaceSchema = Type.Object(
  {
    ...ProjectSummarySchema.properties,
    versionId: Type.String(),
    deploymentRevisionId: Type.String(),
  },
  { additionalProperties: false }
);
export const CreateProjectBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.Optional(Type.String({ maxLength: 2_000 })),
    versionKey: Type.String({ pattern: '^[a-z0-9][a-z0-9._-]{0,127}$' }),
    versionName: Type.String({ minLength: 1, maxLength: 200 }),
    targetOrigin: Type.String({ minLength: 1, maxLength: 2_000 }),
    environment: Type.Union([
      Type.Literal('local'),
      Type.Literal('test'),
      Type.Literal('staging'),
      Type.Literal('production'),
    ]),
    prd: Type.Object(
      {
        format: Type.Union([Type.Literal('markdown'), Type.Literal('plain_text')]),
        content: Type.String({ minLength: 1, maxLength: 1_000_000 }),
      },
      { additionalProperties: false }
    ),
    createdBy: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false }
);
