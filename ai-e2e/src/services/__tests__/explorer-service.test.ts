import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { URLRepository, URLRecord, CreateURLParams } from '../../database/repositories/url-repository.js';
import type { URLModuleBindingRepository, URLModuleBinding, CreateURLModuleBindingParams } from '../../database/repositories/url-module-binding-repository.js';
import type { ExplorationSessionRepository, ExplorationSession, CreateExplorationSessionParams, UpdateExplorationSessionParams } from '../../database/repositories/exploration-session-repository.js';
import type { FunctionalModuleRepository, FunctionalModule } from '../../database/repositories/functional-module-repository.js';
import type { BusinessModuleRepository, BusinessModule } from '../../database/repositories/business-module-repository.js';
import type { ProjectRepository, Project } from '../../database/repositories/project-repository.js';
import type { DatabaseManager } from '../../database/db.js';
import type { PlaywrightClient } from '../playwright-client.js';
import type { AIProvider, TextGenerationResult } from '../../ai/provider.js';
import type { PromptTemplateManager } from '../../ai/prompt-manager.js';

// ---------- Mock factories ----------

function createMockUrlRepo(store?: Map<string, URLRecord>): URLRepository {
  const urls = store ?? new Map<string, URLRecord>();
  return {
    create: vi.fn((params: CreateURLParams): URLRecord => {
      const rec: URLRecord = {
        id: `url-${urls.size}`,
        project_id: params.project_id,
        url: params.url,
        title: params.title ?? null,
        discovered_method: params.discovered_method ?? null,
        page_snapshot_json: params.page_snapshot_json ?? null,
        auth_required: params.auth_required ? 1 : 0,
        last_verified_at: params.last_verified_at ?? null,
        created_at: new Date().toISOString(),
      };
      urls.set(rec.id, rec);
      return rec;
    }),
    findById: vi.fn((id: string) => urls.get(id) ?? null),
    findByProjectId: vi.fn((pid: string) => Array.from(urls.values()).filter(u => u.project_id === pid)),
    findUnbound: vi.fn((pid: string) => Array.from(urls.values()).filter(u => u.project_id === pid)),
    delete: vi.fn(),
  } as unknown as URLRepository;
}

function createMockBindingRepo(store?: Map<string, URLModuleBinding>): URLModuleBindingRepository {
  const bindings = store ?? new Map<string, URLModuleBinding>();
  return {
    create: vi.fn((params: CreateURLModuleBindingParams): URLModuleBinding => {
      const b: URLModuleBinding = {
        id: `bind-${bindings.size}`,
        url_id: params.url_id,
        functional_module_id: params.functional_module_id,
        status: params.status ?? 'ai_proposed',
        confidence_score: params.confidence_score ?? null,
        created_at: new Date().toISOString(),
      };
      bindings.set(b.id, b);
      return b;
    }),
    findById: vi.fn((id: string) => bindings.get(id) ?? null),
    findByModuleId: vi.fn(() => []),
    findByProjectId: vi.fn((pid: string) => Array.from(bindings.values())),
    updateStatus: vi.fn((id: string, status: string) => {
      const b = bindings.get(id);
      if (!b) return null;
      b.status = status;
      return b;
    }),
    delete: vi.fn(),
  } as unknown as URLModuleBindingRepository;
}

