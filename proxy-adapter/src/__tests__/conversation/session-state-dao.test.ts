import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../conversation/db.js';
import { SessionStateDAO, OptimisticLockError } from '../../conversation/session-state-dao.js';

describe('SessionStateDAO', () => {
  let db: DatabaseManager;
  let dao: SessionStateDAO;

  beforeEach(() => {
    db = DatabaseManager.getInstance();
    db.initialize(':memory:');
    dao = db.getSessionStateDAO();
  });

  afterEach(() => {
    db.close();
  });

  describe('create', () => {
    it('should create a new session state with default values', async () => {
      const session = db.createSession({
        title: 'Test Session',
        provider: 'test',
        model: 'test-model',
      });

      await dao.create({ sessionId: session.id, status: 'idle' });

      const result = await dao.get(session.id);
      expect(result).not.toBeNull();
      expect(result?.sessionId).toBe(session.id);
      expect(result?.status).toBe('idle');
      expect(result?.version).toBe(1);
      expect(result?.createdAt).toBeDefined();
      expect(result?.updatedAt).toBeDefined();
    });

    it('should create a session state with agent state', async () => {
      const session = db.createSession({
        title: 'Test Session 2',
        provider: 'test',
        model: 'test-model',
      });

      const now = new Date().toISOString();
      const agentState = {
        schema_version: 1 as const,
        currentTask: {
          description: 'Test task',
          startedAt: now,
          completedSteps: 0,
        },
      };

      await dao.create({ sessionId: session.id, status: 'running', agentState });

      const result = await dao.get(session.id);
      expect(result?.agentState).toEqual(agentState);
    });

    it('should create a session state with job ID', async () => {
      const session = db.createSession({
        title: 'Test Session 3',
        provider: 'test',
        model: 'test-model',
      });

      await dao.create({ sessionId: session.id, status: 'running', jobId: 'job-123' });

      const result = await dao.get(session.id);
      expect(result?.jobId).toBe('job-123');
    });
  });

  describe('get', () => {
    it('should retrieve an existing session state', async () => {
      const session = db.createSession({
        title: 'Test Session 4',
        provider: 'test',
        model: 'test-model',
      });

      await dao.create({ sessionId: session.id, status: 'running' });

      const result = await dao.get(session.id);
      expect(result).not.toBeNull();
      expect(result?.sessionId).toBe(session.id);
      expect(result?.status).toBe('running');
    });

    it('should create default idle state for non-existent session (lazy initialization)', async () => {
      const session = db.createSession({
        title: 'Test Session 4b',
        provider: 'test',
        model: 'test-model',
      });

      const result = await dao.get(session.id);
      expect(result).not.toBeNull();
      expect(result?.sessionId).toBe(session.id);
      expect(result?.status).toBe('idle');
      expect(result?.version).toBe(1);
    });
  });

  describe('getStatus', () => {
    it('should retrieve session status', async () => {
      const session = db.createSession({
        title: 'Test Session 5',
        provider: 'test',
        model: 'test-model',
      });

      await dao.create({ sessionId: session.id, status: 'paused' });

      const status = await dao.getStatus(session.id);
      expect(status).toBe('paused');
    });

    it('should return null for non-existent session', async () => {
      const status = await dao.getStatus('non-existent-id');
      expect(status).toBeNull();
    });
  });

  describe('update', () => {
    it('should update session status', async () => {
      const session = db.createSession({
        title: 'Test Session 6',
        provider: 'test',
        model: 'test-model',
      });

      await dao.create({ sessionId: session.id, status: 'idle' });
      await dao.update(session.id, { status: 'running' });

      const result = await dao.get(session.id);
      expect(result?.status).toBe('running');
    });

    it('should increment version on update', async () => {
      const session = db.createSession({
        title: 'Test Session 7',
        provider: 'test',
        model: 'test-model',
      });

      await dao.create({ sessionId: session.id, status: 'idle' });
      await dao.update(session.id, { status: 'running' });

      const result = await dao.get(session.id);
      expect(result?.version).toBe(2);
    });

    it('should throw OptimisticLockError on version mismatch', async () => {
      const session = db.createSession({
        title: 'Test Session 8',
        provider: 'test',
        model: 'test-model',
      });

      await dao.create({ sessionId: session.id, status: 'idle' });

      await expect(
        dao.update(session.id, { status: 'running' }, 999)
      ).rejects.toThrow(OptimisticLockError);
    });

    it('should update with expected version when version matches', async () => {
      const session = db.createSession({
        title: 'Test Session 9',
        provider: 'test',
        model: 'test-model',
      });

      await dao.create({ sessionId: session.id, status: 'idle' });

      await expect(
        dao.update(session.id, { status: 'running' }, 1)
      ).resolves.not.toThrow();

      const result = await dao.get(session.id);
      expect(result?.status).toBe('running');
      expect(result?.version).toBe(2);
    });

    it('should throw error when session not found with expectedVersion', async () => {
      await expect(
        dao.update('non-existent-id', { status: 'running' }, 1)
      ).rejects.toThrow();
    });

    it('should update jobId', async () => {
      const session = db.createSession({
        title: 'Test Session JobId',
        provider: 'test',
        model: 'test-model',
      });

      await dao.create({ sessionId: session.id, status: 'idle' });
      await dao.update(session.id, { jobId: 'job-new-123' });

      const result = await dao.get(session.id);
      expect(result?.jobId).toBe('job-new-123');
    });

    it('should update lastActiveAt', async () => {
      const session = db.createSession({
        title: 'Test Session LastActive',
        provider: 'test',
        model: 'test-model',
      });

      await dao.create({ sessionId: session.id, status: 'idle' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const newTime = new Date().toISOString();
      await dao.update(session.id, { lastActiveAt: newTime });

      const result = await dao.get(session.id);
      expect(result?.lastActiveAt).toBe(newTime);
    });

    it('should return early when no update parameters provided', async () => {
      const session = db.createSession({
        title: 'Test Session No Params',
        provider: 'test',
        model: 'test-model',
      });

      await dao.create({ sessionId: session.id, status: 'idle' });
      const beforeUpdate = await dao.get(session.id);

      // Empty update params - should return early without incrementing version
      await dao.update(session.id, { status: undefined });

      const afterUpdate = await dao.get(session.id);
      expect(afterUpdate?.version).toBe(beforeUpdate?.version);
    });

    it('should clear jobId by setting to empty string', async () => {
      const session = db.createSession({
        title: 'Test Session Clear JobId',
        provider: 'test',
        model: 'test-model',
      });

      await dao.create({ sessionId: session.id, status: 'running', jobId: 'job-to-clear' });
      // Empty string is converted to null in DB, but rowToState converts null to undefined
      await dao.update(session.id, { jobId: '' });

      const result = await dao.get(session.id);
      expect(result?.jobId).toBeUndefined();
    });

    it('should update agentState', async () => {
      const session = db.createSession({
        title: 'Test Session AgentState Update',
        provider: 'test',
        model: 'test-model',
      });

      await dao.create({ sessionId: session.id, status: 'idle' });

      const agentState = {
        schema_version: 1 as const,
        currentTask: {
          description: 'Updated task',
          startedAt: new Date().toISOString(),
          completedSteps: 5,
        },
      };

      await dao.update(session.id, { agentState });

      const result = await dao.get(session.id);
      expect(result?.agentState).toEqual(agentState);
    });

    it('should clear agentState by passing falsy value', async () => {
      const session = db.createSession({
        title: 'Test Session Clear AgentState',
        provider: 'test',
        model: 'test-model',
      });

      const agentState = {
        schema_version: 1 as const,
        currentTask: {
          description: 'Task to clear',
          startedAt: new Date().toISOString(),
          completedSteps: 0,
        },
      };

      await dao.create({ sessionId: session.id, status: 'running', agentState });
      // Implementation converts falsy agentState to null in DB, but rowToState converts null to undefined
      await dao.update(session.id, { agentState: false as unknown as typeof agentState });

      const result = await dao.get(session.id);
      expect(result?.agentState).toBeUndefined();
    });
  });

  describe('updateStatus', () => {
    it('should update status and last_active_at', async () => {
      const session = db.createSession({
        title: 'Test Session 10',
        provider: 'test',
        model: 'test-model',
      });

      await dao.create({ sessionId: session.id, status: 'idle' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      await dao.updateStatus(session.id, 'running');

      const result = await dao.get(session.id);
      expect(result?.status).toBe('running');
      expect(result?.version).toBe(2);
      expect(result?.lastActiveAt).not.toBe(result?.createdAt);
    });

    it('should update status with agent state', async () => {
      const session = db.createSession({
        title: 'Test Session 11',
        provider: 'test',
        model: 'test-model',
      });

      await dao.create({ sessionId: session.id, status: 'idle' });

      const agentState = {
        schema_version: 1 as const,
        blockReason: 'waiting_for_user_input' as const,
      };

      await dao.updateStatus(session.id, 'blocked', agentState);

      const result = await dao.get(session.id);
      expect(result?.status).toBe('blocked');
      expect(result?.agentState).toEqual(agentState);
    });
  });

  describe('getActiveSessions', () => {
    it('should return sessions with active status', async () => {
      const statuses: Array<'idle' | 'running' | 'paused' | 'blocked' | 'completed'> = [
        'idle',
        'running',
        'paused',
        'blocked',
        'completed',
      ];

      for (let i = 0; i < 5; i++) {
        const session = db.createSession({
          title: `Test Session ${i + 12}`,
          provider: 'test',
          model: 'test-model',
        });

        await dao.create({ sessionId: session.id, status: statuses[i] });
      }

      const activeSessions = await dao.getActiveSessions();
      expect(activeSessions).toHaveLength(3);
      expect(activeSessions.every((s) => ['running', 'paused', 'blocked'].includes(s.status))).toBe(true);
    });
  });

  describe('getSessionsByStatus', () => {
    it('should return sessions with specified status', async () => {
      for (let i = 0; i < 3; i++) {
        const session = db.createSession({
          title: `Test Session ${i + 17}`,
          provider: 'test',
          model: 'test-model',
        });

        await dao.create({ sessionId: session.id, status: 'idle' });
      }

      const idleSessions = await dao.getSessionsByStatus('idle');
      expect(idleSessions).toHaveLength(3);
      expect(idleSessions.every((s) => s.status === 'idle')).toBe(true);
    });
  });

  describe('delete', () => {
    it('should delete a session state', async () => {
      const session = db.createSession({
        title: 'Test Session 20',
        provider: 'test',
        model: 'test-model',
      });

      await dao.create({ sessionId: session.id, status: 'idle' });
      await dao.delete(session.id);

      const status = await dao.getStatus(session.id);
      expect(status).toBeNull();
    });
  });
});
