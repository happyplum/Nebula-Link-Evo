import type { LoopGuardVerdict } from './types.js';

interface NudgeTemplates {
  warning: string;
  blocked: string;
  critical: string;
}

const DEFAULT_TEMPLATES: NudgeTemplates = {
  warning:
    '⚠️ 检测到重复行为：{toolName} 已连续执行 {count} 次且无进展。请尝试不同的操作方法。\nRepetition detected: {toolName} executed {count} times without progress. Try a different approach.',
  blocked:
    '🚫 操作被拦截：{toolName} 已重复 {count} 次，已阻止执行以防止无限循环。\nAction blocked: {toolName} repeated {count} times. Execution prevented to avoid infinite loop.',
  critical:
    '循环防护机制触发，强制终止。已完成的部分结果已保存。\nLoop guard triggered, forced termination. Partial results saved.',
};

function replaceTemplateVars(
  template: string,
  verdict: LoopGuardVerdict,
): string {
  return template
    .replaceAll('{toolName}', verdict.detector)
    .replaceAll('{count}', String(verdict.repeatedCount))
    .replaceAll('{detector}', verdict.detector);
}

class InterventionEngine {
  private readonly templates: NudgeTemplates;

  constructor(nudgeTemplates?: Partial<NudgeTemplates>) {
    this.templates = nudgeTemplates
      ? { ...DEFAULT_TEMPLATES, ...nudgeTemplates }
      : { ...DEFAULT_TEMPLATES };
  }

  getNudge(verdict: LoopGuardVerdict): string | undefined {
    if (verdict.level === 'clean') return undefined;
    const template = this.templates[verdict.level];
    return template ? replaceTemplateVars(template, verdict) : undefined;
  }

  shouldBlockExecution(verdict: LoopGuardVerdict): boolean {
    return verdict.level === 'blocked' || verdict.level === 'critical';
  }

  shouldInjectNudge(verdict: LoopGuardVerdict): boolean {
    return verdict.level !== 'clean';
  }

  formatBlockError(verdict: LoopGuardVerdict): string {
    return replaceTemplateVars(this.templates.blocked, verdict);
  }
}

export type { NudgeTemplates };
export { InterventionEngine, DEFAULT_TEMPLATES };
