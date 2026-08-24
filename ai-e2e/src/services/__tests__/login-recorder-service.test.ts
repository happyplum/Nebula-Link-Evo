import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  LoginScriptRepository,
  LoginScript as RepoLoginScript,
  CreateLoginScriptParams,
  UpdateLoginScriptParams,
} from '../../database/repositories/login-script-repository.js';
import type {
  ProjectRepository,
  Project as RepoProject,
} from '../../database/repositories/project-repository.js';
import type { DatabaseManager } from '../../database/db.js';
import type { AiE2eRuntimeClient } from '../../infrastructure/ai-e2e-runtime-client.js';
import type { LoginStep } from '../../types/login-script.js';

// ---------- Mock factories ----------

function createMockLoginScriptRepo(scripts?: Map<string, RepoLoginScript>): LoginScriptRepository {
  const store = scripts ?? new Map<string, RepoLoginScript>();
  let counter = 0;

  return {
    create: vi.fn((params: CreateLoginScriptParams) => {
      const script: RepoLoginScript = {
        id: 'ls-' + counter++,
        project_id: params.project_id,
        name: params.name,
        steps_json: params.steps_json,
        created_at: new Date().toISOString(),
      };
      store.set(script.id, script);
      return script;
    }),
    findById: vi.fn((id: string) => store.get(id) ?? null),
    findByProjectId: vi.fn((projectId: string) =>
      Array.from(store.values()).filter((s) => s.project_id === projectId)
    ),
    update: vi.fn((id: string, params: UpdateLoginScriptParams) => {
      const existing = store.get(id);
      if (!existing) return null;
      if (params.steps_json !== undefined) existing.steps_json = params.steps_json;
      if (params.name !== undefined) existing.name = params.name;
      return existing;
    }),
    delete: vi.fn((id: string) => store.delete(id)),
  } as unknown as LoginScriptRepository;
}

