import type { AIProvider } from '../ai/provider.js';
import type { PromptTemplateManager } from '../ai/prompt-manager.js';
import type { TokenBudgetTracker } from '../ai/token-tracker.js';
import type { DatabaseManager } from '../database/db.js';
import type { BusinessModule as DBBusinessModule } from '../database/repositories/business-module-repository.js';
import type { FunctionalModule as DBFunctionalModule } from '../database/repositories/functional-module-repository.js';
import type { TestScenario as DBTestScenario } from '../database/repositories/test-scenario-repository.js';

// ---------- Constants ----------

const MAX_PRD_LENGTH = 50000;
const AI_RESPONSE_FORMAT = `返回 JSON 数组，每个元素包含：
\`\`\`json
[
  {
    "name": "业务模块名称",
    "description": "模块描述"
  }
]
\`\`\``;

// ---------- Types ----------

interface L1ModuleAIResponse {
  name: string;
  description: string;
}

interface L2ModuleAIResponse {
  name: string;
  description: string;
  pages?: string[];
  key_elements?: string[];
}

interface TestScenarioAIResponse {
  name: string;
  description: string;
  preconditions?: string[];
  expected_results?: string[];
}

export interface FunctionalModuleWithScenarios extends DBFunctionalModule {
  testScenarios: DBTestScenario[];
}

export interface BusinessModuleTree extends DBBusinessModule {
  functionalModules: FunctionalModuleWithScenarios[];
}

export interface AnalysisResult {
  businessModules: BusinessModuleTree[];
}

// ---------- Service ----------

export class PRDAnalyzerService {
  constructor(
    private readonly provider: AIProvider,
    private readonly promptManager: PromptTemplateManager,
    private readonly tokenTracker: TokenBudgetTracker,
    private readonly db: DatabaseManager,
  ) {}

  getTokenTracker(): TokenBudgetTracker {
    return this.tokenTracker;
  }

  /**
   * Analyze a PRD document: store raw content, call AI, store L1 business modules.
   */
  async analyzePRD(
    projectId: string,
    content: string,
    format: string = 'markdown',
  ): Promise<DBBusinessModule[]> {
    // Validate content
    if (!content || content.trim().length === 0) {
      throw new Error('PRD content cannot be empty');
    }

    // Truncate if needed
    let prdContent = content;
    if (content.length > MAX_PRD_LENGTH) {
      prdContent = content.substring(0, MAX_PRD_LENGTH) + '\n\n[WARNING: PRD content truncated at ' + MAX_PRD_LENGTH + ' characters]';
    }

    // Store raw PRD document
    const prdRepo = this.db.getPRDDocumentRepo();
    prdRepo.create({
      project_id: projectId,
      raw_content: content,
      format,
    });

    // Render prompt and call AI
    const prompt = await this.promptManager.render('prd-analysis', {
      prd_content: prdContent,
      format: AI_RESPONSE_FORMAT,
    });

    const result = await this.provider.generateText(prompt);

    // Track token usage
    this.tokenTracker.record('prd-analysis', result.tokenUsage.promptTokens, result.tokenUsage.completionTokens);

    // Parse and validate AI response
    const modules = this.parseAIResponse<L1ModuleAIResponse>(result.text);

    // Validate structure
    for (const mod of modules) {
      if (!mod.name || typeof mod.name !== 'string') {
        throw new Error(`Invalid AI response: module missing "name" field. Got: ${JSON.stringify(mod)}`);
      }
      if (!mod.description || typeof mod.description !== 'string') {
        throw new Error(`Invalid AI response: module missing "description" field. Got: ${JSON.stringify(mod)}`);
      }
    }

    // Store L1 business modules
    const businessModuleRepo = this.db.getBusinessModuleRepo();
    const createdModules: DBBusinessModule[] = [];

    for (let i = 0; i < modules.length; i++) {
      const mod = modules[i];
      const created = businessModuleRepo.create({
        project_id: projectId,
        name: mod.name,
        description: mod.description,
        sort_order: i,
        source: 'ai_generated',
      });
      createdModules.push(created);
    }

    // Update PRD document with parsed content and AI metadata
    const docs = prdRepo.findByProjectId(projectId);
    if (docs.length > 0) {
      prdRepo.update(docs[0].id, {
        parsed_content_json: JSON.stringify(modules),
        ai_model_used: 'ai',
        token_count: result.tokenUsage.promptTokens + result.tokenUsage.completionTokens,
      });
    }

    return createdModules;
  }