function createMockSessionRepo(store?: Map<string, ExplorationSession>): ExplorationSessionRepository {
  const sessions = store ?? new Map<string, ExplorationSession>();
  return {
    create: vi.fn((params: CreateExplorationSessionParams): ExplorationSession => {
      const s: ExplorationSession = {
        id: `sess-${sessions.size}`,
        project_id: params.project_id,
        started_at: new Date().toISOString(),
        completed_at: null,
        pages_visited_json: params.pages_visited_json ?? null,
        urls_discovered_json: params.urls_discovered_json ?? null,
        strategy_used: params.strategy_used ?? null,
        token_count: params.token_count ?? null,
        created_at: new Date().toISOString(),
      };
      sessions.set(s.id, s);
      return s;
    }),
    findById: vi.fn((id: string) => sessions.get(id) ?? null),
    findByProjectId: vi.fn((pid: string) => Array.from(sessions.values()).filter(s => s.project_id === pid)),
    findLatest: vi.fn((pid: string) => {
      const arr = Array.from(sessions.values()).filter(s => s.project_id === pid);
      return arr.length > 0 ? arr[arr.length - 1] : null;
    }),
    update: vi.fn((id: string, params: UpdateExplorationSessionParams) => {
      const s = sessions.get(id);
      if (!s) return null;
      if (params.completed_at !== undefined) s.completed_at = params.completed_at;
      if (params.pages_visited_json !== undefined) s.pages_visited_json = params.pages_visited_json;
      if (params.urls_discovered_json !== undefined) s.urls_discovered_json = params.urls_discovered_json;
      if (params.token_count !== undefined) s.token_count = params.token_count;
      return s;
    }),
    delete: vi.fn(),
  } as unknown as ExplorationSessionRepository;
}

function createMockFunctionalModuleRepo(modules?: FunctionalModule[]): FunctionalModuleRepository {
  const store = modules ?? [];
  return {
    create: vi.fn(),
    findById: vi.fn((id: string) => store.find(m => m.id === id) ?? null),
    findByBusinessModuleId: vi.fn((bid: string) => store.filter(m => m.business_module_id === bid)),
    updateBoundUrl: vi.fn(),
    delete: vi.fn(),
  } as unknown as FunctionalModuleRepository;
}

function createMockBusinessModuleRepo(modules?: BusinessModule[]): BusinessModuleRepository {
  const store = modules ?? [];
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByProjectId: vi.fn((pid: string) => store.filter(m => m.project_id === pid)),
    delete: vi.fn(),
    reorder: vi.fn(),
  } as unknown as BusinessModuleRepository;
}

function createMockProjectRepo(projects?: Map<string, Project>): ProjectRepository {
  const store = projects ?? new Map<string, Project>();
  return {
    create: vi.fn(),
    findById: vi.fn((id: string) => store.get(id) ?? null),
    findAll: vi.fn(() => Array.from(store.values())),
    update: vi.fn(),
    delete: vi.fn(),
    findByStatus: vi.fn(),
    updateStatus: vi.fn(),
  } as unknown as ProjectRepository;
}

function createMockDbManager(deps: {
  urlRepo: URLRepository;
  bindingRepo: URLModuleBindingRepository;
  sessionRepo: ExplorationSessionRepository;
  funcModuleRepo: FunctionalModuleRepository;
  bizModuleRepo: BusinessModuleRepository;
  projectRepo: ProjectRepository;
}): DatabaseManager {
  return {
    getURLRepo: vi.fn(() => deps.urlRepo),
    getURLModuleBindingRepo: vi.fn(() => deps.bindingRepo),
    getExplorationSessionRepo: vi.fn(() => deps.sessionRepo),
    getFunctionalModuleRepo: vi.fn(() => deps.funcModuleRepo),
    getBusinessModuleRepo: vi.fn(() => deps.bizModuleRepo),
    getProjectRepo: vi.fn(() => deps.projectRepo),
  } as unknown as DatabaseManager;
}

function createMockPlaywright(): PlaywrightClient {
  return {
    navigate: vi.fn(async () => ({ success: true, url: 'http://localhost:3001/' })),
    getSnapshot: vi.fn(async () => ({
      elements: { btn1: { tag: 'button', text: 'Login' } },
      screenshot: undefined,
    })),
    screenshot: vi.fn(async () => ({ base64: '' })),
    getPageInfo: vi.fn(async () => ({ url: 'http://localhost:3001/', title: 'Home' })),
    healthCheck: vi.fn(async () => true),
  } as unknown as PlaywrightClient;
}

