import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AIDiagnosisService } from '../ai-diagnosis-service.js';
import type { ProxyAdapterClient } from '../../infrastructure/proxy-adapter-client.js';
import type { PromptTemplateManager } from '../../ai/prompt-manager.js';
import type { ExecutionRunRepository, ExecutionRun } from '../../database/repositories/execution-run-repository.js';
import type { AIInterventionLogRepository, AIInterventionLog } from '../../database/repositories/ai-intervention-log-repository.js';
import type { ScriptRepository, Script } from '../../database/repositories/script-repository.js';

// ---------- Repository & Provider mocks ----------

function createMockRunRepo(failedRun?: Partial<ExecutionRun>): ExecutionRunRepository {
  const run: ExecutionRun = {
    id: 'run-1',
    script_id: 'script-1',
    script_version: 1,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    status: 'fail',
    logs: 'Error: selector not found\nconsole.log("hello")',
    screenshot_paths_json: '["artifacts/run-1/screenshot.png"]',
    error_message: 'Timeout waiting for selector "#missing"',
    created_at: new Date().toISOString(),
    ...failedRun,
  };
  return {
    findById: vi.fn(() => run),
    update: vi.fn((id, params) => ({ ...run, ...params, id })),
    create: vi.fn((params) => ({
      id: 'run-auto-1',
      script_id: params.script_id,
      script_version: params.script_version ?? 1,
      started_at: new Date().toISOString(),
      completed_at: null,
      status: params.status ?? 'running',
      logs: params.logs ?? null,
      screenshot_paths_json: params.screenshot_paths_json ?? null,
      error_message: params.error_message ?? null,
      created_at: new Date().toISOString(),
    })),
    findByScriptId: vi.fn(() => []),
    findLatest: vi.fn(() => null),
    delete: vi.fn(),
  } as unknown as ExecutionRunRepository;
}

function createMockInterventionRepo(): AIInterventionLogRepository {
  const logs: AIInterventionLog[] = [];
  return {
    create: vi.fn((params) => {
      const log: AIInterventionLog = {
        id: 'intervention-' + logs.length,
        execution_run_id: params.execution_run_id,
        diagnosis: params.diagnosis ?? null,
        failure_type: params.failure_type ?? null,
        action_taken: params.action_taken ?? null,
        original_script_snapshot: params.original_script_snapshot ?? null,
        modified_script_snapshot: params.modified_script_snapshot ?? null,
        diagnosis_tokens: params.diagnosis_tokens ?? null,
        outcome: params.outcome ?? null,
        created_at: new Date().toISOString(),
      };
      logs.push(log);
      return log;
    }),
    findById: vi.fn(() => null),
    findByRunId: vi.fn((runId: string) => logs.filter((l) => l.execution_run_id === runId)),
    delete: vi.fn(),
  } as unknown as AIInterventionLogRepository;
}

