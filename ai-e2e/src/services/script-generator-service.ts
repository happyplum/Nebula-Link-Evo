/**
 * Script Generator Service (Mode 3)
 *
 * Orchestrates AI-driven Playwright script generation:
 * - Load test scenario + URL page snapshot
 * - Render prompt templates → AI generates Playwright script
 * - Syntax validation with retry
 * - Version management (each edit creates a new version)
 */

import type { AIProvider } from '../ai/provider.js';
import type { PromptTemplateManager } from '../ai/prompt-manager.js';
import type { ScriptRepository, Script } from '../database/repositories/script-repository.js';
import type { TestScenarioRepository } from '../database/repositories/test-scenario-repository.js';
import type { URLRepository } from '../database/repositories/url-repository.js';
import type { URLModuleBindingRepository } from '../database/repositories/url-module-binding-repository.js';

// ---------- types ----------

export interface ScriptGeneratorDeps {
  aiProvider: AIProvider;
  promptManager: PromptTemplateManager;
  scriptRepo: ScriptRepository;
  scenarioRepo: TestScenarioRepository;
  urlRepo: URLRepository;
  urlBindingRepo: URLModuleBindingRepository;
}

export interface SyntaxValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------- constants ----------

const MAX_GENERATION_ATTEMPTS = 3;
const SCRIPT_GENERATION_TEMPLATE = 'script-generation';
const TEST_DATA_GENERATION_TEMPLATE = 'test-data-generation';

// ---------- service ----------

export class ScriptGeneratorService {
  private readonly aiProvider: AIProvider;
  private readonly promptManager: PromptTemplateManager;
  private readonly scriptRepo: ScriptRepository;
  private readonly scenarioRepo: TestScenarioRepository;
  private readonly urlRepo: URLRepository;
  private readonly urlBindingRepo: URLModuleBindingRepository;

  constructor(deps: ScriptGeneratorDeps) {
    this.aiProvider = deps.aiProvider;
    this.promptManager = deps.promptManager;
    this.scriptRepo = deps.scriptRepo;
    this.scenarioRepo = deps.scenarioRepo;
    this.urlRepo = deps.urlRepo;
    this.urlBindingRepo = deps.urlBindingRepo;
  }

  /**
   * Generate a Playwright test script for a test scenario.
   *
   * Flow: load scenario → find URL snapshot → render prompt → AI generate →
   *       validate syntax (retry up to MAX_GENERATION_ATTEMPTS) → store version 1
   */
  async generateScript(scenarioId: string): Promise<Script> {
    const { scenario, pageUrl, pageSnapshot, testData } = await this.loadScenarioContext(scenarioId);

    const prompt = await this.promptManager.render(SCRIPT_GENERATION_TEMPLATE, {
      scenario_name: scenario.name,
      scenario_description: scenario.description ?? '',
      page_url: pageUrl,
      page_snapshot: pageSnapshot,
      test_data: testData,
    });

    let lastErrors: string[] = [];
    let currentPrompt = prompt;

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      const { text } = await this.aiProvider.generateText(currentPrompt, { temperature: 0.3 });
      const validation = this.validateScriptSyntax(text);

      if (validation.valid) {
        return this.scriptRepo.createVersion(scenarioId, text, 'ai_generated');
      }

      lastErrors = validation.errors;
      // Feed errors back to AI for retry
      currentPrompt =
        `${prompt}\n\n## Previous Attempt Errors\n\n` +
        `The previous generated script had the following syntax errors:\n` +
        lastErrors.map(e => `- ${e}`).join('\n') +
        '\n\nPlease fix these errors and generate a corrected complete script.';
    }

