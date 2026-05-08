/**
 * ExplorerService — AI-guided BFS web exploration engine (Mode 2)
 *
 * Discovers URLs from a base URL + seed URLs using breadth-first traversal.
 * AI analyses each page snapshot to decide navigation strategy.
 * After exploration, AI proposes URL↔functional-module bindings.
 */

import type { DatabaseManager } from '../database/db.js';
import type { ExplorationSession } from '../database/repositories/exploration-session-repository.js';
import type { URLModuleBinding } from '../database/repositories/url-module-binding-repository.js';
import type { PlaywrightClient } from './playwright-client.js';
import type { AIProvider } from '../ai/provider.js';
import type { PromptTemplateManager } from '../ai/prompt-manager.js';

// ---------- Configuration ----------

/** Default exploration limits */
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_MAX_PAGES = 50;

/** Options for starting an exploration session */
export interface ExplorationOptions {
  /** Maximum BFS depth (default 3) */
  maxDepth?: number;
  /** Hard timeout in milliseconds (default 600 000) */
  timeoutMs?: number;
  /** Maximum pages to visit (default 50) */
  maxPages?: number;
  /** Additional seed URLs (paths or full URLs under base) */
  seedUrls?: string[];
}

// ---------- Internal types ----------

interface QueueItem {
  url: string;
  depth: number;
}

interface ActiveExploration {
  sessionId: string;
  queue: QueueItem[];
  visited: Set<string>;
  abortController: AbortController;
  tokenCount: number;
  config: Required<ExplorationOptions>;
  baseUrl: string;
  pagesVisited: string[];
  urlsDiscovered: string[];
}

interface AINavigationResponse {
  analysis: string;
  discovered_links: Array<{ text: string; href: string; purpose: string }>;
  navigation_decision: {
    action: 'click' | 'navigate' | 'interact' | 'back' | 'complete';
    target: string;
    reason: string;
  };
}

interface AIBindingResponse {
  bindings: Array<{ module_name: string; confidence: number; evidence: string }>;
  primary_module: string;
  unclassifiable: boolean;
}

// ---------- Service ----------

export class ExplorerService {
  private db: DatabaseManager;
  private playwright: PlaywrightClient;
  private aiProvider: AIProvider;
  private promptManager: PromptTemplateManager;

  /** Active explorations keyed by projectId */
  private activeExplorations = new Map<string, ActiveExploration>();

  constructor(
    db: DatabaseManager,
    playwright: PlaywrightClient,
    aiProvider: AIProvider,
    promptManager: PromptTemplateManager,
  ) {
    this.db = db;
    this.playwright = playwright;
    this.aiProvider = aiProvider;
    this.promptManager = promptManager;
  }

  // ===== Public API =====

  /**
   * Start an exploration session for a project.
   * Creates the session record, enqueues base URL + seed URLs, runs BFS.
   */
  async startExploration(
    projectId: string,
    options?: ExplorationOptions,
  ): Promise<ExplorationSession> {
    const project = this.db.getProjectRepo().findById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    if (!project.target_base_url) {
      throw new Error(`Project has no target base URL: ${projectId}`);
    }

    const baseUrl = project.target_base_url;
    const config: Required<ExplorationOptions> = {
      maxDepth: options?.maxDepth ?? DEFAULT_MAX_DEPTH,
      timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxPages: options?.maxPages ?? DEFAULT_MAX_PAGES,
      seedUrls: options?.seedUrls ?? [],
    };

    // Create session record
    const session = this.db.getExplorationSessionRepo().create({
      project_id: projectId,
      strategy_used: 'bfs',
    });

    // Initialize active exploration state
    const abortController = new AbortController();
    const visited = new Set<string>();
    const queue: QueueItem[] = [];

    // Enqueue base URL
    queue.push({ url: baseUrl, depth: 0 });

    // Enqueue seed URLs
    for (const seed of config.seedUrls) {
      const fullUrl = this.resolveUrl(baseUrl, seed);
      if (fullUrl && !visited.has(fullUrl)) {
        queue.push({ url: fullUrl, depth: 0 });
      }
    }

    const active: ActiveExploration = {
      sessionId: session.id,
      queue,
      visited,
      abortController,
      tokenCount: 0,
      config,
      baseUrl,
      pagesVisited: [],
      urlsDiscovered: [],
    };
    this.activeExplorations.set(projectId, active);

    // Set timeout
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, config.timeoutMs);

    try {
      // Run BFS loop
      await this.runBFSLoop(projectId);
    } finally {
      clearTimeout(timeoutId);
      this.finalizeSession(projectId);
      this.activeExplorations.delete(projectId);
    }

