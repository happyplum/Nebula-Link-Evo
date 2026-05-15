/**
 * AI Diagnosis Service
 *
 * Handles failure diagnosis, auto-fix with safety thresholds, and human review
 * escalation for failed script executions.
 *
 * Safety thresholds:
 * - Line diff: if ≥30% lines changed → pending_human_review
 * - Max retries: 3 auto-fix attempts per execution
 * - Auto-fix only allowed for: selectors, wait strategies, assertion values
 */
import type { ProxyAdapterClient } from '../infrastructure/proxy-adapter-client.js';
import type { PromptTemplateManager } from '../ai/prompt-manager.js';
import type { ExecutionRunRepository, ExecutionRun } from '../database/repositories/execution-run-repository.js';
import type { AIInterventionLogRepository, AIInterventionLog } from '../database/repositories/ai-intervention-log-repository.js';
import type { BusinessModuleRepository } from '../database/repositories/business-module-repository.js';
import type { FunctionalModuleRepository } from '../database/repositories/functional-module-repository.js';
import type { TestScenarioRepository } from '../database/repositories/test-scenario-repository.js';
import type { ScriptRepository, Script } from '../database/repositories/script-repository.js';
import {
  FailureType,
  type FailureType as FailureTypeValue,
  type ProjectDiagnosisReport,
} from '../types/ai-intervention.js';

/** Maximum number of auto-fix retries per execution */
const MAX_AUTO_FIX_RETRIES = 3;

/** Maximum fraction of lines that may change before requiring human review */
const MAX_CHANGE_RATIO = 0.3;

const VALID_FAILURE_TYPES = new Set<FailureTypeValue>(Object.values(FailureType));
const FAILED_RUN_STATUSES = new Set(['fail', 'error']);

type DiagnosisAggregationDependencies = {
  businessModuleRepo?: Pick<BusinessModuleRepository, 'findByProjectId'>;
  functionalModuleRepo?: Pick<FunctionalModuleRepository, 'findByProjectId'>;
  scenarioRepo?: Pick<TestScenarioRepository, 'findByFunctionalModuleId'>;
};

type BatchInterventionLogRepository = AIInterventionLogRepository & {
  findByRunIds?: (runIds: string[]) => AIInterventionLog[];
};

export interface DiagnosisResult {
  diagnosis: string;
  failureType: FailureTypeValue;
  confidence: number;
}

export interface AutoFixResult {
  status: 'fix_applied' | 'pending_human_review' | 'max_retries_exceeded';
  newScriptVersion?: Script;
  changeRatio?: number;
}

export class AIDiagnosisService {
  constructor(
    private proxyClient: ProxyAdapterClient,
    private promptManager: PromptTemplateManager,
    private runRepo: ExecutionRunRepository,
    private interventionRepo: AIInterventionLogRepository,
    private scriptRepo: ScriptRepository,
    private businessModuleRepo?: Pick<BusinessModuleRepository, 'findByProjectId'>,
    private functionalModuleRepo?: Pick<FunctionalModuleRepository, 'findByProjectId'>,
    private scenarioRepo?: Pick<TestScenarioRepository, 'findByFunctionalModuleId'>,
  ) {}

  /**
   * Diagnose a failed execution.
   *
   * Collects context (screenshot + DOM + console + script + expected),
   * calls AI for diagnosis, and stores the result in AIInterventionLog.
   */
  async diagnoseFailure(runId: string): Promise<DiagnosisResult> {
    const run = this.runRepo.findById(runId);
    if (!run) {
      throw new Error(`Execution run not found: ${runId}`);
    }
    if (run.status !== 'fail' && run.status !== 'error') {
      throw new Error(`Run ${runId} is not in a failed state (status: ${run.status})`);
    }

    const script = this.scriptRepo.findById(run.script_id);
    if (!script) {
      throw new Error(`Script not found for run ${runId}`);
    }

    // Collect context
    const screenshots = run.screenshot_paths_json
      ? JSON.parse(run.screenshot_paths_json) as string[]
      : [];
    const consoleLogs = run.logs ?? '';

    // Render diagnosis prompt
    const prompt = await this.promptManager.render('failure-diagnosis', {
      error_message: run.error_message ?? 'Unknown error',
      script_content: script.content,
      screenshot_description: screenshots.length > 0 ? screenshots.join(', ') : 'No screenshots',
      console_logs: consoleLogs,
    });

    // Call AI
    const result = await this.proxyClient.generateText(prompt);

    // Parse structured diagnosis before persistence so validated metadata is stored.
    const diagnosis = result.text;
    let failureType: FailureTypeValue = FailureType.UNKNOWN;
    let confidence = 0;

    try {
      const parsed = JSON.parse(diagnosis) as { failure_type?: unknown; confidence?: unknown };
      failureType = this.normalizeFailureType(parsed.failure_type);
      confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
    } catch {
      // AI returned non-JSON diagnosis text — still usable
    }

    // Store intervention log
    this.interventionRepo.create({
      execution_run_id: runId,
      diagnosis,
      failure_type: failureType,
      action_taken: 'diagnose_only',
      original_script_snapshot: script.content,
      diagnosis_tokens: result.tokenUsage.completionTokens,
    });

    return { diagnosis, failureType, confidence };
  }