  /**
   * Decompose an L1 business module into L2 functional modules via AI.
   */
  async decomposeBusinessModule(
    projectId: string,
    businessModuleId: string,
  ): Promise<DBFunctionalModule[]> {
    // Look up the business module
    const businessModuleRepo = this.db.getBusinessModuleRepo();
    const businessModule = businessModuleRepo.findById(businessModuleId);
    if (!businessModule) {
      throw new Error(`Business module not found: ${businessModuleId}`);
    }

    // Get PRD context for this project
    const prdRepo = this.db.getPRDDocumentRepo();
    const prdDocs = prdRepo.findByProjectId(projectId);
    const prdContext = prdDocs.length > 0 ? prdDocs[0].raw_content : '';

    // Render decomposition prompt
    const prompt = await this.promptManager.render('prd-decomposition', {
      business_module_name: businessModule.name,
      business_module_description: businessModule.description ?? '',
      prd_context: prdContext,
    });

    const result = await this.provider.generateText(prompt);

    // Track token usage
    this.tokenTracker.record('prd-decomposition', result.tokenUsage.promptTokens, result.tokenUsage.completionTokens);

    // Parse and validate
    const modules = this.parseAIResponse<L2ModuleAIResponse>(result.text);

    // Store L2 functional modules
    const functionalModuleRepo = this.db.getFunctionalModuleRepo();
    const createdModules: DBFunctionalModule[] = [];

    for (let i = 0; i < modules.length; i++) {
      const mod = modules[i];
      const created = functionalModuleRepo.create({
        business_module_id: businessModuleId,
        name: mod.name,
        description: mod.description,
        sort_order: i,
        source: 'ai_generated',
      });
      createdModules.push(created);
    }

    return createdModules;
  }

  /**
   * Generate test scenarios for an L2 functional module via AI.
   */
  async generateTestScenarios(
    projectId: string,
    functionalModuleId: string,
  ): Promise<DBTestScenario[]> {
    // Look up the functional module
    const functionalModuleRepo = this.db.getFunctionalModuleRepo();
    const functionalModule = functionalModuleRepo.findById(functionalModuleId);
    if (!functionalModule) {
      throw new Error(`Functional module not found: ${functionalModuleId}`);
    }

    // Get business context: find parent business module name
    const businessModuleRepo = this.db.getBusinessModuleRepo();
    const businessModule = businessModuleRepo.findById(functionalModule.business_module_id);
    const businessContext = businessModule
      ? `${businessModule.name}: ${businessModule.description ?? ''}`
      : '';

    // Render test scenario prompt
    const prompt = await this.promptManager.render('test-scenario-generation', {
      functional_module_name: functionalModule.name,
      functional_module_description: functionalModule.description ?? '',
      business_context: businessContext,
    });

    const result = await this.provider.generateText(prompt);

    // Track token usage
    this.tokenTracker.record('test-scenario-generation', result.tokenUsage.promptTokens, result.tokenUsage.completionTokens);

    // Parse and validate
    const scenarios = this.parseAIResponse<TestScenarioAIResponse>(result.text);

    // Store test scenarios
    const testScenarioRepo = this.db.getTestScenarioRepo();
    const createdScenarios: DBTestScenario[] = [];

    for (let i = 0; i < scenarios.length; i++) {
      const scenario = scenarios[i];
      const testData = {
        preconditions: scenario.preconditions ?? [],
        expected_results: scenario.expected_results ?? [],
      };
      const created = testScenarioRepo.create({
        functional_module_id: functionalModuleId,
        name: scenario.name,
        description: scenario.description,
        test_data_json: JSON.stringify(testData),
        sort_order: i,
        source: 'ai_generated',
      });
      createdScenarios.push(created);
    }

    return createdScenarios;
  }

  /**
   * Get the full analysis tree for a project: L1 → L2 → scenarios.
   */
  getAnalysisResult(projectId: string): AnalysisResult {
    const businessModuleRepo = this.db.getBusinessModuleRepo();
    const functionalModuleRepo = this.db.getFunctionalModuleRepo();
    const testScenarioRepo = this.db.getTestScenarioRepo();

    const businessModules = businessModuleRepo.findByProjectId(projectId);

    const tree: BusinessModuleTree[] = businessModules.map((bm) => {
      const functionalModules = functionalModuleRepo.findByBusinessModuleId(bm.id);

      const fmsWithScenarios: FunctionalModuleWithScenarios[] = functionalModules.map((fm) => {
        const testScenarios = testScenarioRepo.findByFunctionalModuleId(fm.id);
        return { ...fm, testScenarios };
      });

      return { ...bm, functionalModules: fmsWithScenarios };
    });

    return { businessModules: tree };
  }

  /**
   * Get functional modules for a business module (helper for tests).
   */
  getFunctionalModules(businessModuleId: string): DBFunctionalModule[] {
    return this.db.getFunctionalModuleRepo().findByBusinessModuleId(businessModuleId);
  }

  // ---------- Private helpers ----------

  /**
   * Parse AI response text into a JSON array, handling markdown code blocks.
   */
  private parseAIResponse<T>(text: string): T[] {
    // Try to extract JSON from markdown code block
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new Error(`Failed to parse AI response as JSON: ${jsonStr.substring(0, 200)}`);
    }

    if (!Array.isArray(parsed)) {
      throw new Error(`Expected AI response to be a JSON array, got: ${typeof parsed}`);
    }

    return parsed as T[];
  }
}
