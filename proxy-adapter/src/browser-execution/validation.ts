import { BrowserExecutionError } from './errors.js';
import { ACT_OPERATIONS, OBSERVE_OPERATIONS } from './types.js';
import type {
  BrowserLocatorCandidate,
  BrowserOperationRequestV1,
  BrowserTargetRefV1,
  ExecuteBrowserOperationInput,
} from './types.js';

const TARGET_REQUIRED = new Set([
  'target_state',
  'text',
  'value',
  'attribute',
  'count',
  'click',
  'fill',
  'type_text',
  'select_option',
  'check',
  'uncheck',
  'focus',
  'blur',
  'hover',
]);

const ALLOWED_ARGS: Record<string, readonly string[]> = {
  page_state: [],
  target_state: [],
  url: [],
  title: [],
  text: [],
  value: [],
  attribute: ['name'],
  count: [],
  tabs: [],
  navigate: ['url', 'waitUntil'],
  click: ['button', 'clickCount'],
  fill: ['value'],
  type_text: ['value', 'delayMs'],
  press: ['key'],
  select_option: ['values'],
  check: [],
  uncheck: [],
  focus: [],
  blur: [],
  hover: [],
  scroll: ['direction', 'amount'],
  switch_tab: ['tabId'],
  close_tab: ['returnToTabId'],
};

export function validateOperationInput(input: ExecuteBrowserOperationInput): void {
  assertPlainObject(input, 'Browser operation envelope');
  assertAllowedKeys(
    input as unknown as Record<string, unknown>,
    ['sessionId', 'leaseId', 'leaseToken', 'tabId', 'request'],
    'Browser operation envelope'
  );
  for (const [key, value] of [
    ['sessionId', input.sessionId],
    ['leaseId', input.leaseId],
    ['leaseToken', input.leaseToken],
  ] as const) {
    if (typeof value !== 'string' || !value) {
      fail(`${key} is required`);
    }
  }
  if (input.tabId !== undefined && (typeof input.tabId !== 'string' || !input.tabId)) {
    fail('tabId must be a non-empty string');
  }

  const request = input.request;
  assertPlainObject(request, 'Browser operation request');
  assertAllowedKeys(
    request as unknown as Record<string, unknown>,
    [
      'schema',
      'operationId',
      'leaseSequence',
      'deadlineAt',
      'kind',
      'operation',
      'target',
      'args',
      'capture',
      'presentation',
    ],
    'Browser operation request'
  );
  if (request.schema !== 'nebula.browser.operation/1.0') {
    fail('Browser operation schema is unsupported');
  }
  if (!isUuid(request.operationId)) {
    fail('Browser operationId must be a UUID');
  }
  if (!Number.isInteger(request.leaseSequence) || request.leaseSequence < 1) {
    fail('Browser lease sequence is invalid');
  }
  if (
    typeof request.deadlineAt !== 'string' ||
    !Number.isFinite(new Date(request.deadlineAt).getTime())
  ) {
    fail('Browser operation deadlineAt is invalid');
  }

  const observations: readonly string[] = OBSERVE_OPERATIONS;
  const actions: readonly string[] = ACT_OPERATIONS;
  const validKind =
    request.kind === 'observe'
      ? observations.includes(request.operation)
      : request.kind === 'act' && actions.includes(request.operation);
  if (!validKind) {
    fail('Browser operation kind and operation do not match the allowlist');
  }
  if (request.operation !== 'tabs' && !input.tabId) {
    fail('A stable tabId is required for this browser operation');
  }

  if (TARGET_REQUIRED.has(request.operation) && !request.target) {
    fail(`Browser operation ${request.operation} requires a target`);
  }
  if (request.target) {
    validateTarget(request.target, request.kind === 'act');
  }
  validateArgs(request);
  validateCapture(request.capture);
  validatePresentation(request.presentation);
}

function validateTarget(target: BrowserTargetRefV1, action: boolean): void {
  assertPlainObject(target, 'Browser target');
  assertAllowedKeys(
    target as unknown as Record<string, unknown>,
    ['semantic', 'candidates', 'expected'],
    'Browser target'
  );
  if (
    typeof target.semantic !== 'string' ||
    !target.semantic.trim() ||
    target.semantic.length > 500
  ) {
    fail('Browser target semantic is invalid');
  }
  if (
    !Array.isArray(target.candidates) ||
    target.candidates.length < 1 ||
    target.candidates.length > 20
  ) {
    fail('Browser target candidates must contain between 1 and 20 entries');
  }
  target.candidates.forEach(validateCandidate);
  assertPlainObject(target.expected, 'Browser target expectation');
  assertAllowedKeys(
    target.expected as unknown as Record<string, unknown>,
    ['cardinality', 'visible', 'enabled', 'editable'],
    'Browser target expectation'
  );
  if (!['exactly_one', 'at_least_one', 'zero_or_one'].includes(target.expected.cardinality)) {
    fail('Browser target cardinality is invalid');
  }
  if (action && target.expected.cardinality !== 'exactly_one') {
    fail('Browser action targets must require exactly_one cardinality');
  }
  for (const key of ['visible', 'enabled', 'editable'] as const) {
    if (target.expected[key] !== undefined && typeof target.expected[key] !== 'boolean') {
      fail(`Browser target ${key} expectation must be boolean`);
    }
  }
}

