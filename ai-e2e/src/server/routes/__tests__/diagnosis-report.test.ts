import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { DatabaseManager } from '../../../database/db.js';
import errorHandlerPlugin from '../../plugins/error-handler.js';
import sseEmitterPlugin from '../../plugins/sse-emitter.js';
import diagnosisReportRoutes from '../diagnosis-report.js';
import type { AIDiagnosisService } from '../../../services/ai-diagnosis-service.js';
import type { ProjectDiagnosisReport } from '../../../types/ai-intervention.js';

const apps = new Set<FastifyInstance>();

function createApp(): FastifyInstance {
  const app = Fastify()
    .withTypeProvider<TypeBoxTypeProvider>();
  app.register(errorHandlerPlugin);
  app.register(sseEmitterPlugin);
  apps.add(app);
  return app;
}

beforeEach(() => {
  DatabaseManager.resetInstance();
});

afterEach(async () => {
  await Promise.all(Array.from(apps, async app => app.close()));
  apps.clear();
  DatabaseManager.resetInstance();
});

function seedProject(db: DatabaseManager, status = 'ready'): string {
  db.getProjectRepo().create({ name: 'Test Project', target_base_url: 'http://example.com', status });
  const projects = db.getProjectRepo().findAll();
  return projects[0].id;
}

function makeMockDiagnosisService(overrides?: Partial<AIDiagnosisService>): AIDiagnosisService {
  return {
    getProjectDiagnosisReport: vi.fn(),
    ...overrides,
  } as unknown as AIDiagnosisService;
}

const emptyReport: ProjectDiagnosisReport = {
  projectId: '',
  totalRuns: 0,
  failedRuns: 0,
  diagnosedRuns: 0,
  undiagnosedRuns: 0,
  failureDistribution: [],
  recentFailures: [],
};

const sampleReport: ProjectDiagnosisReport = {
  projectId: 'proj-1',
  totalRuns: 10,
  failedRuns: 3,
  diagnosedRuns: 2,
  undiagnosedRuns: 1,
  failureDistribution: [
    { type: 'selector', count: 2 },
    { type: 'timing', count: 1 },
  ],
  recentFailures: [
    {
      runId: 'run-1',
      failureType: 'selector',
      diagnosis: 'Element <script>alert("xss")</script> not found',
      timestamp: '2026-01-01T00:00:00.000Z',
    },
  ],
};

describe('Diagnosis Report Routes', () => {
  describe('GET /report', () => {
    it('returns JSON report by default', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db);

      const report: ProjectDiagnosisReport = { ...sampleReport, projectId };
      const diagnosisService = makeMockDiagnosisService({
        getProjectDiagnosisReport: vi.fn().mockReturnValue(report),
      });

      const app = createApp();
      app.register(diagnosisReportRoutes, {
        prefix: '/api/projects/:id',
        diagnosisService,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/report`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.projectId).toBe(projectId);
      expect(body.totalRuns).toBe(10);
      expect(body.failedRuns).toBe(3);
      expect(body.failureDistribution).toHaveLength(2);
      expect(diagnosisService.getProjectDiagnosisReport).toHaveBeenCalledWith(projectId);
    });

    it('returns downloadable JSON with Content-Disposition for format=json', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db);

      const report: ProjectDiagnosisReport = { ...emptyReport, projectId };
      const diagnosisService = makeMockDiagnosisService({
        getProjectDiagnosisReport: vi.fn().mockReturnValue(report),
      });

      const app = createApp();
      app.register(diagnosisReportRoutes, {
        prefix: '/api/projects/:id',
        diagnosisService,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/report?format=json`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-disposition']).toMatch(/attachment/);
      expect(response.headers['content-disposition']).toMatch(/diagnosis-report\.json/);
      const body = response.json();
      expect(body.projectId).toBe(projectId);
    });

    it('returns HTML page for format=html', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db);

      const report: ProjectDiagnosisReport = { ...sampleReport, projectId };
      const diagnosisService = makeMockDiagnosisService({
        getProjectDiagnosisReport: vi.fn().mockReturnValue(report),
      });

      const app = createApp();
      app.register(diagnosisReportRoutes, {
        prefix: '/api/projects/:id',
        diagnosisService,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/report?format=html`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/html/);
      const html = response.body;
      // Verify HTML structure
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Project Diagnosis Report');
      // Verify XSS escaping: the <script> in diagnosis should be escaped
      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>alert');
      // Verify project ID present
      expect(html).toContain(projectId);
    });

    it('returns 400 for invalid format', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db);

      const diagnosisService = makeMockDiagnosisService();

      const app = createApp();
      app.register(diagnosisReportRoutes, {
        prefix: '/api/projects/:id',
        diagnosisService,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/report?format=csv`,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 for non-existent project', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      // No project seeded

      const diagnosisService = makeMockDiagnosisService();

      const app = createApp();
      app.register(diagnosisReportRoutes, {
        prefix: '/api/projects/:id',
        diagnosisService,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/projects/nonexistent/report',
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns empty report when no runs exist', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db);

      const report: ProjectDiagnosisReport = { ...emptyReport, projectId };
      const diagnosisService = makeMockDiagnosisService({
        getProjectDiagnosisReport: vi.fn().mockReturnValue(report),
      });

      const app = createApp();
      app.register(diagnosisReportRoutes, {
        prefix: '/api/projects/:id',
        diagnosisService,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/report`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.totalRuns).toBe(0);
      expect(body.failedRuns).toBe(0);
      expect(body.failureDistribution).toHaveLength(0);
    });
  });
});
