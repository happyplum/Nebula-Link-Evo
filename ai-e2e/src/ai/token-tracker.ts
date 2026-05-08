export interface TokenUsage {
  prompt: number;
  completion: number;
}

export class TokenBudgetTracker {
  private usage: Map<string, TokenUsage> = new Map();
  private budget: number;

  constructor(budget: number) {
    this.budget = budget;
  }

  record(category: string, promptTokens: number, completionTokens: number): void {
    const existing = this.usage.get(category) ?? { prompt: 0, completion: 0 };
    this.usage.set(category, {
      prompt: existing.prompt + promptTokens,
      completion: existing.completion + completionTokens,
    });
  }

  getTotalUsage(): TokenUsage {
    let prompt = 0;
    let completion = 0;
    for (const entry of this.usage.values()) {
      prompt += entry.prompt;
      completion += entry.completion;
    }
    return { prompt, completion };
  }

  getRemainingBudget(): number {
    const total = this.getTotalUsage();
    return this.budget - (total.prompt + total.completion);
  }

  isOverBudget(): boolean {
    return this.getRemainingBudget() < 0;
  }

  getUsageByCategory(category: string): TokenUsage | undefined {
    return this.usage.get(category);
  }

  reset(): void {
    this.usage.clear();
  }
}