function createMockScriptRepo(originalContent?: string): ScriptRepository {
  const content = originalContent ?? `import { test, expect } from "@playwright/test";

test("login flow", async ({ page }) => {
  // Step 1: Navigate to login page
  await page.goto("https://example.com/login");

  // Step 2: Fill in credentials
  await page.fill("#username", "testuser");
  await page.fill("#password", "password123");

  // Step 3: Submit form
  await page.click("#submit-btn");

  // Step 4: Wait for dashboard
  await page.waitForSelector("#old-selector");

  // Step 5: Verify welcome message
  const welcome = await page.textContent("#welcome");
  expect(welcome).toBe("Welcome, testuser");

  // Step 6: Check sidebar
  await page.click("#sidebar-toggle");
  await page.waitForSelector("#sidebar-menu");

  // Step 7: Verify menu items
  const menuItems = await page.$$$("#sidebar-menu li");
  expect(menuItems.length).toBe(5);

  // Step 8: Logout
  await page.click("#logout-btn");
  await page.waitForSelector("#login-form");
});`;
  const script: Script = {
    id: 'script-1',
    test_scenario_id: 'scenario-1',
    version: 1,
    content,
    language: 'ts',
    generated_by: 'ai_generated',
    status: 'failed',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  return {
    findById: vi.fn(() => script),
    findLatestByScenarioId: vi.fn(() => script),
    createVersion: vi.fn((_scenarioId: string, newContent: string) => ({
      id: 'script-v2',
      test_scenario_id: 'scenario-1',
      version: 2,
      content: newContent,
      language: 'ts',
      generated_by: 'ai_auto_fix',
      status: 'generated',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
    create: vi.fn(),
    findByScenarioId: vi.fn(() => [script]),
    findByStatus: vi.fn(() => []),
    delete: vi.fn(),
  } as unknown as ScriptRepository;
}

function createMockProxyClient(response?: { text: string; tokenUsage: { promptTokens: number; completionTokens: number } }): ProxyAdapterClient {
  return {
    generateText: vi.fn(() => Promise.resolve({
      text: JSON.stringify({
        failure_type: 'selector',
        direct_cause: 'Selector "#old-selector" not found',
        root_cause: 'Page structure changed',
        fix_suggestion: {
          strategy: 'Update selector',
          changes: [{ location: 'line 3', original: '#old-selector', suggested: '#new-selector' }],
        },
        confidence: 0.85,
      }),
      tokenUsage: { promptTokens: 100, completionTokens: 50 },
      ...response,
    })),
    navigate: vi.fn(),
    getSnapshot: vi.fn(),
    screenshot: vi.fn(),
    getPageInfo: vi.fn(),
    healthCheck: vi.fn(),
    click: vi.fn(),
    clickBySelector: vi.fn(),
    type: vi.fn(),
    executeScript: vi.fn(),
    getCookies: vi.fn(),
    getLocalStorage: vi.fn(),
    getDOM: vi.fn(),
    openBrowser: vi.fn(),
    closeBrowser: vi.fn(),
  } as unknown as ProxyAdapterClient;
}

function createMockPromptManager(): PromptTemplateManager {
  return {
    render: vi.fn((_name: string, _vars: Record<string, string>) => Promise.resolve('rendered prompt')),
    load: vi.fn(() => Promise.resolve('template content')),
    listTemplates: vi.fn(() => Promise.resolve(['failure-diagnosis', 'script-fix'])),
  } as unknown as PromptTemplateManager;
}

// ---------- Import after mocks ----------

const { AIDiagnosisService: ADS } = await import('../ai-diagnosis-service.js');

// ---------- Tests ----------

describe('AIDiagnosisService', () => {
  let service: AIDiagnosisService;
  let proxyClient: ProxyAdapterClient;
  let promptManager: PromptTemplateManager;
  let runRepo: ExecutionRunRepository;
  let interventionRepo: AIInterventionLogRepository;
  let scriptRepo: ScriptRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    proxyClient = createMockProxyClient();
    promptManager = createMockPromptManager();
    runRepo = createMockRunRepo();
    interventionRepo = createMockInterventionRepo();
    scriptRepo = createMockScriptRepo();
    service = new ADS(proxyClient, promptManager, runRepo, interventionRepo, scriptRepo);
  });

  // ===== diagnoseFailure =====

  describe('diagnoseFailure', () => {
    it('should collect context, call AI, and store intervention log', async () => {
      const result = await service.diagnoseFailure('run-1');

      expect(proxyClient.generateText).toHaveBeenCalled();
      expect(interventionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          execution_run_id: 'run-1',
          action_taken: 'diagnose_only',
        }),
      );
      expect(result).toHaveProperty('diagnosis');
    });

    it('should throw if run not found', async () => {
      (runRepo.findById as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
      await expect(service.diagnoseFailure('nonexistent')).rejects.toThrow(/not found/i);
    });

    it('should throw if run has not failed', async () => {
      (runRepo.findById as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        id: 'run-pass', status: 'pass', script_id: 'script-1',
      });
      await expect(service.diagnoseFailure('run-pass')).rejects.toThrow(/not in a failed/i);
    });

    it('diagnoseFailure stores failure_type in intervention log', async () => {
      const result = await service.diagnoseFailure('run-1');

      expect(interventionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          execution_run_id: 'run-1',
          action_taken: 'diagnose_only',
          failure_type: 'selector',
        }),
      );
      expect(result.failureType).toBe('selector');
    });

    it('unrecognized failure_type defaults to unknown', async () => {
      proxyClient = createMockProxyClient({
        text: JSON.stringify({
          failure_type: 'network',
          direct_cause: 'Unexpected upstream issue',
          confidence: 0.42,
        }),
        tokenUsage: { promptTokens: 100, completionTokens: 50 },
      });
      service = new ADS(proxyClient, promptManager, runRepo, interventionRepo, scriptRepo);

      const result = await service.diagnoseFailure('run-1');

      expect(interventionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          execution_run_id: 'run-1',
          failure_type: 'unknown',
        }),
      );
      expect(result.failureType).toBe('unknown');
    });
  });

  // ===== attemptAutoFix =====

  describe('attemptAutoFix', () => {
    it('should apply fix and create new script version when change is <30%', async () => {
      // AI returns a fix that only changes selectors (small diff)
      const fixResponse: { text: string; tokenUsage: { promptTokens: number; completionTokens: number } } = {
        text: `import { test, expect } from "@playwright/test";

test("login flow", async ({ page }) => {
  // Step 1: Navigate to login page
  await page.goto("https://example.com/login");

  // Step 2: Fill in credentials
  await page.fill("#username", "testuser");
  await page.fill("#password", "password123");

  // Step 3: Submit form
  await page.click("#submit-btn");

  // Step 4: Wait for dashboard
  await page.waitForSelector("#new-selector");

  // Step 5: Verify welcome message
  const welcome = await page.textContent("#welcome");
  expect(welcome).toBe("Welcome, testuser");

  // Step 6: Check sidebar
  await page.click("#sidebar-toggle");
  await page.waitForSelector("#sidebar-menu");

  // Step 7: Verify menu items
  const menuItems = await page.$$$("#sidebar-menu li");
  expect(menuItems.length).toBe(5);

  // Step 8: Logout
  await page.click("#logout-btn");
  await page.waitForSelector("#login-form");
});`,
      };
      const fixClient = createMockProxyClient(fixResponse);
      service = new ADS(fixClient, promptManager, runRepo, interventionRepo, scriptRepo);

      // Provide a prior diagnosis log
      (interventionRepo.findByRunId as ReturnType<typeof vi.fn>).mockReturnValueOnce([
        {
          id: 'int-prev',
          execution_run_id: 'run-1',
          diagnosis: '{"failure_type":"selector"}',
          action_taken: 'diagnose_only',
        },
      ]);

      const result = await service.attemptAutoFix('run-1');

      expect(scriptRepo.createVersion).toHaveBeenCalled();
      expect(interventionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action_taken: 'auto_fix_applied',
        }),
      );
      expect(result).toHaveProperty('newScriptVersion');
    });

    it('should request human review when change is >=30%', async () => {
      // AI returns a drastically different script (>=30% line change)
      const bigChangeResponse: { text: string; tokenUsage: { promptTokens: number; completionTokens: number } } = {
        text: `import { test } from "playwright";
// This is a completely rewritten script
test("completely new test", async ({ page }) => {
  await page.goto("https://example.com");
  await page.waitForLoadState("networkidle");
  const title = await page.title();
  expect(title).toContain("Example");
  // Many new lines added here
  // Line 7
  // Line 8
  // Line 9
  // Line 10
  // Line 11
  // Line 12
});`,
      };
      const bigChangeClient = createMockProxyClient(bigChangeResponse);
      service = new ADS(bigChangeClient, promptManager, runRepo, interventionRepo, scriptRepo);

      // Provide a prior diagnosis log
      (interventionRepo.findByRunId as ReturnType<typeof vi.fn>).mockReturnValueOnce([
        {
          id: 'int-prev',
          execution_run_id: 'run-1',
          diagnosis: '{"failure_type":"selector"}',
          action_taken: 'diagnose_only',
        },
      ]);

      const result = await service.attemptAutoFix('run-1');

      expect(result).toHaveProperty('status', 'pending_human_review');
      expect(interventionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action_taken: 'pending_human_review',
        }),
      );
    });

    it('should request human review when max retries exceeded', async () => {
      // Simulate 3 previous auto-fix attempts
      (interventionRepo.findByRunId as ReturnType<typeof vi.fn>).mockReturnValueOnce([
        { action_taken: 'auto_fix_applied' },
        { action_taken: 'auto_fix_applied' },
        { action_taken: 'auto_fix_applied' },
      ]);

      const result = await service.attemptAutoFix('run-1');

      expect(result).toHaveProperty('status', 'max_retries_exceeded');
      expect(interventionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action_taken: 'pending_human_review',
        }),
      );
    });

    it('should throw if no prior diagnosis exists', async () => {
      (interventionRepo.findByRunId as ReturnType<typeof vi.fn>).mockReturnValueOnce([]);
      await expect(service.attemptAutoFix('run-1')).rejects.toThrow(/diagnos/i);
    });
  });

  // ===== requestHumanReview =====

  describe('requestHumanReview', () => {
    it('should set script status to pending_review and create log', () => {
      service.requestHumanReview('run-1');

      expect(interventionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          execution_run_id: 'run-1',
          action_taken: 'pending_human_review',
        }),
      );
    });
  });

  // ===== getDiagnosisHistory =====

  describe('getDiagnosisHistory', () => {
    it('should return intervention logs for the run', () => {
      const mockLogs: AIInterventionLog[] = [
        {
          id: 'int-1',
          execution_run_id: 'run-1',
          diagnosis: 'Selector outdated',
          failure_type: 'selector',
          action_taken: 'diagnose_only',
          original_script_snapshot: null,
          modified_script_snapshot: null,
          diagnosis_tokens: 150,
          outcome: null,
          created_at: new Date().toISOString(),
        },
      ];
      (interventionRepo.findByRunId as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockLogs);

      const history = service.getDiagnosisHistory('run-1');
      expect(history).toEqual(mockLogs);
    });
  });
});
