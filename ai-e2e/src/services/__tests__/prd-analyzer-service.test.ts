import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PRDAnalyzerService } from '../prd-analyzer-service.js';
import { DatabaseManager } from '../../database/db.js';
import { PromptTemplateManager } from '../../ai/prompt-manager.js';
import { TokenBudgetTracker } from '../../ai/token-tracker.js';
import type { ProxyAdapterClient } from '../../infrastructure/proxy-adapter-client.js';

// ---------- Mock ProxyAdapterClient ----------

const mockGenerateText = vi.fn();

function createMockProxyClient(): ProxyAdapterClient {
  return {
    generateText: mockGenerateText,
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

// ---------- Helpers ----------

const PROMPTS_DIR = 'prompts';

function seedProject(projectId: string): void {
  const db = DatabaseManager.getInstance();
  db.getDatabase().prepare(
    'INSERT OR IGNORE INTO projects (id, name, status) VALUES (?, ?, ?)',
  ).run(projectId, `Project ${projectId}`, 'draft');
}

function createService(): PRDAnalyzerService {
  const proxyClient = createMockProxyClient();
  const promptManager = new PromptTemplateManager(PROMPTS_DIR);
  const tokenTracker = new TokenBudgetTracker(100000);
  const db = DatabaseManager.getInstance();
  db.init();
  seedProject('proj-1');
  seedProject('proj-2');
  seedProject('proj-3');
  return new PRDAnalyzerService(proxyClient, promptManager, tokenTracker, db);
}

// ---------- Sample Data ----------

const SAMPLE_PRD = `# 电商平台 PRD

## 用户管理
用户注册、登录、个人中心管理。

## 商品管理
商品列表、搜索、详情页、分类浏览。

## 购物车与订单
购物车操作、下单、支付、订单管理。
`;

const L1_AI_RESPONSE = JSON.stringify([
  { name: '用户管理', description: '用户注册、登录和个人信息管理功能' },
  { name: '商品管理', description: '商品浏览、搜索和分类展示功能' },
  { name: '购物车与订单', description: '购物车操作、下单和订单管理功能' },
]);

const L2_AI_RESPONSE = JSON.stringify([
  { name: '用户注册', description: '新用户注册账号功能', pages: ['/register'], key_elements: ['注册表单', '验证码'] },
  { name: '用户登录', description: '用户登录系统功能', pages: ['/login'], key_elements: ['登录表单', '记住我'] },
]);

const SCENARIO_AI_RESPONSE = JSON.stringify([
  {
    name: '正常注册流程',
    description: '使用有效信息完成注册',
    preconditions: ['注册页面已打开'],
    expected_results: ['注册成功', '跳转到首页'],
  },
  {
    name: '重复邮箱注册',
    description: '使用已注册的邮箱再次注册',
    preconditions: ['该邮箱已被注册'],
    expected_results: ['提示邮箱已存在', '注册失败'],
  },
]);

// ---------- Tests ----------

describe('PRDAnalyzerService', () => {
  let service: PRDAnalyzerService;

  beforeEach(() => {
    vi.clearAllMocks();
    DatabaseManager.resetInstance();
    service = createService();
  });

  afterEach(() => {
    DatabaseManager.resetInstance();
  });

  // ===== analyzePRD =====

  describe('analyzePRD', () => {
    it('should store raw PRD and return L1 business modules', async () => {
      mockGenerateText.mockResolvedValue({
        text: L1_AI_RESPONSE,
        tokenUsage: { promptTokens: 100, completionTokens: 50 },
      });

      const result = await service.analyzePRD('proj-1', SAMPLE_PRD, 'markdown');

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('用户管理');
      expect(result[0].project_id).toBe('proj-1');
      expect(result[0].source).toBe('ai_generated');
      expect(result[1].name).toBe('商品管理');
      expect(result[2].name).toBe('购物车与订单');
    });

    it('should track token usage for analysis', async () => {
      mockGenerateText.mockResolvedValue({
        text: L1_AI_RESPONSE,
        tokenUsage: { promptTokens: 200, completionTokens: 80 },
      });

      await service.analyzePRD('proj-1', SAMPLE_PRD);

      const usage = service.getTokenTracker().getUsageByCategory('prd-analysis');
      expect(usage).toBeDefined();
      expect(usage!.prompt).toBe(200);
      expect(usage!.completion).toBe(80);
    });

    it('should store parsed content in PRDDocument', async () => {
      mockGenerateText.mockResolvedValue({
        text: L1_AI_RESPONSE,
        tokenUsage: { promptTokens: 50, completionTokens: 20 },
      });

      await service.analyzePRD('proj-1', SAMPLE_PRD, 'markdown');

      const db = DatabaseManager.getInstance();
      const docs = db.getPRDDocumentRepo().findByProjectId('proj-1');
      expect(docs).toHaveLength(1);
      expect(docs[0].raw_content).toBe(SAMPLE_PRD);
      expect(docs[0].format).toBe('markdown');
      expect(docs[0].parsed_content_json).toBe(L1_AI_RESPONSE);
    });

    it('should throw on empty PRD content', async () => {
      await expect(service.analyzePRD('proj-1', '')).rejects.toThrow('PRD content cannot be empty');
      await expect(service.analyzePRD('proj-1', '   ')).rejects.toThrow('PRD content cannot be empty');
    });

    it('should truncate long PRD and include warning', async () => {
      const longPRD = 'x'.repeat(60001);
      mockGenerateText.mockResolvedValue({
        text: L1_AI_RESPONSE,
        tokenUsage: { promptTokens: 100, completionTokens: 50 },
      });

      const result = await service.analyzePRD('proj-1', longPRD);

      // Should have called AI with truncated content
      expect(mockGenerateText).toHaveBeenCalledTimes(1);
      const calledPrompt = mockGenerateText.mock.calls[0][0] as string;
      // The rendered prompt should not contain the full 60001 chars of raw PRD
      expect(calledPrompt.length).toBeLessThan(longPRD.length);
      expect(result).toBeDefined();
    });

    it('should throw on malformed AI response', async () => {
      mockGenerateText.mockResolvedValue({
        text: 'this is not valid JSON at all',
        tokenUsage: { promptTokens: 10, completionTokens: 5 },
      });

      await expect(service.analyzePRD('proj-1', SAMPLE_PRD)).rejects.toThrow();
    });

    it('should throw on AI response that is not an array', async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ error: 'bad format' }),
        tokenUsage: { promptTokens: 10, completionTokens: 5 },
      });

      await expect(service.analyzePRD('proj-1', SAMPLE_PRD)).rejects.toThrow();
    });

    it('should assign incrementing sort_order to modules', async () => {
      mockGenerateText.mockResolvedValue({
        text: L1_AI_RESPONSE,
        tokenUsage: { promptTokens: 100, completionTokens: 50 },
      });

      const result = await service.analyzePRD('proj-1', SAMPLE_PRD);

      expect(result[0].sort_order).toBe(0);
      expect(result[1].sort_order).toBe(1);
      expect(result[2].sort_order).toBe(2);
    });
  });

  // ===== decomposeBusinessModule =====

  describe('decomposeBusinessModule', () => {
    it('should decompose L1 into L2 functional modules', async () => {
      // First create L1 modules via analyzePRD
      mockGenerateText.mockResolvedValue({
        text: L1_AI_RESPONSE,
        tokenUsage: { promptTokens: 100, completionTokens: 50 },
      });
      const l1Modules = await service.analyzePRD('proj-1', SAMPLE_PRD);

      // Now decompose the first module
      mockGenerateText.mockResolvedValue({
        text: L2_AI_RESPONSE,
        tokenUsage: { promptTokens: 150, completionTokens: 60 },
      });

      const l2Modules = await service.decomposeBusinessModule('proj-1', l1Modules[0].id);

      expect(l2Modules).toHaveLength(2);
      expect(l2Modules[0].name).toBe('用户注册');
      expect(l2Modules[0].business_module_id).toBe(l1Modules[0].id);
      expect(l2Modules[0].source).toBe('ai_generated');
      expect(l2Modules[1].name).toBe('用户登录');
    });

    it('should throw on non-existent business module', async () => {
      await expect(
        service.decomposeBusinessModule('proj-1', 'non-existent-id'),
      ).rejects.toThrow(/not found/i);
    });

    it('should track token usage for decomposition', async () => {
      mockGenerateText.mockResolvedValue({
        text: L1_AI_RESPONSE,
        tokenUsage: { promptTokens: 100, completionTokens: 50 },
      });
      const l1Modules = await service.analyzePRD('proj-1', SAMPLE_PRD);

      mockGenerateText.mockResolvedValue({
        text: L2_AI_RESPONSE,
        tokenUsage: { promptTokens: 150, completionTokens: 60 },
      });
      await service.decomposeBusinessModule('proj-1', l1Modules[0].id);

      const usage = service.getTokenTracker().getUsageByCategory('prd-decomposition');
      expect(usage).toBeDefined();
      expect(usage!.prompt).toBe(150);
      expect(usage!.completion).toBe(60);
    });

    it('should throw on malformed AI response for decomposition', async () => {
      mockGenerateText.mockResolvedValue({
        text: L1_AI_RESPONSE,
        tokenUsage: { promptTokens: 100, completionTokens: 50 },
      });
      const l1Modules = await service.analyzePRD('proj-1', SAMPLE_PRD);

      mockGenerateText.mockResolvedValue({
        text: 'not json',
        tokenUsage: { promptTokens: 10, completionTokens: 5 },
      });

      await expect(
        service.decomposeBusinessModule('proj-1', l1Modules[0].id),
      ).rejects.toThrow();
    });
  });

  // ===== generateTestScenarios =====

  describe('generateTestScenarios', () => {
    it('should generate test scenarios for a functional module', async () => {
      // Setup: create L1 + L2
      mockGenerateText.mockResolvedValue({
        text: L1_AI_RESPONSE,
        tokenUsage: { promptTokens: 100, completionTokens: 50 },
      });
      const l1Modules = await service.analyzePRD('proj-1', SAMPLE_PRD);

      mockGenerateText.mockResolvedValue({
        text: L2_AI_RESPONSE,
        tokenUsage: { promptTokens: 150, completionTokens: 60 },
      });
      const l2Modules = await service.decomposeBusinessModule('proj-1', l1Modules[0].id);

      // Generate scenarios
      mockGenerateText.mockResolvedValue({
        text: SCENARIO_AI_RESPONSE,
        tokenUsage: { promptTokens: 200, completionTokens: 70 },
      });

      const scenarios = await service.generateTestScenarios('proj-1', l2Modules[0].id);

      expect(scenarios).toHaveLength(2);
      expect(scenarios[0].name).toBe('正常注册流程');
      expect(scenarios[0].functional_module_id).toBe(l2Modules[0].id);
      expect(scenarios[0].source).toBe('ai_generated');
    });

    it('should throw on non-existent functional module', async () => {
      await expect(
        service.generateTestScenarios('proj-1', 'non-existent-id'),
      ).rejects.toThrow(/not found/i);
    });

    it('should track token usage for scenario generation', async () => {
      mockGenerateText.mockResolvedValue({
        text: L1_AI_RESPONSE,
        tokenUsage: { promptTokens: 100, completionTokens: 50 },
      });
      const l1Modules = await service.analyzePRD('proj-1', SAMPLE_PRD);

      mockGenerateText.mockResolvedValue({
        text: L2_AI_RESPONSE,
        tokenUsage: { promptTokens: 150, completionTokens: 60 },
      });
      const l2Modules = await service.decomposeBusinessModule('proj-1', l1Modules[0].id);

      mockGenerateText.mockResolvedValue({
        text: SCENARIO_AI_RESPONSE,
        tokenUsage: { promptTokens: 200, completionTokens: 70 },
      });
      await service.generateTestScenarios('proj-1', l2Modules[0].id);

      const usage = service.getTokenTracker().getUsageByCategory('test-scenario-generation');
      expect(usage).toBeDefined();
      expect(usage!.prompt).toBe(200);
      expect(usage!.completion).toBe(70);
    });
  });

  // ===== getAnalysisResult =====

  describe('getAnalysisResult', () => {
    it('should return the full analysis tree', async () => {
      // Full pipeline: PRD → L1 → L2 → scenarios
      mockGenerateText.mockResolvedValue({
        text: L1_AI_RESPONSE,
        tokenUsage: { promptTokens: 100, completionTokens: 50 },
      });
      const l1Modules = await service.analyzePRD('proj-1', SAMPLE_PRD);

      mockGenerateText.mockResolvedValue({
        text: L2_AI_RESPONSE,
        tokenUsage: { promptTokens: 150, completionTokens: 60 },
      });
      await service.decomposeBusinessModule('proj-1', l1Modules[0].id);

      mockGenerateText.mockResolvedValue({
        text: SCENARIO_AI_RESPONSE,
        tokenUsage: { promptTokens: 200, completionTokens: 70 },
      });
      const l2Modules = await service.getFunctionalModules(l1Modules[0].id);
      await service.generateTestScenarios('proj-1', l2Modules[0].id);

      const tree = service.getAnalysisResult('proj-1');

      expect(tree.businessModules).toHaveLength(3);
      expect(tree.businessModules[0].name).toBe('用户管理');
      // First L1 should have 2 L2 children
      const firstL1 = tree.businessModules[0];
      expect(firstL1.functionalModules).toHaveLength(2);
      expect(firstL1.functionalModules[0].testScenarios).toHaveLength(2);
      // Other L1 modules have no L2 yet
      expect(tree.businessModules[1].functionalModules).toHaveLength(0);
    });

    it('should return empty arrays for project with no analysis', () => {
      const tree = service.getAnalysisResult('empty-proj');
      expect(tree.businessModules).toHaveLength(0);
    });
  });

  // ===== JSON extraction robustness =====

  describe('AI response parsing', () => {
    it('should extract JSON from markdown code block', async () => {
      mockGenerateText.mockResolvedValue({
        text: 'Here is the analysis:\n```json\n' + L1_AI_RESPONSE + '\n```\nDone.',
        tokenUsage: { promptTokens: 100, completionTokens: 50 },
      });

      const result = await service.analyzePRD('proj-2', SAMPLE_PRD);
      expect(result).toHaveLength(3);
    });

    it('should throw on AI response with invalid module structure', async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify([{ foo: 'bar' }]),
        tokenUsage: { promptTokens: 10, completionTokens: 5 },
      });

      await expect(service.analyzePRD('proj-3', SAMPLE_PRD)).rejects.toThrow();
    });
  });
});