  /**
   * Attempt an automatic fix based on prior diagnosis.
   *
   * Safety checks:
   * 1. Max retries (3) — if exceeded → pending_human_review
   * 2. Line diff ratio — if ≥30% lines changed → pending_human_review
   * 3. Only allows selector, timing, assertion fixes — NOT logic rewrites
   */
  async attemptAutoFix(runId: string): Promise<AutoFixResult> {
    // Check max retries
    const previousLogs = this.interventionRepo.findByRunId(runId);
    const autoFixCount = previousLogs.filter(
      (log) => log.action_taken === 'auto_fix_applied',
    ).length;

    if (autoFixCount >= MAX_AUTO_FIX_RETRIES) {
      this.interventionRepo.create({
        execution_run_id: runId,
        action_taken: 'pending_human_review',
        outcome: 'Max auto-fix retries exceeded',
      });
      return { status: 'max_retries_exceeded' };
    }

    // Find the latest diagnosis
    const diagnosisLog = [...previousLogs]
      .reverse()
      .find((log) => log.diagnosis);

    if (!diagnosisLog || !diagnosisLog.diagnosis) {
      throw new Error('No diagnosis found. Run diagnoseFailure() first.');
    }

    const run = this.runRepo.findById(runId);
    if (!run) {
      throw new Error(`Execution run not found: ${runId}`);
    }

    const script = this.scriptRepo.findById(run.script_id);
    if (!script) {
      throw new Error(`Script not found for run ${runId}`);
    }

    // Render fix prompt
    const prompt = await this.promptManager.render('script-fix', {
      original_script: script.content,
      diagnosis: diagnosisLog.diagnosis,
      fix_constraints: 'Only fix selectors, wait strategies, and assertion values. Do not rewrite logic.',
    });

    // Call AI for fix
    const result = await this.proxyClient.generateText(prompt);
    const fixedContent = result.text;

    // Calculate line diff ratio
    const changeRatio = this.calculateChangeRatio(script.content, fixedContent);

    if (changeRatio >= MAX_CHANGE_RATIO) {
      // Too many changes — require human review
      this.interventionRepo.create({
        execution_run_id: runId,
        action_taken: 'pending_human_review',
        original_script_snapshot: script.content,
        modified_script_snapshot: fixedContent,
        outcome: `Change ratio ${Math.round(changeRatio * 100)}% exceeds threshold ${MAX_CHANGE_RATIO * 100}%`,
      });
      return { status: 'pending_human_review', changeRatio };
    }

    // Apply fix — create new script version
    const newVersion = this.scriptRepo.createVersion(
      script.test_scenario_id,
      fixedContent,
      'ai_auto_fix',
    );

    // Log the applied fix
    this.interventionRepo.create({
      execution_run_id: runId,
      action_taken: 'auto_fix_applied',
      original_script_snapshot: script.content,
      modified_script_snapshot: fixedContent,
      diagnosis_tokens: result.tokenUsage.completionTokens,
    });

    return {
      status: 'fix_applied',
      newScriptVersion: newVersion,
      changeRatio,
    };
  }

  /**
   * Escalate to human review.
   *
   * Sets the associated script status to 'pending_review' and creates an
   * intervention log entry.
   */
  requestHumanReview(runId: string): void {
    this.interventionRepo.create({
      execution_run_id: runId,
      action_taken: 'pending_human_review',
      outcome: 'Escalated to human review',
    });
  }

  /**
   * Get all intervention logs for a given run.
   */
  getDiagnosisHistory(runId: string): AIInterventionLog[] {
    return this.interventionRepo.findByRunId(runId);
  }