function validateCandidate(candidate: BrowserLocatorCandidate, index: number): void {
  assertPlainObject(candidate, `Browser target candidate ${index}`);
  if (
    !['role', 'test_id', 'label', 'placeholder', 'text', 'css', 'xpath'].includes(
      candidate.strategy
    )
  ) {
    fail(`Browser target candidate ${index} strategy is invalid`);
  }

  if (candidate.strategy === 'role') {
    assertAllowedKeys(
      candidate as unknown as Record<string, unknown>,
      ['strategy', 'role', 'name', 'exact'],
      `Browser target candidate ${index}`
    );
    if (typeof candidate.role !== 'string' || !candidate.role) fail('Role candidate requires role');
    if (candidate.name !== undefined && typeof candidate.name !== 'string')
      fail('Role candidate name must be string');
    if (candidate.exact !== undefined && typeof candidate.exact !== 'boolean')
      fail('Role candidate exact must be boolean');
    return;
  }

  assertAllowedKeys(
    candidate as unknown as Record<string, unknown>,
    candidate.strategy === 'label' ||
      candidate.strategy === 'placeholder' ||
      candidate.strategy === 'text'
      ? ['strategy', 'value', 'exact']
      : ['strategy', 'value'],
    `Browser target candidate ${index}`
  );
  if (typeof candidate.value !== 'string' || !candidate.value || candidate.value.length > 2_000) {
    fail(`Browser target candidate ${index} value is invalid`);
  }
  if (
    'exact' in candidate &&
    candidate.exact !== undefined &&
    typeof candidate.exact !== 'boolean'
  ) {
    fail(`Browser target candidate ${index} exact must be boolean`);
  }
}

function validateArgs(request: BrowserOperationRequestV1): void {
  const allowed = ALLOWED_ARGS[request.operation];
  if (!allowed) {
    fail(`Browser operation ${request.operation} is unsupported`);
  }
  if (request.args === undefined) {
    if (allowed.length > 0 && request.operation !== 'click') {
      fail(`Browser operation ${request.operation} requires args`);
    }
    return;
  }
  assertPlainObject(request.args, `${request.operation} args`);
  assertAllowedKeys(request.args, allowed, `${request.operation} args`);

  switch (request.operation) {
    case 'navigate': {
      const urlValue = requireString(request.args, 'url');
      const url = parseUrl(urlValue);
      if (!['http:', 'https:'].includes(url.protocol)) {
        fail('navigate.url only supports HTTP or HTTPS');
      }
      const waitUntil = request.args.waitUntil;
      if (
        waitUntil !== undefined &&
        !['commit', 'domcontentloaded', 'load'].includes(String(waitUntil))
      ) {
        fail('navigate.waitUntil is invalid');
      }
      break;
    }
    case 'click': {
      const button = request.args.button;
      if (button !== undefined && !['left', 'middle', 'right'].includes(String(button))) {
        fail('click.button is invalid');
      }
      const clickCount = request.args.clickCount;
      if (clickCount !== undefined && clickCount !== 1 && clickCount !== 2) {
        fail('click.clickCount is invalid');
      }
      break;
    }
    case 'fill':
      requireString(request.args, 'value', true);
      break;
    case 'type_text': {
      requireString(request.args, 'value', true);
      const delayMs = request.args.delayMs;
      if (
        delayMs !== undefined &&
        (!Number.isInteger(delayMs) || (delayMs as number) < 0 || (delayMs as number) > 100)
      ) {
        fail('type_text.delayMs is invalid');
      }
      break;
    }
    case 'attribute':
      requireString(request.args, 'name');
      break;
    case 'press':
      if (!('key' in request.args)) fail('press.key is required');
      break;
    case 'select_option':
      if (
        !Array.isArray(request.args.values) ||
        request.args.values.length === 0 ||
        request.args.values.some((value) => typeof value !== 'string')
      ) {
        fail('select_option.values must be a non-empty string array');
      }
      break;
    case 'scroll': {
      if (!['up', 'down', 'left', 'right'].includes(String(request.args.direction))) {
        fail('scroll.direction is invalid');
      }
      const amount = request.args.amount;
      if (!Number.isInteger(amount) || (amount as number) < 1 || (amount as number) > 5000) {
        fail('scroll.amount is invalid');
      }
      break;
    }
    case 'switch_tab':
      requireString(request.args, 'tabId');
      break;
    case 'close_tab':
      requireString(request.args, 'returnToTabId');
      break;
  }
}

function parseUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    fail('navigate.url must be a valid URL');
  }
}

function validateCapture(capture: BrowserOperationRequestV1['capture']): void {
  if (capture === undefined) return;
  assertPlainObject(capture, 'Browser operation capture');
  assertAllowedKeys(
    capture as Record<string, unknown>,
    ['beforeScreenshot', 'afterScreenshot', 'domSnapshot', 'videoSegment'],
    'Browser operation capture'
  );
  for (const value of Object.values(capture)) {
    if (typeof value !== 'boolean') fail('Browser operation capture values must be boolean');
  }
}

function validatePresentation(presentation: BrowserOperationRequestV1['presentation']): void {
  if (presentation === undefined) return;
  assertPlainObject(presentation, 'Browser operation presentation');
  assertAllowedKeys(
    presentation as Record<string, unknown>,
    ['label', 'animation'],
    'Browser operation presentation'
  );
  if (presentation.label !== undefined && typeof presentation.label !== 'string') {
    fail('Browser operation presentation label must be string');
  }
  if (!['normal', 'fast', 'off'].includes(presentation.animation)) {
    fail('Browser operation presentation animation is invalid');
  }
}

function requireString(value: Record<string, unknown>, key: string, allowEmpty = false): string {
  const result = value[key];
  if (typeof result !== 'string' || (!allowEmpty && !result)) {
    fail(`${key} must be a string`);
  }
  return result;
}

function assertPlainObject(
  value: unknown,
  label: string
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    fail(`${label} contains unknown fields`, { unknownFields: unknown });
  }
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function fail(message: string, details?: Record<string, unknown>): never {
  throw new BrowserExecutionError('validation_failed', message, details ? { details } : {});
}