    const finalSession = this.db.getExplorationSessionRepo().findById(session.id);
    return finalSession!;
  }

  /**
   * Stop the active exploration for a project.
   */
  stopExploration(projectId: string): void {
    const active = this.activeExplorations.get(projectId);
    if (active) {
      active.abortController.abort();
    }
  }

  /**
   * Get the current exploration session status for a project.
   */
  getExplorationStatus(projectId: string): ExplorationSession | null {
    return this.db.getExplorationSessionRepo().findLatest(projectId);
  }

  /**
   * Get all discovered URLs for a project.
   */
  getDiscoveredURLs(projectId: string) {
    return this.db.getURLRepo().findByProjectId(projectId);
  }

  /**
   * AI proposes bindings between discovered URLs and functional modules.
   * Returns the created binding records.
   */
  async proposeBindings(projectId: string): Promise<URLModuleBinding[]> {
    const bizModules = this.db.getBusinessModuleRepo().findByProjectId(projectId);
    if (bizModules.length === 0) {
      throw new Error('No functional modules found. Run PRD analysis first.');
    }

    // Collect all functional modules under this project's business modules
    const functionalModules: Array<{ id: string; name: string; description: string | null }> = [];
    for (const bm of bizModules) {
      const fms = this.db.getFunctionalModuleRepo().findByBusinessModuleId(bm.id);
      for (const fm of fms) {
        functionalModules.push({ id: fm.id, name: fm.name, description: fm.description });
      }
    }

    if (functionalModules.length === 0) {
      throw new Error('No functional modules found. Run PRD analysis first.');
    }

    // Get unbound URLs
    const unboundUrls = this.db.getURLRepo().findUnbound(projectId);
    const bindings: URLModuleBinding[] = [];

    for (const urlRecord of unboundUrls) {
      try {
        const prompt = await this.promptManager.render('exploration-url-bind', {
          url: urlRecord.url,
          url_title: urlRecord.title ?? 'Unknown',
          page_snapshot: urlRecord.page_snapshot_json ?? '{}',
          functional_modules: JSON.stringify(functionalModules),
        });

        const result = await this.aiProvider.generateText(prompt);
        const parsed = this.parseAIResponse<AIBindingResponse>(result.text);

        if (!parsed || parsed.unclassifiable || parsed.bindings.length === 0) {
          continue;
        }

        // Create binding for the primary module
        const primaryBinding = parsed.bindings[0];
        const matchedModule = functionalModules.find(
          m => m.name === primaryBinding?.module_name,
        );

        if (matchedModule) {
          const binding = this.db.getURLModuleBindingRepo().create({
            url_id: urlRecord.id,
            functional_module_id: matchedModule.id,
            status: 'ai_proposed',
            confidence_score: primaryBinding?.confidence ?? 0.5,
          });
          bindings.push(binding);
        }
      } catch {
        // Skip URLs that fail to bind
      }
    }

    return bindings;
  }

  /**
   * Confirm an AI-proposed binding.
   */
  confirmBinding(bindingId: string): URLModuleBinding {
    const binding = this.db.getURLModuleBindingRepo().findById(bindingId);
    if (!binding) {
      throw new Error(`Binding not found: ${bindingId}`);
    }
    const updated = this.db.getURLModuleBindingRepo().updateStatus(bindingId, 'human_confirmed');
    return updated!;
  }

  /**
   * Reject an AI-proposed binding.
   */
  rejectBinding(bindingId: string): URLModuleBinding {
    const binding = this.db.getURLModuleBindingRepo().findById(bindingId);
    if (!binding) {
      throw new Error(`Binding not found: ${bindingId}`);
    }
    const updated = this.db.getURLModuleBindingRepo().updateStatus(bindingId, 'rejected');
    return updated!;
  }

  // ===== BFS internals =====

  /**
   * Run the BFS exploration loop until queue is empty, limits hit, or aborted.
   */
  private async runBFSLoop(projectId: string): Promise<void> {
    const active = this.activeExplorations.get(projectId);
    if (!active) return;

    while (active.queue.length > 0 && !active.abortController.signal.aborted) {
      if (active.pagesVisited.length >= active.config.maxPages) {
        break;
      }

      const item = active.queue.shift()!;
      if (active.visited.has(item.url)) continue;
      if (item.depth > active.config.maxDepth) continue;

      active.visited.add(item.url);

      try {
        await this.exploreNextPage(projectId, item);
      } catch {
        // Continue with next item on error
      }
    }
  }

  /**
   * Visit a single page: navigate, snapshot, AI analysis, discover URLs.
   * Returns false if aborted.
   */
  private async exploreNextPage(projectId: string, item: QueueItem): Promise<boolean> {
    const active = this.activeExplorations.get(projectId);
    if (!active || active.abortController.signal.aborted) return false;

    // Navigate to the page with abort awareness
    const navResult = await this.withAbort(active, () => this.playwright.navigate(item.url));
    if (!navResult) return false;
    const currentUrl = navResult.url;

    // Get page info
    const pageInfo = await this.withAbort(active, () => this.playwright.getPageInfo());
    if (!pageInfo) return false;

    // Get snapshot
    const snapshot = await this.withAbort(active, () => this.playwright.getSnapshot());
    if (!snapshot) return false;

    // Store discovered URL
    const urlRecord = this.db.getURLRepo().create({
      project_id: projectId,
      url: currentUrl,
      title: pageInfo.title,
      discovered_method: 'bfs',
      page_snapshot_json: JSON.stringify(snapshot.elements),
    });
    active.urlsDiscovered.push(urlRecord.id);
    active.pagesVisited.push(currentUrl);

    // AI analysis for navigation decision
    const prompt = await this.withAbort(active, () =>
      this.promptManager.render('exploration-guide', {
        page_url: currentUrl,
        page_snapshot: JSON.stringify(snapshot.elements),
        visited_urls: JSON.stringify(Array.from(active.visited)),
        depth: String(item.depth),
      }),
    );
    if (prompt === null) return false;

    const result = await this.withAbort(active, () => this.aiProvider.generateText(prompt));
    if (!result) return false;

    active.tokenCount += result.tokenUsage.promptTokens + result.tokenUsage.completionTokens;

    const parsed = this.parseAIResponse<AINavigationResponse>(result.text);
    if (!parsed) return true;

    // Enqueue discovered links
    if (parsed.discovered_links) {
      for (const link of parsed.discovered_links) {
        const fullUrl = this.resolveUrl(active.baseUrl, link.href);
        if (fullUrl && this.isSameOrigin(active.baseUrl, fullUrl) && !active.visited.has(fullUrl)) {
          active.queue.push({ url: fullUrl, depth: item.depth + 1 });
        }
      }
    }

    // Handle navigation decision
    if (parsed.navigation_decision) {
      const decision = parsed.navigation_decision;
      if (decision.action === 'navigate' && decision.target) {
        const targetUrl = this.resolveUrl(active.baseUrl, decision.target);
        if (targetUrl && this.isSameOrigin(active.baseUrl, targetUrl) && !active.visited.has(targetUrl)) {
          active.queue.unshift({ url: targetUrl, depth: item.depth + 1 });
        }
      }
    }

    return true;
  }

  /**
   * Wrap an async operation with abort awareness.
   * Returns null if aborted before or during the operation.
   */
  private async withAbort<T>(active: ActiveExploration, fn: () => Promise<T>): Promise<T | null> {
    if (active.abortController.signal.aborted) return null;
    return fn();
  }

  // ===== Helpers =====

  /**
   * Resolve a possibly-relative URL against the base URL.
   */
  private resolveUrl(baseUrl: string, href: string): string | null {
    try {
      if (href.startsWith('http://') || href.startsWith('https://')) {
        return new URL(href).href;
      }
      return new URL(href, baseUrl).href;
    } catch {
      return null;
    }
  }

  /**
   * Check whether a URL shares the same origin as the base URL.
   */
  private isSameOrigin(baseUrl: string, url: string): boolean {
    try {
      const base = new URL(baseUrl);
      const target = new URL(url);
      return base.origin === target.origin;
    } catch {
      return false;
    }
  }

  /**
   * Parse a JSON response from the AI, extracting the JSON block from markdown fences.
   */
  private parseAIResponse<T>(text: string): T | null {
    try {
      // Try direct parse first
      return JSON.parse(text) as T;
    } catch {
      // Try extracting from markdown code fences
      const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (jsonMatch?.[1]) {
        try {
          return JSON.parse(jsonMatch[1]) as T;
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  /**
   * Finalize the session: update progress, set completion.
   */
  private finalizeSession(projectId: string): void {
    const active = this.activeExplorations.get(projectId);
    if (!active) return;

    this.db.getExplorationSessionRepo().update(active.sessionId, {
      completed_at: new Date().toISOString(),
      pages_visited_json: JSON.stringify(active.pagesVisited),
      urls_discovered_json: JSON.stringify(active.urlsDiscovered),
      token_count: active.tokenCount,
    });
  }
}