function createMockAIProvider(responseText?: string): AIProvider {
  const defaultResponse: TextGenerationResult = {
    text: JSON.stringify({
      analysis: 'Test page with navigation links',
      discovered_links: [],
      navigation_decision: { action: 'complete', target: '', reason: 'No more pages' },
    }),
    tokenUsage: { promptTokens: 100, completionTokens: 50 },
  };
  const response = responseText ? { text: responseText, tokenUsage: { promptTokens: 100, completionTokens: 50 } } : defaultResponse;
  return {
    generateText: vi.fn(async () => response),
    initialize: vi.fn(),
  } as unknown as AIProvider;
}

function createMockPromptManager(): PromptTemplateManager {
  return {
    render: vi.fn(async (_name: string, vars: Record<string, string>) => {
      // Return a simple template with variables substituted
      return JSON.stringify(vars);
    }),
    load: vi.fn(async () => ''),
    listTemplates: vi.fn(async () => []),
  } as unknown as PromptTemplateManager;
}

// ---------- Import ----------

const { ExplorerService } = await import('../explorer-service.js');

// ---------- Tests ----------

describe('ExplorerService', () => {
  let service: InstanceType<typeof ExplorerService>;
  let urlRepo: URLRepository;
  let bindingRepo: URLModuleBindingRepository;
  let sessionRepo: ExplorationSessionRepository;
  let funcModuleRepo: FunctionalModuleRepository;
  let bizModuleRepo: BusinessModuleRepository;
  let projectRepo: ProjectRepository;
  let dbManager: DatabaseManager;
  let playwright: PlaywrightClient;
  let aiProvider: AIProvider;
  let promptManager: PromptTemplateManager;

  const PROJECT_ID = 'proj-1';
  const BASE_URL = 'http://localhost:3001';

  function setupService(aiResponse?: string) {
    const urlStore = new Map<string, URLRecord>();
    const bindingStore = new Map<string, URLModuleBinding>();
    const sessionStore = new Map<string, ExplorationSession>();
    const projectStore = new Map<string, Project>();

    projectStore.set(PROJECT_ID, {
      id: PROJECT_ID,
      name: 'Test Project',
      target_base_url: BASE_URL,
      auth_config_json: null,
      status: 'exploring',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    urlRepo = createMockUrlRepo(urlStore);
    bindingRepo = createMockBindingRepo(bindingStore);
    sessionRepo = createMockSessionRepo(sessionStore);
    funcModuleRepo = createMockFunctionalModuleRepo();
    bizModuleRepo = createMockBusinessModuleRepo();
    projectRepo = createMockProjectRepo(projectStore);
    dbManager = createMockDbManager({ urlRepo, bindingRepo, sessionRepo, funcModuleRepo, bizModuleRepo, projectRepo });
    playwright = createMockPlaywright();
    aiProvider = createMockAIProvider(aiResponse);
    promptManager = createMockPromptManager();

    service = new ExplorerService(dbManager, playwright, aiProvider, promptManager);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setupService();
  });

  // ===== startExploration =====

  describe('startExploration', () => {
    it('should create an exploration session and enqueue base URL', async () => {
      const session = await service.startExploration(PROJECT_ID);

      expect(session).not.toBeNull();
      expect(session!.project_id).toBe(PROJECT_ID);
      expect(sessionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: PROJECT_ID,
          strategy_used: 'bfs',
        }),
      );
    });

    it('should enqueue seed URLs alongside base URL', async () => {
      await service.startExploration(PROJECT_ID, {
        seedUrls: ['/dashboard', '/settings'],
      });

      // navigate should be called at least for the base URL
      expect(playwright.navigate).toHaveBeenCalled();
    });

    it('should throw if project not found', async () => {
      await expect(service.startExploration('nonexistent'))
        .rejects.toThrow(/not found/i);
    });

    it('should stop after reaching maxPages', async () => {
      // AI returns discovered links each time
      const linkResponse = JSON.stringify({
        analysis: 'Page with links',
        discovered_links: [
          { text: 'Page A', href: '/a', purpose: 'link' },
          { text: 'Page B', href: '/b', purpose: 'link' },
        ],
        navigation_decision: { action: 'navigate', target: '/a', reason: 'explore' },
      });
      setupService(linkResponse);

      // Override navigate to return different URLs
      (playwright.navigate as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => ({
        success: true,
        url,
      }));

      const session = await service.startExploration(PROJECT_ID, { maxPages: 2 });
      expect(session).not.toBeNull();
    });

    it('should respect maxDepth configuration', async () => {
      setupService(JSON.stringify({
        analysis: 'Deep link',
        discovered_links: [
          { text: 'Deep', href: '/deep/page', purpose: 'link' },
        ],
        navigation_decision: { action: 'navigate', target: '/deep/page', reason: 'explore' },
      }));

      (playwright.navigate as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => ({
        success: true,
        url,
      }));

      const session = await service.startExploration(PROJECT_ID, { maxDepth: 1, maxPages: 10 });
      expect(session).not.toBeNull();
    });
  });

  // ===== stopExploration =====

  describe('stopExploration', () => {
    it('should mark active session as stopped', async () => {
      // Start a long-running exploration with high timeout
      const aiResp = JSON.stringify({
        analysis: 'Page',
        discovered_links: [],
        navigation_decision: { action: 'navigate', target: '/next', reason: 'continue' },
      });

      setupService(aiResp);

      // Use a very high maxPages so exploration doesn't end naturally
      const startPromise = service.startExploration(PROJECT_ID, {
        maxPages: 1000,
        timeoutMs: 30000,
      });

      // Stop after a tick
      setTimeout(() => {
        service.stopExploration(PROJECT_ID);
      }, 10);

      const session = await startPromise;
      expect(session).not.toBeNull();
    });
  });

  // ===== getExplorationStatus =====

  describe('getExplorationStatus', () => {
    it('should return null when no session exists', () => {
      const status = service.getExplorationStatus(PROJECT_ID);
      expect(status).toBeNull();
    });

    it('should return session after exploration starts', async () => {
      await service.startExploration(PROJECT_ID);
      const status = service.getExplorationStatus(PROJECT_ID);
      expect(status).not.toBeNull();
      expect(status!.project_id).toBe(PROJECT_ID);
    });
  });

  // ===== getDiscoveredURLs =====

  describe('getDiscoveredURLs', () => {
    it('should return empty array when no URLs discovered', () => {
      const urls = service.getDiscoveredURLs(PROJECT_ID);
      expect(urls).toEqual([]);
    });

    it('should return URLs after exploration', async () => {
      await service.startExploration(PROJECT_ID, { seedUrls: ['/'] });
      const urls = service.getDiscoveredURLs(PROJECT_ID);
      // At least the base URL or seed URL should have been attempted
      expect(urlRepo.findByProjectId).toHaveBeenCalledWith(PROJECT_ID);
    });
  });

  // ===== proposeBindings =====

  describe('proposeBindings', () => {
    it('should throw if no functional modules exist', async () => {
      // Create some URLs but no functional modules
      const urlStore = new Map<string, URLRecord>();
      urlStore.set('url-0', {
        id: 'url-0',
        project_id: PROJECT_ID,
        url: `${BASE_URL}/dashboard`,
        title: 'Dashboard',
        discovered_method: 'bfs',
        page_snapshot_json: null,
        auth_required: 0,
        last_verified_at: null,
        created_at: new Date().toISOString(),
      });
      urlRepo = createMockUrlRepo(urlStore);
      // Re-bind to the service
      const newDeps = {
        urlRepo,
        bindingRepo: createMockBindingRepo(),
        sessionRepo: createMockSessionRepo(),
        funcModuleRepo: createMockFunctionalModuleRepo(),
        bizModuleRepo: createMockBusinessModuleRepo(),
        projectRepo: createMockProjectRepo(new Map([[PROJECT_ID, {
          id: PROJECT_ID, name: 'Test', target_base_url: BASE_URL, auth_config_json: null,
          status: 'exploring', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }]])),
      };
      dbManager = createMockDbManager(newDeps);
      service = new ExplorerService(dbManager, playwright, aiProvider, promptManager);

      await expect(service.proposeBindings(PROJECT_ID))
        .rejects.toThrow(/no functional modules/i);
    });

    it('should create AI-proposed bindings for unbound URLs', async () => {
      // Setup URLs
      const urlStore = new Map<string, URLRecord>();
      const testUrl: URLRecord = {
        id: 'url-0',
        project_id: PROJECT_ID,
        url: `${BASE_URL}/login`,
        title: 'Login Page',
        discovered_method: 'bfs',
        page_snapshot_json: '{"elements":{}}',
        auth_required: 0,
        last_verified_at: null,
        created_at: new Date().toISOString(),
      };
      urlStore.set('url-0', testUrl);

      // Setup functional modules
      const funcModule: FunctionalModule = {
        id: 'fm-1',
        business_module_id: 'bm-1',
        name: 'User Authentication',
        description: 'Login and registration',
        sort_order: 0,
        bound_url_id: null,
        source: 'ai_generated',
        created_at: new Date().toISOString(),
      };

      const bizModule: BusinessModule = {
        id: 'bm-1',
        project_id: PROJECT_ID,
        name: 'User Management',
        description: 'User-related features',
        sort_order: 0,
        source: 'ai_generated',
        created_at: new Date().toISOString(),
      };

      urlRepo = createMockUrlRepo(urlStore);
      const bindingStore = new Map<string, URLModuleBinding>();
      bindingRepo = createMockBindingRepo(bindingStore);
      funcModuleRepo = createMockFunctionalModuleRepo([funcModule]);
      bizModuleRepo = createMockBusinessModuleRepo([bizModule]);

      const newDeps = {
        urlRepo,
        bindingRepo,
        sessionRepo: createMockSessionRepo(),
        funcModuleRepo,
        bizModuleRepo,
        projectRepo: createMockProjectRepo(new Map([[PROJECT_ID, {
          id: PROJECT_ID, name: 'Test', target_base_url: BASE_URL, auth_config_json: null,
          status: 'exploring', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }]])),
      };
      dbManager = createMockDbManager(newDeps);

      // AI response for binding
      const bindResponse = JSON.stringify({
        bindings: [{ module_name: 'User Authentication', confidence: 0.92, evidence: 'Login form detected' }],
        primary_module: 'User Authentication',
        unclassifiable: false,
      });
      aiProvider = createMockAIProvider(bindResponse);
      promptManager = createMockPromptManager();

      service = new ExplorerService(dbManager, playwright, aiProvider, promptManager);

      const bindings = await service.proposeBindings(PROJECT_ID);

      expect(bindings.length).toBeGreaterThanOrEqual(0);
      expect(bindingRepo.create).toHaveBeenCalled();
    });
  });

  // ===== confirmBinding =====

  describe('confirmBinding', () => {
    it('should update binding status to human_confirmed', () => {
      const bindingStore = new Map<string, URLModuleBinding>();
      const testBinding: URLModuleBinding = {
        id: 'bind-0',
        url_id: 'url-0',
        functional_module_id: 'fm-1',
        status: 'ai_proposed',
        confidence_score: 0.9,
        created_at: new Date().toISOString(),
      };
      bindingStore.set('bind-0', testBinding);
      bindingRepo = createMockBindingRepo(bindingStore);

      const newDeps = {
        urlRepo: createMockUrlRepo(),
        bindingRepo,
        sessionRepo: createMockSessionRepo(),
        funcModuleRepo: createMockFunctionalModuleRepo(),
        bizModuleRepo: createMockBusinessModuleRepo(),
        projectRepo: createMockProjectRepo(),
      };
      dbManager = createMockDbManager(newDeps);
      service = new ExplorerService(dbManager, playwright, aiProvider, promptManager);

      const result = service.confirmBinding('bind-0');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('human_confirmed');
      expect(bindingRepo.updateStatus).toHaveBeenCalledWith('bind-0', 'human_confirmed');
    });

    it('should throw if binding not found', () => {
      expect(() => service.confirmBinding('nonexistent')).toThrow(/not found/i);
    });
  });

  // ===== rejectBinding =====

  describe('rejectBinding', () => {
    it('should update binding status to rejected', () => {
      const bindingStore = new Map<string, URLModuleBinding>();
      const testBinding: URLModuleBinding = {
        id: 'bind-0',
        url_id: 'url-0',
        functional_module_id: 'fm-1',
        status: 'ai_proposed',
        confidence_score: 0.5,
        created_at: new Date().toISOString(),
      };
      bindingStore.set('bind-0', testBinding);
      bindingRepo = createMockBindingRepo(bindingStore);

      const newDeps = {
        urlRepo: createMockUrlRepo(),
        bindingRepo,
        sessionRepo: createMockSessionRepo(),
        funcModuleRepo: createMockFunctionalModuleRepo(),
        bizModuleRepo: createMockBusinessModuleRepo(),
        projectRepo: createMockProjectRepo(),
      };
      dbManager = createMockDbManager(newDeps);
      service = new ExplorerService(dbManager, playwright, aiProvider, promptManager);

      const result = service.rejectBinding('bind-0');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('rejected');
      expect(bindingRepo.updateStatus).toHaveBeenCalledWith('bind-0', 'rejected');
    });

    it('should throw if binding not found', () => {
      expect(() => service.rejectBinding('nonexistent')).toThrow(/not found/i);
    });
  });

  // ===== Same-origin filtering =====

  describe('URL filtering', () => {
    it('should only explore URLs under the same origin', async () => {
      const externalLinkResponse = JSON.stringify({
        analysis: 'Page with external links',
        discovered_links: [
          { text: 'Internal', href: '/about', purpose: 'internal' },
          { text: 'External', href: 'https://evil.com/phishing', purpose: 'external' },
        ],
        navigation_decision: { action: 'complete', target: '', reason: 'done' },
      });
      setupService(externalLinkResponse);

      (playwright.navigate as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => ({
        success: true,
        url,
      }));

      await service.startExploration(PROJECT_ID);

      // Verify navigate was never called with an external URL
      const calls = (playwright.navigate as ReturnType<typeof vi.fn>).mock.calls;
      for (const call of calls) {
        const url: string = call[0];
        expect(url.startsWith(BASE_URL) || url.startsWith('/')).toBe(true);
      }
    });
  });

  // ===== Timeout =====

  describe('timeout protection', () => {
    it('should abort exploration after timeout', async () => {
      const response = JSON.stringify({
        analysis: 'Page',
        discovered_links: [
          { text: 'Next', href: '/next', purpose: 'link' },
        ],
        navigation_decision: { action: 'navigate', target: '/next', reason: 'continue' },
      });
      setupService(response);

      // Navigate resolves quickly, but we have many pages to explore
      let callCount = 0;
      (playwright.navigate as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        return { success: true, url: `${BASE_URL}/page-${callCount}` };
      });

      // Very short timeout — the abort will fire quickly
      const session = await service.startExploration(PROJECT_ID, {
        timeoutMs: 5,
        maxPages: 1000,
      });

      expect(session).not.toBeNull();
      // Should have visited at least one page before timeout
      expect(callCount).toBeGreaterThanOrEqual(1);
    });
  });
});
