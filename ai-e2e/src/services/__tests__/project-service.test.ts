import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProjectRepository, Project as RepoProject, CreateProjectParams, UpdateProjectParams } from '../../database/repositories/project-repository.js';
import type { LoginScriptRepository } from '../../database/repositories/login-script-repository.js';
import type { DatabaseManager } from '../../database/db.js';

// ---------- Mock factories ----------

function createMockProjectRepo(store?: Map<string, RepoProject>): ProjectRepository {
  const projects = store ?? new Map<string, RepoProject>();
  const defaultProject: RepoProject = {
    id: 'proj-1',
    name: 'Test Project',
    target_base_url: null,
    auth_config_json: null,
    status: 'draft',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return {
    create: vi.fn((params: CreateProjectParams) => {
      const p: RepoProject = {
        id: 'proj-auto-' + projects.size,
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
    findById: vi.fn((id: string) => projects.get(id) ?? null),
    findAll: vi.fn(() => Array.from(projects.values())),
    update: vi.fn((id: string, params: UpdateProjectParams) => {
      const existing = projects.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...params, updated_at: new Date().toISOString() };
      projects.set(id, updated);
      return updated;
    }),
    delete: vi.fn((id: string) => {
      return projects.delete(id);
    }),
    findByStatus: vi.fn((status: string) =>
      Array.from(projects.values()).filter(p => p.status === status)
    ),
    updateStatus: vi.fn((id: string, status: string) => {
      const existing = projects.get(id);
      if (!existing) return null;
      existing.status = status;
      existing.updated_at = new Date().toISOString();
      return existing;
    }),
  } as unknown as ProjectRepository;
}

function createMockLoginScriptRepo(): LoginScriptRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(() => null),
    findByProjectId: vi.fn(() => []),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as LoginScriptRepository;
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

const { ProjectService } = await import('../project-service.js');

// ---------- Tests ----------

describe('ProjectService', () => {
  let service: InstanceType<typeof ProjectService>;
  let projectRepo: ProjectRepository;
  let loginScriptRepo: LoginScriptRepository;
  let dbManager: DatabaseManager;
  let store: Map<string, RepoProject>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new Map();
    projectRepo = createMockProjectRepo(store);
    loginScriptRepo = createMockLoginScriptRepo();
    dbManager = createMockDbManager(projectRepo, loginScriptRepo);
    service = new ProjectService(dbManager);
  });

  // ===== createProject =====

  describe('createProject', () => {
    it('should create a project with status draft', () => {
      const project = service.createProject('My App', 'https://example.com');

      expect(project.name).toBe('My App');
      expect(project.target_base_url).toBe('https://example.com');
      expect(project.status).toBe('draft');
      expect(projectRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My App',
          target_base_url: 'https://example.com',
          status: 'draft',
        }),
      );
    });

    it('should create a project without base URL', () => {
      const project = service.createProject('No URL Project');

      expect(project.name).toBe('No URL Project');
      expect(project.target_base_url).toBeNull();
    });
  });

  // ===== getProject =====

  describe('getProject', () => {
    it('should return project by id', () => {
      const created = service.createProject('FindMe');
      const found = service.getProject(created.id);

      expect(found).not.toBeNull();
      expect(found!.name).toBe('FindMe');
    });

    it('should return null for nonexistent id', () => {
      const found = service.getProject('nonexistent');
      expect(found).toBeNull();
    });
  });

  // ===== listProjects =====

  describe('listProjects', () => {
    it('should return all projects', () => {
      service.createProject('A');
      service.createProject('B');

      const list = service.listProjects();
      expect(list).toHaveLength(2);
    });

    it('should return empty array when no projects', () => {
      expect(service.listProjects()).toEqual([]);
    });
  });

  // ===== updateProject =====

  describe('updateProject', () => {
    it('should update project fields', () => {
      const created = service.createProject('Old Name');
      const updated = service.updateProject(created.id, { name: 'New Name' });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('New Name');
    });

    it('should return null for nonexistent project', () => {
      const result = service.updateProject('nonexistent', { name: 'X' });
      expect(result).toBeNull();
    });
  });

  // ===== deleteProject =====

  describe('deleteProject', () => {
    it('should delete existing project', () => {
      const created = service.createProject('ToDelete');
      const result = service.deleteProject(created.id);

      expect(result).toBe(true);
      expect(service.getProject(created.id)).toBeNull();
    });

    it('should return false for nonexistent project', () => {
      expect(service.deleteProject('nonexistent')).toBe(false);
    });
  });

  // ===== updateProjectStatus =====

  describe('updateProjectStatus', () => {
    it('should transition from draft to configuring', () => {
      const created = service.createProject('StatusTest');
      const updated = service.updateProjectStatus(created.id, 'configuring');

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('configuring');
    });

    it('should reject invalid transition from draft to analyzing', () => {
      const created = service.createProject('BadTransition');

      expect(() => service.updateProjectStatus(created.id, 'analyzing')).toThrow(
        /invalid transition/i,
      );
    });

    it('should allow valid multi-step transitions', () => {
      const created = service.createProject('Chain');
      service.updateProjectStatus(created.id, 'configuring');
      const result = service.updateProjectStatus(created.id, 'analyzing');

      expect(result!.status).toBe('analyzing');
    });

    it('should throw for nonexistent project', () => {
      expect(() => service.updateProjectStatus('nonexistent', 'configuring')).toThrow(
        /not found/i,
      );
    });
  });

  // ===== configureTarget =====

  describe('configureTarget', () => {
    it('should update target config and set status to configuring', () => {
      const created = service.createProject('ConfigTarget');
      const updated = service.configureTarget(created.id, {
        baseUrl: 'https://app.example.com',
        authType: 'form',
        seedUrls: ['/login', '/dashboard'],
      });

      expect(updated).not.toBeNull();
      expect(updated!.target_base_url).toBe('https://app.example.com');
      expect(updated!.status).toBe('configuring');
    });

    it('should not store plaintext passwords in auth config', () => {
      const created = service.createProject('Secure');
      const updated = service.configureTarget(created.id, {
        baseUrl: 'https://app.example.com',
        authType: 'form',
        seedUrls: [],
        authConfig: { username: 'admin', password: 'secret123' },
      });

      // Verify auth_config_json does not contain plaintext password
      const authJson = updated!.auth_config_json;
      if (authJson) {
        const parsed = JSON.parse(authJson);
        expect(parsed.password).toBeUndefined();
        expect(parsed.username).toBe('admin');
      }
    });

    it('should throw for nonexistent project', () => {
      expect(() =>
        service.configureTarget('nonexistent', {
          baseUrl: 'https://x.com',
          authType: 'none',
          seedUrls: [],
        }),
      ).toThrow(/not found/i);
    });
  });
});