    throw new Error(
      `Failed to generate valid script after ${MAX_GENERATION_ATTEMPTS} attempts. ` +
      `Last errors: ${lastErrors.join('; ')}`,
    );
  }

  /**
   * Generate test data JSON for a test scenario.
   *
   * Returns parsed JSON from AI response.
   */
  async generateTestData(scenarioId: string): Promise<Record<string, unknown>> {
    const { scenario, pageSnapshot } = await this.loadScenarioContext(scenarioId);

    const prompt = await this.promptManager.render(TEST_DATA_GENERATION_TEMPLATE, {
      scenario_name: scenario.name,
      scenario_description: scenario.description ?? '',
      page_fields: pageSnapshot,
    });

    const { text } = await this.aiProvider.generateText(prompt, { temperature: 0.3 });

    return this.extractJSON(text);
  }

  /**
   * Re-generate a script from the same scenario context.
   *
   * Creates a new version (does not overwrite the existing one).
   */
  async regenerateScript(scriptId: string): Promise<Script> {
    const existingScript = this.scriptRepo.findById(scriptId);
    if (!existingScript) {
      throw new Error(`Script not found: ${scriptId}`);
    }

    return this.generateScript(existingScript.test_scenario_id);
  }

  /**
   * Save a human-edited version of a script.
   *
   * Validates syntax before saving. Creates a new version with generated_by='human_edited'.
   */
  async saveEditedScript(scriptId: string, newContent: string): Promise<Script> {
    const existingScript = this.scriptRepo.findById(scriptId);
    if (!existingScript) {
      throw new Error(`Script not found: ${scriptId}`);
    }

    const validation = this.validateScriptSyntax(newContent);
    if (!validation.valid) {
      throw new Error(`Script syntax validation failed: ${validation.errors.join('; ')}`);
    }

    return this.scriptRepo.createVersion(existingScript.test_scenario_id, newContent, 'human_edited');
  }

  /**
   * List all script versions for a scenario (newest first).
   */
  async getScriptHistory(scenarioId: string): Promise<Script[]> {
    return this.scriptRepo.findByScenarioId(scenarioId);
  }

  /**
   * Validate Playwright script syntax using structural checks.
   *
   * Checks:
   * - Import statement for playwright
   * - test() block presence
   * - Balanced braces
   */
  validateScriptSyntax(content: string): SyntaxValidationResult {
    const errors: string[] = [];

    // Check for Playwright import
    const hasImport = /import\s*{[^}]*}\s*from\s*['"]@playwright\/test['"]/.test(content)
      || /import\s*\w+\s*from\s*['"]playwright['"]/.test(content);
    if (!hasImport) {
      errors.push('Missing required import: must include `import { ... } from \'@playwright/test\'` or `import { chromium } from \'playwright\'`');
    }

    // Check for test() block (exclude lines that are import statements)
    const nonImportLines = content.split('\n').filter(line => !line.trimStart().startsWith('import ')).join('\n');
    const hasTestBlock = /(?:^|\s)test\s*[\('"]/.test(nonImportLines);
    if (!hasTestBlock) {
      errors.push('Missing test block: must contain at least one `test(...)` call');
    }

    // Check balanced braces
    const openBraces = (content.match(/{/g) ?? []).length;
    const closeBraces = (content.match(/}/g) ?? []).length;
    if (openBraces !== closeBraces) {
      errors.push(`Unbalanced braces: ${openBraces} opening vs ${closeBraces} closing`);
    }

    // Check balanced parentheses
    const openParens = (content.match(/\(/g) ?? []).length;
    const closeParens = (content.match(/\)/g) ?? []).length;
    if (openParens !== closeParens) {
      errors.push(`Unbalanced parentheses: ${openParens} opening vs ${closeParens} closing`);
    }

    return { valid: errors.length === 0, errors };
  }

  // ---------- private helpers ----------

  /**
   * Load scenario + associated URL page snapshot and test data.
   */
  private async loadScenarioContext(scenarioId: string): Promise<{
    scenario: NonNullable<ReturnType<TestScenarioRepository['findById']>>;
    pageUrl: string;
    pageSnapshot: string;
    testData: string;
  }> {
    const scenario = this.scenarioRepo.findById(scenarioId);
    if (!scenario) {
      throw new Error(`Test scenario not found: ${scenarioId}`);
    }

    // Find URL bound to this scenario's functional module
    const bindings = this.urlBindingRepo.findByModuleId(scenario.functional_module_id);
    if (bindings.length === 0) {
      throw new Error(`No URL bindings found for functional module: ${scenario.functional_module_id}`);
    }

    const urlRecord = this.urlRepo.findById(bindings[0].url_id);
    if (!urlRecord) {
      throw new Error(`URL record not found for binding: ${bindings[0].url_id}`);
    }

    return {
      scenario,
      pageUrl: urlRecord.url,
      pageSnapshot: urlRecord.page_snapshot_json ?? '',
      testData: scenario.test_data_json ?? 'No test data provided.',
    };
  }

  /**
   * Extract JSON from AI response, handling markdown code fences.
   */
  private extractJSON(text: string): Record<string, unknown> {
    // Strip markdown code fence if present
    let jsonText = text.trim();
    const codeFenceMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeFenceMatch) {
      jsonText = codeFenceMatch[1].trim();
    }

    try {
      return JSON.parse(jsonText) as Record<string, unknown>;
    } catch {
      throw new Error(`Failed to parse test data from AI response: ${text.slice(0, 200)}`);
    }
  }
}
