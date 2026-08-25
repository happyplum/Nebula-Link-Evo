import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseManager } from '../../../database/db.js';
import { SemanticProjectService } from '../../../services/semantic-project-service.js';
import { createServer } from '../../index.js';

describe('semantic project routes', () => {
  beforeEach(() => {
    DatabaseManager.resetInstance();
    DatabaseManager.getInstance().init(':memory:');
  });

  afterEach(() => {
    DatabaseManager.resetInstance();
  });

  it('atomically creates a project, deployment, PRD and unverified semantic starter graph', async () => {
    const database = DatabaseManager.getInstance();
    const app = createServer({
      logger: false,
      semanticProjectService: new SemanticProjectService(database.getSemanticProjectRepo()),
    });
    const payload = {
      name: '订单中心',
      description: '覆盖下单与订单查询',
      versionKey: 'v1',
      versionName: '首个业务版本',
      targetOrigin: 'https://example.test/app?ignored=1',
      environment: 'test',
      prd: { format: 'markdown', content: '# 订单中心\n\n用户可以创建订单。' },
      createdBy: 'user-1',
    } as const;

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { 'idempotency-key': 'create-project-1' },
      payload,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({
      name: '订单中心',
      latestVersion: { versionKey: 'v1', validationStatus: 'needs_recheck' },
    });

    const projectId = created.json().data.id as string;
    const versionId = created.json().data.versionId as string;
    const db = database.getDatabase();
    expect(db.prepare('SELECT COUNT(*) AS count FROM projects').get()).toEqual({ count: 1 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM deployment_profile_revisions').get()).toEqual({ count: 1 });
    expect(db.prepare('SELECT raw_content FROM version_prd_documents WHERE business_version_id = ?').get(versionId)).toEqual({
      raw_content: payload.prd.content,
    });
    for (const table of [
      'page_definitions',
      'semantic_business_modules',
      'semantic_functional_modules',
      'functional_scripts',
      'semantic_test_scenarios',
    ]) {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 1 });
    }
    expect(db.prepare('SELECT readiness_status FROM functional_script_revisions').get()).toEqual({
      readiness_status: 'unverified',
    });
    expect(db.prepare('SELECT payload_json FROM deployment_profile_revisions').get()).toMatchObject({
      payload_json: expect.stringContaining('https://example.test'),
    });

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { 'idempotency-key': 'create-project-1' },
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data).toMatchObject({ id: projectId, versionId });

    const list = await app.inject({ method: 'GET', url: '/api/v1/projects' });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.projects).toHaveLength(1);
    await app.close();
  });

  it('rejects idempotency drift and non-http targets', async () => {
    const database = DatabaseManager.getInstance();
    const app = createServer({
      logger: false,
      semanticProjectService: new SemanticProjectService(database.getSemanticProjectRepo()),
    });
    const payload = {
      name: '项目',
      versionKey: 'v1',
      versionName: '版本 1',
      targetOrigin: 'https://example.test',
      environment: 'local',
      prd: { format: 'plain_text', content: '验收需求' },
      createdBy: 'user-1',
    } as const;
    await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { 'idempotency-key': 'same-key' },
      payload,
    });
    const drift = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { 'idempotency-key': 'same-key' },
      payload: { ...payload, name: '另一个项目' },
    });
    expect(drift.statusCode).toBe(409);

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { 'idempotency-key': 'invalid-url' },
      payload: { ...payload, targetOrigin: 'file:///tmp/index.html' },
    });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });
});
