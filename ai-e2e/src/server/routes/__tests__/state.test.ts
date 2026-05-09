import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { DatabaseManager } from '../../../database/db.js';
import errorHandlerPlugin from '../../plugins/error-handler.js';
import sseEmitterPlugin from '../../plugins/sse-emitter.js';
import stateRoutes from '../state.js';
import type { StateMachineService } from '../../../services/state-machine-service.js';

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

function makeMockStateMachine(overrides?: Partial<StateMachineService>): StateMachineService {
  return {
    transition: vi.fn(),
    rollback: vi.fn(),
    getAvailableTransitions: vi.fn(),
    getCurrentMode: vi.fn(),
    canTransition: vi.fn(),
    checkDeliverables: vi.fn(),
    getModeRequirements: vi.fn(),
    ...overrides,
  } as unknown as StateMachineService;
}

describe('State routes', () => {
  describe('GET /', () => {
    it('returns current status and available transitions', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db, 'ready');

      const stateMachine = makeMockStateMachine({
        getCurrentMode: vi.fn().mockReturnValue('generation'),
        getAvailableTransitions: vi.fn().mockReturnValue(['running', 'generating']),
      });

      const app = createApp();
      app.register(stateRoutes, {
        prefix: '/api/projects/:id/state',
        stateMachine,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/state`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('ready');
      expect(body.mode).toBe('generation');
      expect(body.availableTransitions).toEqual(['running', 'generating']);
    });

    it('returns 404 for non-existent project', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');

      const stateMachine = makeMockStateMachine();

      const app = createApp();
      app.register(stateRoutes, {
        prefix: '/api/projects/:id/state',
        stateMachine,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/projects/nonexistent/state',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /transition', () => {
    it('transitions to a valid target status', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db, 'ready');

      const updatedProject = { id: projectId, name: 'Test Project', status: 'running', target_base_url: 'http://example.com', auth_config_json: null, created_at: '2026-01-01', updated_at: '2026-01-01' };
      const stateMachine = makeMockStateMachine({
        transition: vi.fn().mockReturnValue(updatedProject),
      });

      const app = createApp();
      app.register(stateRoutes, {
        prefix: '/api/projects/:id/state',
        stateMachine,
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/state/transition`,
        payload: { targetStatus: 'running' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('running');
      expect(stateMachine.transition).toHaveBeenCalledWith(projectId, 'running');
    });

    it('returns 400 for invalid transition', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db, 'ready');

      const stateMachine = makeMockStateMachine({
        transition: vi.fn().mockImplementation(() => {
          throw new Error("Cannot transition project from 'ready' to 'draft'");
        }),
      });

      const app = createApp();
      app.register(stateRoutes, {
        prefix: '/api/projects/:id/state',
        stateMachine,
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/state/transition`,
        payload: { targetStatus: 'draft' },
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 404 for non-existent project', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');

      const stateMachine = makeMockStateMachine();

      const app = createApp();
      app.register(stateRoutes, {
        prefix: '/api/projects/:id/state',
        stateMachine,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/projects/nonexistent/state/transition',
        payload: { targetStatus: 'running' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /rollback', () => {
    it('rolls back to previous status', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db, 'running');

      const rolledBack = { id: projectId, name: 'Test Project', status: 'ready', target_base_url: 'http://example.com', auth_config_json: null, created_at: '2026-01-01', updated_at: '2026-01-01' };
      const stateMachine = makeMockStateMachine({
        rollback: vi.fn().mockReturnValue(rolledBack),
      });

      const app = createApp();
      app.register(stateRoutes, {
        prefix: '/api/projects/:id/state',
        stateMachine,
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/state/rollback`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('ready');
      expect(stateMachine.rollback).toHaveBeenCalledWith(projectId);
    });

    it('returns 400 when rollback is not possible (draft)', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db, 'draft');

      const stateMachine = makeMockStateMachine({
        rollback: vi.fn().mockImplementation(() => {
          throw new Error("Cannot rollback from status 'draft'");
        }),
      });

      const app = createApp();
      app.register(stateRoutes, {
        prefix: '/api/projects/:id/state',
        stateMachine,
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/state/rollback`,
      });

      expect(response.statusCode).toBe(500);
    });
  });
});
