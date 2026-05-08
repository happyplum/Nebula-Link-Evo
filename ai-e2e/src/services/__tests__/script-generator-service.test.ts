import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScriptGeneratorService } from '../script-generator-service.js';
import type { AIProvider } from '../../ai/provider.js';
import type { PromptTemplateManager } from '../../ai/prompt-manager.js';
import type { ScriptRepository, Script } from '../../database/repositories/script-repository.js';
import type { TestScenarioRepository, TestScenario } from '../../database/repositories/test-scenario-repository.js';
import type { URLRepository, URLRecord } from '../../database/repositories/url-repository.js';
import type { URLModuleBindingRepository, URLModuleBinding } from '../../database/repositories/url-module-binding-repository.js';

// ---------- mock factories ----------

function createMockScenario(overrides: Partial<TestScenario> = {}): TestScenario {
  return {
    id: 'scenario-1',
    functional_module_id: 'module-1',
    name: 'Login Test',
    description: 'Test user login flow',
    test_data_json: '{"username":"admin","password":"123456"}',
    sort_order: 0,
    source: 'ai_generated',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createMockBinding(overrides: Partial<URLModuleBinding> = {}): URLModuleBinding {
  return {
    id: 'binding-1',
    url_id: 'url-1',
    functional_module_id: 'module-1',
    status: 'human_confirmed',
    confidence_score: 0.95,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createMockURL(overrides: Partial<URLRecord> = {}): URLRecord {
  return {
    id: 'url-1',
    project_id: 'project-1',
    url: 'https://example.com/login',
    title: 'Login Page',
    discovered_method: 'crawl',
    page_snapshot_json: '<html><body><form><input name="username"/><input name="password"/><button>Login</button></form></body></html>',
    auth_required: 0,
    last_verified_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createMockScript(overrides: Partial<Script> = {}): Script {
  return {
    id: 'script-1',
    test_scenario_id: 'scenario-1',
    version: 1,
    content: "import { test, expect } from '@playwright/test';\ntest('login', async ({ page }) => { await page.goto('https://example.com/login'); });",
    language: 'ts',
    generated_by: 'ai_generated',
    status: 'generated',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const VALID_SCRIPT = `import { test, expect } from '@playwright/test';

test('login flow', async ({ page }) => {
  // Navigate to login page
  await page.goto('https://example.com/login');

  // Fill username
  await page.getByRole('textbox', { name: 'Username' }).fill('admin');

  // Fill password
  await page.getByRole('textbox', { name: 'Password' }).fill('123456');

  // Click login button
  await page.getByRole('button', { name: 'Login' }).click();

  // Assert successful redirect
  await expect(page).toHaveURL(/dashboard/);
});`;

const INVALID_SCRIPT_NO_IMPORT = `test('bad', async ({ page }) => {
  await page.goto('https://example.com');
});`;

const INVALID_SCRIPT_NO_TEST = `import { test, expect } from '@playwright/test';
// no test block here
const x = 1;`;

// ---------- helpers ----------

function createMocks() {
  const aiProvider: AIProvider = {
    generateText: vi.fn(),
    initialize: vi.fn(),
    streamText: vi.fn(),
    getModel: vi.fn(),
  } as unknown as AIProvider;

  const promptManager: PromptTemplateManager = {
    render: vi.fn(),
    load: vi.fn(),
    listTemplates: vi.fn(),
  } as unknown as PromptTemplateManager;

  const scriptRepo: ScriptRepository = {
    create: vi.fn(),
    findById: vi.fn(),
    findByScenarioId: vi.fn(),
    findLatestByScenarioId: vi.fn(),
    findByStatus: vi.fn(),
    createVersion: vi.fn(),
    delete: vi.fn(),
  } as unknown as ScriptRepository;

  const scenarioRepo: TestScenarioRepository = {
    create: vi.fn(),
    findById: vi.fn(),
    findByFunctionalModuleId: vi.fn(),
    delete: vi.fn(),
  } as unknown as TestScenarioRepository;

  const urlRepo: URLRepository = {
    create: vi.fn(),
    findById: vi.fn(),
    findByProjectId: vi.fn(),
    findUnbound: vi.fn(),
    delete: vi.fn(),
  } as unknown as URLRepository;

  const urlBindingRepo: URLModuleBindingRepository = {
    create: vi.fn(),
    findById: vi.fn(),
    findByModuleId: vi.fn(),
    findByProjectId: vi.fn(),
    delete: vi.fn(),
  } as unknown as URLModuleBindingRepository;

  const service = new ScriptGeneratorService({
    aiProvider,
    promptManager,
    scriptRepo,
    scenarioRepo,
    urlRepo,
    urlBindingRepo,
  });

  return { service, aiProvider, promptManager, scriptRepo, scenarioRepo, urlRepo, urlBindingRepo };
}

// ---------- tests ----------

describe('ScriptGeneratorService', () => {
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = createMocks();
  });

  // ==================== validateScriptSyntax ====================

  describe('validateScriptSyntax', () => {
    it('should return valid for a well-formed Playwright script', () => {
      const result = mocks.service.validateScriptSyntax(VALID_SCRIPT);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing import statement', () => {
      const result = mocks.service.validateScriptSyntax(INVALID_SCRIPT_NO_IMPORT);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('import'))).toBe(true);
    });

    it('should detect missing test block', () => {
      const result = mocks.service.validateScriptSyntax(INVALID_SCRIPT_NO_TEST);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('test('))).toBe(true);
    });

    it('should detect unbalanced braces', () => {
      const unbalanced = `import { test, expect } from '@playwright/test';\ntest('bad', async ({ page }) => {\n  await page.goto('/');\n});\n}`;
      const result = mocks.service.validateScriptSyntax(unbalanced);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('brace') || e.includes('Brace'))).toBe(true);
    });
  });

  // ==================== generateScript ====================

  describe('generateScript', () => {
    it('should generate a valid script for a scenario', async () => {
      const scenario = createMockScenario();
      const binding = createMockBinding();
      const url = createMockURL();
      const createdScript = createMockScript({ content: VALID_SCRIPT });

      mocks.scenarioRepo.findById = vi.fn().mockReturnValue(scenario);
      mocks.urlBindingRepo.findByModuleId = vi.fn().mockReturnValue([binding]);
      mocks.urlRepo.findById = vi.fn().mockReturnValue(url);
      mocks.promptManager.render = vi.fn().mockResolvedValue('rendered prompt');
      mocks.aiProvider.generateText = vi.fn().mockResolvedValue({ text: VALID_SCRIPT, tokenUsage: { promptTokens: 100, completionTokens: 200 } });
      mocks.scriptRepo.createVersion = vi.fn().mockReturnValue(createdScript);

      const result = await mocks.service.generateScript('scenario-1');

      expect(result).toEqual(createdScript);
      expect(mocks.scenarioRepo.findById).toHaveBeenCalledWith('scenario-1');
      expect(mocks.urlBindingRepo.findByModuleId).toHaveBeenCalledWith('module-1');
      expect(mocks.urlRepo.findById).toHaveBeenCalledWith('url-1');
      expect(mocks.promptManager.render).toHaveBeenCalledWith('script-generation', expect.objectContaining({
        scenario_name: scenario.name,
        scenario_description: scenario.description,
        page_url: url.url,
      }));
      expect(mocks.aiProvider.generateText).toHaveBeenCalledWith('rendered prompt', expect.any(Object));
      expect(mocks.scriptRepo.createVersion).toHaveBeenCalledWith('scenario-1', VALID_SCRIPT, 'ai_generated');
    });

    it('should throw if scenario not found', async () => {
      mocks.scenarioRepo.findById = vi.fn().mockReturnValue(null);

      await expect(mocks.service.generateScript('nonexistent'))
        .rejects.toThrow('Test scenario not found: nonexistent');
    });

    it('should throw if no URL bindings found for functional module', async () => {
      const scenario = createMockScenario();
      mocks.scenarioRepo.findById = vi.fn().mockReturnValue(scenario);
      mocks.urlBindingRepo.findByModuleId = vi.fn().mockReturnValue([]);

      await expect(mocks.service.generateScript('scenario-1'))
        .rejects.toThrow('No URL bindings found for functional module: module-1');
    });

    it('should retry on syntax validation failure and succeed on retry', async () => {
      const scenario = createMockScenario();
      const binding = createMockBinding();
      const url = createMockURL();

      mocks.scenarioRepo.findById = vi.fn().mockReturnValue(scenario);
      mocks.urlBindingRepo.findByModuleId = vi.fn().mockReturnValue([binding]);
      mocks.urlRepo.findById = vi.fn().mockReturnValue(url);
      mocks.promptManager.render = vi.fn().mockResolvedValue('rendered prompt');

      // First call returns invalid script, second returns valid
      mocks.aiProvider.generateText = vi.fn()
        .mockResolvedValueOnce({ text: INVALID_SCRIPT_NO_IMPORT, tokenUsage: { promptTokens: 100, completionTokens: 50 } })
        .mockResolvedValueOnce({ text: VALID_SCRIPT, tokenUsage: { promptTokens: 150, completionTokens: 200 } });

      const createdScript = createMockScript({ content: VALID_SCRIPT });
      mocks.scriptRepo.createVersion = vi.fn().mockReturnValue(createdScript);

      const result = await mocks.service.generateScript('scenario-1');

      expect(result.content).toBe(VALID_SCRIPT);
      expect(mocks.aiProvider.generateText).toHaveBeenCalledTimes(2);
      // Second prompt should include error feedback
      const secondCallArgs = (mocks.aiProvider.generateText as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(secondCallArgs[0]).toContain('Previous Attempt Errors');
    });

    it('should throw after max retries with invalid script', async () => {
      const scenario = createMockScenario();
      const binding = createMockBinding();
      const url = createMockURL();

      mocks.scenarioRepo.findById = vi.fn().mockReturnValue(scenario);
      mocks.urlBindingRepo.findByModuleId = vi.fn().mockReturnValue([binding]);
      mocks.urlRepo.findById = vi.fn().mockReturnValue(url);
      mocks.promptManager.render = vi.fn().mockResolvedValue('rendered prompt');

      // All calls return invalid script
      mocks.aiProvider.generateText = vi.fn()
        .mockResolvedValue({ text: INVALID_SCRIPT_NO_IMPORT, tokenUsage: { promptTokens: 100, completionTokens: 50 } });

      await expect(mocks.service.generateScript('scenario-1'))
        .rejects.toThrow('Failed to generate valid script after 3 attempts');

      expect(mocks.aiProvider.generateText).toHaveBeenCalledTimes(3);
    });

    it('should use page_snapshot from URL when available', async () => {
      const scenario = createMockScenario();
      const binding = createMockBinding();
      const url = createMockURL({ page_snapshot_json: '<html>snapshot</html>' });

      mocks.scenarioRepo.findById = vi.fn().mockReturnValue(scenario);
      mocks.urlBindingRepo.findByModuleId = vi.fn().mockReturnValue([binding]);
      mocks.urlRepo.findById = vi.fn().mockReturnValue(url);
      mocks.promptManager.render = vi.fn().mockResolvedValue('prompt');
      mocks.aiProvider.generateText = vi.fn().mockResolvedValue({ text: VALID_SCRIPT, tokenUsage: { promptTokens: 0, completionTokens: 0 } });
      mocks.scriptRepo.createVersion = vi.fn().mockReturnValue(createMockScript());

      await mocks.service.generateScript('scenario-1');

      expect(mocks.promptManager.render).toHaveBeenCalledWith('script-generation', expect.objectContaining({
        page_snapshot: '<html>snapshot</html>',
      }));
    });

    it('should use empty string for page_snapshot when not available', async () => {
      const scenario = createMockScenario();
      const binding = createMockBinding();
      const url = createMockURL({ page_snapshot_json: null });

      mocks.scenarioRepo.findById = vi.fn().mockReturnValue(scenario);
      mocks.urlBindingRepo.findByModuleId = vi.fn().mockReturnValue([binding]);
      mocks.urlRepo.findById = vi.fn().mockReturnValue(url);
      mocks.promptManager.render = vi.fn().mockResolvedValue('prompt');
      mocks.aiProvider.generateText = vi.fn().mockResolvedValue({ text: VALID_SCRIPT, tokenUsage: { promptTokens: 0, completionTokens: 0 } });
      mocks.scriptRepo.createVersion = vi.fn().mockReturnValue(createMockScript());

      await mocks.service.generateScript('scenario-1');

      expect(mocks.promptManager.render).toHaveBeenCalledWith('script-generation', expect.objectContaining({
        page_snapshot: '',
      }));
    });

    it('should pass test_data_json from scenario to prompt', async () => {
      const scenario = createMockScenario({ test_data_json: '{"username":"admin"}' });
      const binding = createMockBinding();
      const url = createMockURL();

      mocks.scenarioRepo.findById = vi.fn().mockReturnValue(scenario);
      mocks.urlBindingRepo.findByModuleId = vi.fn().mockReturnValue([binding]);
      mocks.urlRepo.findById = vi.fn().mockReturnValue(url);
      mocks.promptManager.render = vi.fn().mockResolvedValue('prompt');
      mocks.aiProvider.generateText = vi.fn().mockResolvedValue({ text: VALID_SCRIPT, tokenUsage: { promptTokens: 0, completionTokens: 0 } });
      mocks.scriptRepo.createVersion = vi.fn().mockReturnValue(createMockScript());

      await mocks.service.generateScript('scenario-1');

      expect(mocks.promptManager.render).toHaveBeenCalledWith('script-generation', expect.objectContaining({
        test_data: '{"username":"admin"}',
      }));
    });

    it('should use default test_data when scenario has none', async () => {
      const scenario = createMockScenario({ test_data_json: null });
      const binding = createMockBinding();
      const url = createMockURL();

      mocks.scenarioRepo.findById = vi.fn().mockReturnValue(scenario);
      mocks.urlBindingRepo.findByModuleId = vi.fn().mockReturnValue([binding]);
      mocks.urlRepo.findById = vi.fn().mockReturnValue(url);
      mocks.promptManager.render = vi.fn().mockResolvedValue('prompt');
      mocks.aiProvider.generateText = vi.fn().mockResolvedValue({ text: VALID_SCRIPT, tokenUsage: { promptTokens: 0, completionTokens: 0 } });
      mocks.scriptRepo.createVersion = vi.fn().mockReturnValue(createMockScript());

      await mocks.service.generateScript('scenario-1');

      expect(mocks.promptManager.render).toHaveBeenCalledWith('script-generation', expect.objectContaining({
        test_data: 'No test data provided.',
      }));
    });
  });

  // ==================== generateTestData ====================

  describe('generateTestData', () => {
    it('should generate test data for a scenario', async () => {
      const scenario = createMockScenario();
      const binding = createMockBinding();
      const url = createMockURL({ page_snapshot_json: '{"fields":["username","password"]}' });
      const testDataResult = { valid_data: { username: 'admin' }, boundary_data: [] };

      mocks.scenarioRepo.findById = vi.fn().mockReturnValue(scenario);
      mocks.urlBindingRepo.findByModuleId = vi.fn().mockReturnValue([binding]);
      mocks.urlRepo.findById = vi.fn().mockReturnValue(url);
      mocks.promptManager.render = vi.fn().mockResolvedValue('rendered prompt');
      mocks.aiProvider.generateText = vi.fn().mockResolvedValue({
        text: '```json\n' + JSON.stringify(testDataResult) + '\n```',
        tokenUsage: { promptTokens: 50, completionTokens: 100 },
      });

      const result = await mocks.service.generateTestData('scenario-1');

      expect(result).toEqual(testDataResult);
      expect(mocks.promptManager.render).toHaveBeenCalledWith('test-data-generation', expect.objectContaining({
        scenario_name: scenario.name,
        scenario_description: scenario.description,
        page_fields: '{"fields":["username","password"]}',
      }));
    });

    it('should throw if scenario not found', async () => {
      mocks.scenarioRepo.findById = vi.fn().mockReturnValue(null);
      await expect(mocks.service.generateTestData('nonexistent'))
        .rejects.toThrow('Test scenario not found: nonexistent');
    });

    it('should handle AI response without code fence', async () => {
      const scenario = createMockScenario();
      const binding = createMockBinding();
      const url = createMockURL();
      const testDataResult = { valid_data: { username: 'admin' }, boundary_data: [] };

      mocks.scenarioRepo.findById = vi.fn().mockReturnValue(scenario);
      mocks.urlBindingRepo.findByModuleId = vi.fn().mockReturnValue([binding]);
      mocks.urlRepo.findById = vi.fn().mockReturnValue(url);
      mocks.promptManager.render = vi.fn().mockResolvedValue('rendered prompt');
      mocks.aiProvider.generateText = vi.fn().mockResolvedValue({
        text: JSON.stringify(testDataResult),
        tokenUsage: { promptTokens: 50, completionTokens: 100 },
      });

      const result = await mocks.service.generateTestData('scenario-1');
      expect(result).toEqual(testDataResult);
    });

    it('should throw on invalid JSON from AI', async () => {
      const scenario = createMockScenario();
      const binding = createMockBinding();
      const url = createMockURL();

      mocks.scenarioRepo.findById = vi.fn().mockReturnValue(scenario);
      mocks.urlBindingRepo.findByModuleId = vi.fn().mockReturnValue([binding]);
      mocks.urlRepo.findById = vi.fn().mockReturnValue(url);
      mocks.promptManager.render = vi.fn().mockResolvedValue('rendered prompt');
      mocks.aiProvider.generateText = vi.fn().mockResolvedValue({
        text: 'not valid json {{{',
        tokenUsage: { promptTokens: 50, completionTokens: 100 },
      });

      await expect(mocks.service.generateTestData('scenario-1'))
        .rejects.toThrow('Failed to parse test data');
    });
  });

  // ==================== regenerateScript ====================

  describe('regenerateScript', () => {
    it('should re-generate a script from existing script context', async () => {
      const existingScript = createMockScript({ id: 'script-old', version: 1 });
      const scenario = createMockScenario();
      const binding = createMockBinding();
      const url = createMockURL();
      const newScript = createMockScript({ id: 'script-new', version: 2 });

      mocks.scriptRepo.findById = vi.fn().mockReturnValue(existingScript);
      mocks.scenarioRepo.findById = vi.fn().mockReturnValue(scenario);
      mocks.urlBindingRepo.findByModuleId = vi.fn().mockReturnValue([binding]);
      mocks.urlRepo.findById = vi.fn().mockReturnValue(url);
      mocks.promptManager.render = vi.fn().mockResolvedValue('prompt');
      mocks.aiProvider.generateText = vi.fn().mockResolvedValue({ text: VALID_SCRIPT, tokenUsage: { promptTokens: 0, completionTokens: 0 } });
      mocks.scriptRepo.createVersion = vi.fn().mockReturnValue(newScript);

      const result = await mocks.service.regenerateScript('script-old');

      expect(result).toEqual(newScript);
      expect(mocks.scriptRepo.findById).toHaveBeenCalledWith('script-old');
      expect(mocks.scriptRepo.createVersion).toHaveBeenCalledWith('scenario-1', VALID_SCRIPT, 'ai_generated');
    });

    it('should throw if script not found', async () => {
      mocks.scriptRepo.findById = vi.fn().mockReturnValue(null);
      await expect(mocks.service.regenerateScript('nonexistent'))
        .rejects.toThrow('Script not found: nonexistent');
    });
  });

  // ==================== saveEditedScript ====================

  describe('saveEditedScript', () => {
    it('should save a human-edited script as new version', async () => {
      const existingScript = createMockScript({ id: 'script-1', version: 1 });
      const editedScript = createMockScript({ id: 'script-2', version: 2, generated_by: 'human_edited', status: 'edited' });

      mocks.scriptRepo.findById = vi.fn().mockReturnValue(existingScript);
      mocks.scriptRepo.createVersion = vi.fn().mockReturnValue(editedScript);

      const result = await mocks.service.saveEditedScript('script-1', VALID_SCRIPT);

      expect(result).toEqual(editedScript);
      expect(mocks.scriptRepo.createVersion).toHaveBeenCalledWith('scenario-1', VALID_SCRIPT, 'human_edited');
    });

    it('should throw if script not found', async () => {
      mocks.scriptRepo.findById = vi.fn().mockReturnValue(null);
      await expect(mocks.service.saveEditedScript('nonexistent', VALID_SCRIPT))
        .rejects.toThrow('Script not found: nonexistent');
    });

    it('should throw if edited content has syntax errors', async () => {
      const existingScript = createMockScript();
      mocks.scriptRepo.findById = vi.fn().mockReturnValue(existingScript);

      await expect(mocks.service.saveEditedScript('script-1', INVALID_SCRIPT_NO_IMPORT))
        .rejects.toThrow('Script syntax validation failed');
    });
  });

  // ==================== getScriptHistory ====================

  describe('getScriptHistory', () => {
    it('should return all script versions for a scenario', async () => {
      const scripts = [
        createMockScript({ version: 2, content: 'v2' }),
        createMockScript({ version: 1, content: 'v1' }),
      ];
      mocks.scriptRepo.findByScenarioId = vi.fn().mockReturnValue(scripts);

      const result = await mocks.service.getScriptHistory('scenario-1');

      expect(result).toEqual(scripts);
      expect(mocks.scriptRepo.findByScenarioId).toHaveBeenCalledWith('scenario-1');
    });

    it('should return empty array when no scripts exist', async () => {
      mocks.scriptRepo.findByScenarioId = vi.fn().mockReturnValue([]);

      const result = await mocks.service.getScriptHistory('scenario-1');

      expect(result).toEqual([]);
    });
  });
});
