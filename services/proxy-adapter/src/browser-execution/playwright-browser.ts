import type { Locator, Page } from 'playwright';
import { BrowserService } from '../browser-engine/index.js';
import { BrowserExecutionError } from './errors.js';
import type { BrowserExecutionBrowser } from './service.js';
import type {
  BrowserRawArtifact,
  BrowserLocatorCandidate,
  BrowserOperationExecutionResult,
  BrowserOperationRequestV1,
  BrowserTargetRefV1,
  ExecuteBrowserOperationInput,
  ResolvedBrowserTarget,
} from './types.js';

const OWNER = 'browser-execution';
const ALLOWED_KEYS = new Set([
  'Enter',
  'Tab',
  'Escape',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);
const ALLOWED_MODIFIERS = new Set(['Alt', 'Control', 'Meta', 'Shift']);

interface ResolvedLocator {
  locator: Locator;
  target: ResolvedBrowserTarget;
}

export class PlaywrightBrowserExecutionBrowser implements BrowserExecutionBrowser {
  constructor(private readonly browserService: BrowserService = BrowserService.getInstance()) {}

  async open(options: {
    viewport: { width: number; height: number };
    cdpPort: number;
  }): Promise<void> {
    await this.browserService.open(false, options.viewport, options.cdpPort, OWNER);
  }

  async close(): Promise<void> {
    await this.browserService.close(OWNER);
  }

  async getTabs() {
    return this.browserService.getTabs(OWNER);
  }

  setOnUnexpectedStateChange(callback: (reason: string) => void): void {
    this.browserService.setOnStateChange(callback);
  }

  async execute(input: ExecuteBrowserOperationInput): Promise<BrowserOperationExecutionResult> {
    await this.selectTab(input.tabId);

    const { request } = input;
    if (request.operation === 'tabs') {
      return { actual: await this.browserService.getTabs(OWNER) };
    }
    if (request.operation === 'switch_tab') {
      const { tabId } = request.args;
      await this.browserService.switchTab(tabId, OWNER);
      return { actual: { activeTabId: tabId } };
    }
    if (request.operation === 'close_tab') {
      const { returnToTabId } = request.args;
      await this.browserService.closeActiveTab(returnToTabId, OWNER);
      return { actual: { activeTabId: returnToTabId } };
    }

    return this.browserService.withPage(OWNER, async (page) => this.executeOnPage(page, request));
  }

  async captureScreenshot(tabId?: string): Promise<BrowserRawArtifact> {
    await this.selectTab(tabId);
    const { screenshot } = await this.browserService.screenshot(false, OWNER);
    return {
      kind: 'screenshot',
      mimeType: 'image/png',
      bytes: Buffer.from(screenshot, 'base64'),
    };
  }

  async captureDomSnapshot(tabId?: string): Promise<BrowserRawArtifact> {
    await this.selectTab(tabId);
    const snapshot = await this.browserService.getSimplifiedDOMV2(OWNER);
    return {
      kind: 'dom_snapshot',
      mimeType: 'application/json',
      bytes: Buffer.from(JSON.stringify(snapshot)),
      snapshotId: snapshot.snapshot_id,
    };
  }

  private async selectTab(tabId?: string): Promise<void> {
    if (!tabId) return;
    const tabs = await this.browserService.getTabs(OWNER);
    const active = tabs.find((tab) => tab.isActive);
    if (active?.id !== tabId) {
      await this.browserService.switchTab(tabId, OWNER);
    }
  }

  private async executeOnPage(
    page: Page,
    request: BrowserOperationRequestV1
  ): Promise<BrowserOperationExecutionResult> {
    switch (request.operation) {
      case 'page_state':
        return {
          actual: {
            url: page.url(),
            title: await page.title(),
            viewport: page.viewportSize(),
          },
        };
      case 'dom_snapshot':
        return { actual: { captured: true } };
      case 'url':
        return { actual: page.url() };
      case 'title':
        return { actual: await page.title() };
      case 'navigate': {
        const { url, waitUntil = 'domcontentloaded' } = request.args;
        if (!['commit', 'domcontentloaded', 'load'].includes(waitUntil)) {
          throw new BrowserExecutionError('validation_failed', 'navigate.waitUntil is invalid');
        }
        await page.goto(url, {
          waitUntil: waitUntil as 'commit' | 'domcontentloaded' | 'load',
          timeout: remainingTimeout(request.deadlineAt),
        });
        return { actual: { url: page.url(), title: await page.title() } };
      }
      case 'press': {
        const key = parseKey(request);
        if (request.target) {
          const resolved = await resolveTarget(page, request.target, true);
          await resolved.locator.press(key);
          return { resolvedTarget: resolved.target };
        }
        await page.keyboard.press(key);
        return {};
      }
      case 'scroll': {
        const { direction, amount } = request.args;
        if (!['up', 'down', 'left', 'right'].includes(direction) || amount < 1 || amount > 5000) {
          throw new BrowserExecutionError('validation_failed', 'scroll arguments are invalid');
        }
        const x = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
        const y = direction === 'up' ? -amount : direction === 'down' ? amount : 0;
        if (request.target) {
          const resolved = await resolveTarget(page, request.target, true);
          await resolved.locator.evaluate(
            (element, delta) => {
              element.scrollBy(delta.x, delta.y);
            },
            { x, y }
          );
          return { resolvedTarget: resolved.target };
        }
        await page.mouse.wheel(x, y);
        return {};
      }
      default:
        return this.executeTargetOperation(page, request);
    }
  }

  private async executeTargetOperation(
    page: Page,
    request: BrowserOperationRequestV1
  ): Promise<BrowserOperationExecutionResult> {
    if (!request.target) {
      throw new BrowserExecutionError(
        'validation_failed',
        `Browser operation ${request.operation} requires a target`
      );
    }
    const requiresExactlyOne = request.kind === 'act' || request.operation !== 'count';
    const resolved = await resolveTarget(page, request.target, requiresExactlyOne);
    const locator = resolved.locator;

    switch (request.operation) {
      case 'target_state':
        return {
          resolvedTarget: resolved.target,
          actual: {
            count: await locator.count(),
            visible: await locator
              .first()
              .isVisible()
              .catch(() => false),
            enabled: await locator
              .first()
              .isEnabled()
              .catch(() => false),
            editable: await locator
              .first()
              .isEditable()
              .catch(() => false),
            checked: await locator
              .first()
              .isChecked()
              .catch(() => false),
          },
        };
      case 'text':
        return { resolvedTarget: resolved.target, actual: await locator.first().textContent() };
      case 'value':
        return { resolvedTarget: resolved.target, actual: await locator.first().inputValue() };
      case 'attribute':
        return {
          resolvedTarget: resolved.target,
          actual: await locator.first().getAttribute(request.args.name),
        };
      case 'count':
        return { resolvedTarget: resolved.target, actual: await locator.count() };
      case 'click':
        await locator.click({
          button: optionalMouseButton(request),
          clickCount: optionalClickCount(request),
          timeout: remainingTimeout(request.deadlineAt),
        });
        break;
      case 'fill':
        await locator.fill(request.args.value, {
          timeout: remainingTimeout(request.deadlineAt),
        });
        break;
      case 'type_text': {
        const delay = request.args.delayMs ?? 0;
        if (!Number.isInteger(delay) || delay < 0 || delay > 100) {
          throw new BrowserExecutionError('validation_failed', 'type_text.delayMs is invalid');
        }
        await locator.pressSequentially(request.args.value, {
          delay,
          timeout: remainingTimeout(request.deadlineAt),
        });
        break;
      }
      case 'select_option':
        await locator.selectOption(request.args.values, {
          timeout: remainingTimeout(request.deadlineAt),
        });
        break;
      case 'check':
        await locator.check({ timeout: remainingTimeout(request.deadlineAt) });
        break;
      case 'uncheck':
        await locator.uncheck({ timeout: remainingTimeout(request.deadlineAt) });
        break;
      case 'focus':
        await locator.focus();
        break;
      case 'blur':
        await locator.blur();
        break;
      case 'hover':
        await locator.hover({ timeout: remainingTimeout(request.deadlineAt) });
        break;
      default:
        throw new BrowserExecutionError(
          'validation_failed',
          `Browser operation ${request.operation} is not implemented`
        );
    }
    return { resolvedTarget: resolved.target };
  }
}

async function resolveTarget(
  page: Page,
  target: BrowserTargetRefV1,
  requiresExactlyOne: boolean
): Promise<ResolvedLocator> {
  if (!target.semantic.trim() || target.candidates.length === 0) {
    throw new BrowserExecutionError('validation_failed', 'Browser target is incomplete');
  }

  const failures: Array<{ strategy: string; count: number; reason: string }> = [];
  for (const [index, candidate] of target.candidates.entries()) {
    const locator = locatorForCandidate(page, candidate);
    const count = await locator.count();
    const cardinalityMatches = requiresExactlyOne
      ? count === 1
      : target.expected.cardinality === 'at_least_one'
        ? count >= 1
        : target.expected.cardinality === 'zero_or_one'
          ? count <= 1
          : count === 1;
    if (!cardinalityMatches) {
      failures.push({ strategy: candidate.strategy, count, reason: 'cardinality' });
      continue;
    }

    if (count > 0) {
      const first = locator.first();
      if (target.expected.visible && !(await first.isVisible())) {
        failures.push({ strategy: candidate.strategy, count, reason: 'not_visible' });
        continue;
      }
      if (target.expected.enabled && !(await first.isEnabled())) {
        failures.push({ strategy: candidate.strategy, count, reason: 'not_enabled' });
        continue;
      }
      if (target.expected.editable && !(await first.isEditable())) {
        failures.push({ strategy: candidate.strategy, count, reason: 'not_editable' });
        continue;
      }
    }

    return {
      locator,
      target: {
        semantic: target.semantic,
        strategy: candidate.strategy,
        candidateIndex: index,
        matchedCount: count,
      },
    };
  }

  throw new BrowserExecutionError(
    'validation_failed',
    `Browser target could not be resolved uniquely: ${target.semantic}`,
    { details: { candidates: failures } }
  );
}

function locatorForCandidate(page: Page, candidate: BrowserLocatorCandidate): Locator {
  switch (candidate.strategy) {
    case 'role':
      return page.getByRole(candidate.role as Parameters<Page['getByRole']>[0], {
        ...(candidate.name !== undefined ? { name: candidate.name } : {}),
        exact: candidate.exact,
      });
    case 'test_id':
      return page.getByTestId(candidate.value);
    case 'label':
      return page.getByLabel(candidate.value, { exact: candidate.exact });
    case 'placeholder':
      return page.getByPlaceholder(candidate.value, { exact: candidate.exact });
    case 'text':
      return page.getByText(candidate.value, { exact: candidate.exact });
    case 'css':
      return page.locator(candidate.value);
    case 'xpath':
      return page.locator(`xpath=${candidate.value}`);
  }
}

function optionalMouseButton(
  request: Extract<BrowserOperationRequestV1, { operation: 'click' }>
): 'left' | 'middle' | 'right' | undefined {
  return request.args?.button;
}

function optionalClickCount(
  request: Extract<BrowserOperationRequestV1, { operation: 'click' }>
): 1 | 2 | undefined {
  return request.args?.clickCount;
}

function parseKey(request: Extract<BrowserOperationRequestV1, { operation: 'press' }>): string {
  const { key: raw } = request.args;
  if (typeof raw === 'string') {
    if (!ALLOWED_KEYS.has(raw)) {
      throw new BrowserExecutionError('validation_failed', 'press.key is not allowed');
    }
    return raw;
  }
  const { key, modifiers } = raw;
  if (!ALLOWED_KEYS.has(key) || modifiers.some((item) => !ALLOWED_MODIFIERS.has(item))) {
    throw new BrowserExecutionError('validation_failed', 'press.key is invalid');
  }
  return [...new Set(modifiers), key].join('+');
}

function remainingTimeout(deadlineAt: string): number {
  const remaining = new Date(deadlineAt).getTime() - Date.now();
  if (remaining <= 0) {
    throw new BrowserExecutionError('state_conflict', 'Browser operation deadline has passed');
  }
  return Math.min(remaining, 30_000);
}