  getProjectDiagnosisReport(projectId: string): ProjectDiagnosisReport {
    const report: ProjectDiagnosisReport = {
      projectId,
      totalRuns: 0,
      failedRuns: 0,
      diagnosedRuns: 0,
      undiagnosedRuns: 0,
      failureDistribution: [],
      recentFailures: [],
    };

    const runs = this.collectProjectRuns(projectId);
    report.totalRuns = runs.length;

    if (runs.length === 0) {
      return report;
    }

    const failedRuns = runs.filter((run) => FAILED_RUN_STATUSES.has(run.status));
    report.failedRuns = failedRuns.length;

    if (failedRuns.length === 0) {
      return report;
    }

    const logsByRunId = this.getInterventionLogsByRunIds(failedRuns.map((run) => run.id));
    const failureDistribution = new Map<FailureTypeValue, number>();

    const diagnosedFailures = failedRuns.flatMap((run) => {
      const latestDiagnosis = this.getLatestDiagnosisLog(logsByRunId.get(run.id) ?? []);
      if (!latestDiagnosis?.diagnosis) {
        return [];
      }

      const failureType = this.normalizeFailureType(latestDiagnosis.failure_type);
      failureDistribution.set(failureType, (failureDistribution.get(failureType) ?? 0) + 1);

      return [{
        runId: run.id,
        failureType,
        diagnosis: latestDiagnosis.diagnosis,
        timestamp: latestDiagnosis.created_at,
      }];
    });

    report.diagnosedRuns = diagnosedFailures.length;
    report.undiagnosedRuns = report.failedRuns - report.diagnosedRuns;
    report.failureDistribution = [...failureDistribution.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type));
    report.recentFailures = diagnosedFailures
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp));

    return report;
  }

  /**
   * Calculate the ratio of changed lines between two scripts.
   *
   * Returns a value between 0 and 1, where 1 means all lines changed.
   */
  private calculateChangeRatio(original: string, modified: string): number {
    const originalLines = original.split('\n').filter((l) => l.trim().length > 0);
    const modifiedLines = modified.split('\n').filter((l) => l.trim().length > 0);

    const maxLines = Math.max(originalLines.length, modifiedLines.length);
    if (maxLines === 0) return 0;

    const originalSet = new Set(originalLines);
    let changedCount = 0;

    for (const line of modifiedLines) {
      if (!originalSet.has(line)) {
        changedCount++;
      }
    }

    // Also count removed lines
    const modifiedSet = new Set(modifiedLines);
    for (const line of originalLines) {
      if (!modifiedSet.has(line)) {
        changedCount++;
      }
    }

    return changedCount / maxLines;
  }

  private normalizeFailureType(value: unknown): FailureTypeValue {
    return typeof value === 'string' && VALID_FAILURE_TYPES.has(value as FailureTypeValue)
      ? value as FailureTypeValue
      : FailureType.UNKNOWN;
  }

  private collectProjectRuns(projectId: string): ExecutionRun[] {
    const { businessModuleRepo, functionalModuleRepo, scenarioRepo } =
      this.getDiagnosisAggregationDependencies();

    const businessModuleIds = new Set(
      businessModuleRepo.findByProjectId(projectId).map((businessModule) => businessModule.id),
    );
    const functionalModules = functionalModuleRepo
      .findByProjectId(projectId)
      .filter((functionalModule) => businessModuleIds.size === 0 || businessModuleIds.has(functionalModule.business_module_id));

    const runs: ExecutionRun[] = [];

    for (const functionalModule of functionalModules) {
      const scenarios = scenarioRepo.findByFunctionalModuleId(functionalModule.id);
      for (const scenario of scenarios) {
        const scripts = this.scriptRepo.findByScenarioId(scenario.id);
        for (const script of scripts) {
          runs.push(...this.runRepo.findByScriptId(script.id));
        }
      }
    }

    return runs;
  }

  private getDiagnosisAggregationDependencies(): Required<DiagnosisAggregationDependencies> {
    const dependencies: DiagnosisAggregationDependencies = {
      businessModuleRepo: this.businessModuleRepo,
      functionalModuleRepo: this.functionalModuleRepo,
      scenarioRepo: this.scenarioRepo,
    };

    if (!dependencies.businessModuleRepo || !dependencies.functionalModuleRepo || !dependencies.scenarioRepo) {
      throw new Error('Project diagnosis aggregation dependencies are not configured');
    }

    return dependencies as Required<DiagnosisAggregationDependencies>;
  }

  private getInterventionLogsByRunIds(runIds: string[]): Map<string, AIInterventionLog[]> {
    if (runIds.length === 0) {
      return new Map();
    }

    const repo = this.interventionRepo as BatchInterventionLogRepository;
    const logs = repo.findByRunIds
      ? repo.findByRunIds(runIds)
      : runIds.flatMap((runId) => this.interventionRepo.findByRunId(runId));

    const logsByRunId = new Map<string, AIInterventionLog[]>();
    for (const log of logs) {
      const runLogs = logsByRunId.get(log.execution_run_id);
      if (runLogs) {
        runLogs.push(log);
      } else {
        logsByRunId.set(log.execution_run_id, [log]);
      }
    }

    return logsByRunId;
  }

  private getLatestDiagnosisLog(logs: AIInterventionLog[]): AIInterventionLog | null {
    const diagnosisLogs = logs.filter((log) => Boolean(log.diagnosis));
    if (diagnosisLogs.length === 0) {
      return null;
    }

    return [...diagnosisLogs].sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null;
  }
}