function createMockProjectRepo(store?: Map<string, RepoProject>): ProjectRepository {
  const projects = store ?? new Map<string, RepoProject>();
  return {
    create: vi.fn((params) => {
      const p: RepoProject = {
        id: 'proj-' + projects.size,
        name: params.name,
        target_base_url: params.target_base_url ?? null,
        auth_config_json: params.auth_config_json ?? null,
        status: params.status ?? 'draft',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      projects.set(p.id, p);
      return p;
    }),
    findById: vi.fn((id) => projects.get(id) ?? null),
    findAll: vi.fn(() => Array.from(projects.values())),
    update: vi.fn((id, params) => {
      const e = projects.get(id);
      if (!e) return null;
      Object.assign(e, params, { updated_at: new Date().toISOString() });
      return e;
    }),
    delete: vi.fn((id) => projects.delete(id)),
    findByStatus: vi.fn(() => []),
    updateStatus: vi.fn((id, status) => {
      const e = projects.get(id);
      if (!e) return null;
      e.status = status;
      return e;
    }),
  } as unknown as ProjectRepository;
}

function createMockRuntimeClient(): AiE2eRuntimeClient {
  return {
    navigate: vi.fn(() => Promise.resolve({ success: true, url: 'https://example.com' })),
    click: vi.fn(() => Promise.resolve({ success: true })),
    clickBySelector: vi.fn(() => Promise.resolve({ success: true })),
    type: vi.fn(() => Promise.resolve({ success: true })),
    screenshot: vi.fn(() => Promise.resolve({ base64: 'fake-screenshot' })),
    getCookies: vi.fn(() => Promise.resolve({ cookies: [] })),
    getLocalStorage: vi.fn(() => Promise.resolve({ data: {} })),
    executeScript: vi.fn(() => Promise.resolve({ result: null })),
    getSnapshot: vi.fn(() => Promise.resolve({ elements: {} })),
    getDOM: vi.fn(() => Promise.resolve({ html: '<html></html>' })),
    getPageInfo: vi.fn(() => Promise.resolve({ url: 'https://example.com', title: 'Test' })),
    healthCheck: vi.fn(() => Promise.resolve(true)),
    generateText: vi.fn(() =>
      Promise.resolve({ text: '', tokenUsage: { promptTokens: 0, completionTokens: 0 } })
    ),
    openBrowser: vi.fn(() => Promise.resolve({ success: true })),
    closeBrowser: vi.fn(() => Promise.resolve({ success: true })),
  } as unknown as AiE2eRuntimeClient;
}

function createMockDbManager(
  projectRepo: ProjectRepository,
  loginScriptRepo: LoginScriptRepository
): DatabaseManager {
  return {
    getProjectRepo: vi.fn(() => projectRepo),
    getLoginScriptRepo: vi.fn(() => loginScriptRepo),
  } as unknown as DatabaseManager;
}

// ---------- Import after mocks ----------

const { LoginRecorderService } = await import('../login-recorder-service.js');

// ---------- Tests ----------

describe('LoginRecorderService', () => {
  let service: InstanceType<typeof LoginRecorderService>;
  let loginScriptRepo: LoginScriptRepository;
  let projectRepo: ProjectRepository;
  let dbManager: DatabaseManager;
  let scriptStore: Map<string, RepoLoginScript>;
  let projectStore: Map<string, RepoProject>;
  let mockClient: AiE2eRuntimeClient;

  beforeEach(() => {
    vi.clearAllMocks();
    scriptStore = new Map();
    projectStore = new Map();
    loginScriptRepo = createMockLoginScriptRepo(scriptStore);
    projectRepo = createMockProjectRepo(projectStore);
    dbManager = createMockDbManager(projectRepo, loginScriptRepo);
    mockClient = createMockRuntimeClient();
    service = new LoginRecorderService(dbManager, mockClient);
  });

  // ===== startRecording =====

  describe('startRecording', () => {
    it('should create a login script with empty steps for a project', () => {
      const createdProject = projectRepo.create({ name: 'LoginTest' });

      const script = service.startRecording(createdProject.id);

      expect(script).not.toBeNull();
      expect(script!.project_id).toBe(createdProject.id);
      expect(script!.steps_json).toBe('[]');
    });

    it('should return null for nonexistent project', () => {
      const result = service.startRecording('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ===== recordStep =====

  describe('recordStep', () => {
    it('should append a navigate step to login script', () => {
      const project = projectRepo.create({ name: 'StepTest' });
      const script = service.startRecording(project.id);

      const step: LoginStep = {
        type: 'navigate',
        description: 'Go to login page',
        url: 'https://app.com/login',
      };
      const updated = service.recordStep(project.id, step);

      expect(updated).not.toBeNull();
      const steps = JSON.parse(updated!.steps_json);
      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe('navigate');
      expect(steps[0].url).toBe('https://app.com/login');
    });

    it('should append multiple steps in order', () => {
      const project = projectRepo.create({ name: 'MultiStep' });
      service.startRecording(project.id);

      service.recordStep(project.id, {
        type: 'navigate',
        description: 'Go',
        url: 'https://app.com',
      });
      service.recordStep(project.id, {
        type: 'fill',
        description: 'Username',
        selector: '#user',
        value: 'admin',
      });
      service.recordStep(project.id, { type: 'click', description: 'Submit', selector: '#submit' });

      const script = service.getLoginScript(project.id);
      const steps = JSON.parse(script!.steps_json);
      expect(steps).toHaveLength(3);
      expect(steps[0].type).toBe('navigate');
      expect(steps[1].type).toBe('fill');
      expect(steps[2].type).toBe('click');
    });

    it('should return null when no script exists for project', () => {
      const result = service.recordStep('no-project', { type: 'wait', description: 'Wait' });
      expect(result).toBeNull();
    });
  });

  // ===== getLoginScript =====

  describe('getLoginScript', () => {
    it('should return the latest login script for a project', () => {
      const project = projectRepo.create({ name: 'GetScript' });
      service.startRecording(project.id);
      service.recordStep(project.id, { type: 'navigate', description: 'Go', url: 'https://x.com' });

      const script = service.getLoginScript(project.id);
      expect(script).not.toBeNull();
      const steps = JSON.parse(script!.steps_json);
      expect(steps).toHaveLength(1);
    });

    it('should return null when no scripts exist', () => {
      expect(service.getLoginScript('nope')).toBeNull();
    });
  });

  // ===== replayLogin =====

  describe('replayLogin', () => {
    it('should execute steps in order via AiE2eRuntimeClient', async () => {
      const project = projectRepo.create({ name: 'Replay' });
      service.startRecording(project.id);

      service.recordStep(project.id, {
        type: 'navigate',
        description: 'Go',
        url: 'https://app.com/login',
      });
      service.recordStep(project.id, {
        type: 'fill',
        description: 'User',
        selector: '#username',
        value: 'admin',
      });
      service.recordStep(project.id, {
        type: 'fill',
        description: 'Pass',
        selector: '#password',
        value: 'secret',
      });
      service.recordStep(project.id, {
        type: 'click',
        description: 'Login',
        selector: '#login-btn',
      });
      service.recordStep(project.id, {
        type: 'wait',
        description: 'Wait for dashboard',
        duration: 2000,
      });

      const result = await service.replayLogin(project.id);

      expect(result.success).toBe(true);
      expect(mockClient.navigate).toHaveBeenCalledWith('https://app.com/login');
      expect(mockClient.type).toHaveBeenCalledWith('#username', 'admin');
      expect(mockClient.type).toHaveBeenCalledWith('#password', 'secret');
      expect(mockClient.clickBySelector).toHaveBeenCalledWith('#login-btn');
    });

    it('should return failure when no script exists', async () => {
      const result = await service.replayLogin('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle AiE2eRuntimeClient errors gracefully', async () => {
      const project = projectRepo.create({ name: 'FailReplay' });
      service.startRecording(project.id);
      service.recordStep(project.id, {
        type: 'navigate',
        description: 'Go',
        url: 'https://bad.com',
      });

      (mockClient.navigate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Network error')
      );

      const result = await service.replayLogin(project.id);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });
  });

  // ===== verifyLogin =====

  describe('verifyLogin', () => {
    it('should verify login by checking cookies', async () => {
      const project = projectRepo.create({ name: 'VerifyCookie' });
      service.startRecording(project.id);
      service.recordStep(project.id, {
        type: 'navigate',
        description: 'Go',
        url: 'https://app.com',
      });

      (mockClient.getCookies as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        cookies: [{ name: 'session', value: 'abc123', domain: 'app.com' }],
      });

      const result = await service.verifyLogin(project.id, {
        method: 'cookie',
        cookieName: 'session',
      });

      expect(result.success).toBe(true);
    });

    it('should fail verification when cookie not found', async () => {
      const project = projectRepo.create({ name: 'NoCookie' });
      service.startRecording(project.id);
      service.recordStep(project.id, {
        type: 'navigate',
        description: 'Go',
        url: 'https://app.com',
      });

      (mockClient.getCookies as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ cookies: [] });

      const result = await service.verifyLogin(project.id, {
        method: 'cookie',
        cookieName: 'session',
      });

      expect(result.success).toBe(false);
    });

    it('should verify login by checking localStorage', async () => {
      const project = projectRepo.create({ name: 'VerifyLS' });
      service.startRecording(project.id);
      service.recordStep(project.id, {
        type: 'navigate',
        description: 'Go',
        url: 'https://app.com',
      });

      (mockClient.getLocalStorage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: { token: 'jwt-token-123' },
      });

      const result = await service.verifyLogin(project.id, {
        method: 'localStorage',
        key: 'token',
      });

      expect(result.success).toBe(true);
    });

    it('should verify login by checking element visibility', async () => {
      const project = projectRepo.create({ name: 'VerifyEl' });
      service.startRecording(project.id);
      service.recordStep(project.id, {
        type: 'navigate',
        description: 'Go',
        url: 'https://app.com',
      });

      (mockClient.executeScript as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        result: true,
      });

      const result = await service.verifyLogin(project.id, {
        method: 'element',
        selector: '.user-avatar',
      });

      expect(result.success).toBe(true);
      expect(mockClient.executeScript).toHaveBeenCalledWith(
        expect.stringContaining('.user-avatar')
      );
    });

    it('should fail when no script exists', async () => {
      const result = await service.verifyLogin('nonexistent', {
        method: 'cookie',
        cookieName: 'session',
      });

      expect(result.success).toBe(false);
    });
  });
});
