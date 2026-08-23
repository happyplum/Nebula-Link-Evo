import { DatabaseSync } from 'node:sqlite';
import Fastify, { type FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { up as up014 } from '../../../database/migrations/014-semantic-asset-foundation.js';
import { up as up015 } from '../../../database/migrations/015-semantic-asset-governance.js';
import { up as up016 } from '../../../database/migrations/016-semantic-workflow-foundation.js';
import { up as up017 } from '../../../database/migrations/017-semantic-evidence-integration-foundation.js';
import { BusinessVersionRepository } from '../../../database/repositories/business-version-repository.js';
import { BusinessVersionService } from '../../../services/business-version-service.js';
import errorHandlerPlugin from '../../plugins/error-handler.js';
import businessVersionRoutes from '../business-versions.js';

describe('business version routes', () => {
  let db: DatabaseSync;
  let app: FastifyInstance;
  let repository: BusinessVersionRepository;

  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
    db.prepare("INSERT INTO projects (id, name) VALUES ('project-1', 'P')").run();
    up014(db);
    up015(db);
    up016(db);
    up017(db);
    repository = new BusinessVersionRepository(db);
    const service = new BusinessVersionService(repository);
    app = Fastify().withTypeProvider<TypeBoxTypeProvider>();
    app.register(errorHandlerPlugin);
    app.register(businessVersionRoutes, { prefix: '/api/v1', service });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('creates, lists and gets a blank business version', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-1/business-versions',
      headers: { 'idempotency-key': 'create-1' },
      payload: {
        versionKey: 'release-1',
        name: 'Release 1',
        createdBy: 'user-1',
        git: { ref: 'main', commit: 'abc123' },
      },
    });

    expect(created.statusCode).toBe(201);
    const versionId = created.json().data.id as string;
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/project-1/business-versions',
    });
    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/business-versions/${versionId}`,
    });

    expect(list.statusCode).toBe(200);
    expect(list.json().data.versions).toHaveLength(1);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      meta: { requestId: expect.any(String) },
      data: {
      id: versionId,
      validationStatus: 'draft',
      assets: {
        pages: 0,
        businessModules: 0,
        functionalModules: 0,
        functionalScripts: 0,
        scenarios: 0,
        staleExecutableAssets: 0,
      },
      },
    });
  });

  it('requires idempotency and maps missing resources and conflicts', async () => {
    const missingKey = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-1/business-versions',
      payload: { versionKey: 'release-1', name: 'Release 1', createdBy: 'user-1' },
    });
    const missingVersion = await app.inject({
      method: 'GET',
      url: '/api/v1/business-versions/missing',
    });

    expect(missingKey.statusCode).toBe(400);
    expect(missingVersion.statusCode).toBe(404);
    expect(missingVersion.json()).toMatchObject({
      code: 'not_found',
      retryable: false,
      correlationId: expect.any(String),
    });
  });

  it('copies a valid source through the HTTP API and replays the idempotency key', async () => {
    const source = repository.create({
      projectId: 'project-1',
      versionKey: 'source',
      name: 'Source',
      createdBy: 'user-1',
      requestId: 'create-source',
    }).version;
    repository.setValidationStatus(source.id, 'valid');
    const request = {
      method: 'POST' as const,
      url: `/api/v1/business-versions/${source.id}/copy`,
      headers: { 'idempotency-key': 'copy-1' },
      payload: { versionKey: 'copy', name: 'Copy', createdBy: 'user-1' },
    };

    const copied = await app.inject(request);
    const replay = await app.inject(request);

    expect(copied.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(copied.json()).toMatchObject({
      data: {
        created: true,
        version: { sourceVersionId: source.id, validationStatus: 'needs_recheck' },
        counts: { functionalScripts: 0, scenarios: 0, staleExecutableAssets: 0 },
        staleAssetIds: [],
      },
    });
    expect(replay.json()).toMatchObject({
      data: {
        created: false,
        version: { id: copied.json().data.version.id },
      },
    });
  });
});
