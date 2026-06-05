import { describe, it, expect } from 'vitest';
import {
  adaptNavigateParams,
  adaptScreenshotParams,
  adaptTypeParams,
  adaptClickSelectorParams,
  adaptMarkerParams,
  adaptElementActionParams,
} from '../param-adapter.js';

// ---------------------------------------------------------------------------
// adaptNavigateParams
// ---------------------------------------------------------------------------
describe('adaptNavigateParams', () => {
  it('正常 url + 额外字段 → 仅保留 url', () => {
    expect(adaptNavigateParams({ url: 'https://example.com', waitUntil: 'load' })).toEqual({
      url: 'https://example.com',
    });
  });

  it('缺少 url → throw', () => {
    expect(() => adaptNavigateParams({})).toThrow('browser_navigate');
  });

  it('url 为空字符串 → throw', () => {
    expect(() => adaptNavigateParams({ url: '' })).toThrow('browser_navigate');
  });

  it('url 为非字符串 → throw', () => {
    expect(() => adaptNavigateParams({ url: 123 })).toThrow('browser_navigate');
  });
});

// ---------------------------------------------------------------------------
// adaptScreenshotParams
// ---------------------------------------------------------------------------
describe('adaptScreenshotParams', () => {
  it('fullPage: true → 保留', () => {
    expect(adaptScreenshotParams({ fullPage: true })).toEqual({ fullPage: true });
  });

  it('fullPage 未传 → 默认 false', () => {
    expect(adaptScreenshotParams({})).toEqual({ fullPage: false });
  });

  it('忽略 type 字段', () => {
    expect(adaptScreenshotParams({ fullPage: false, type: 'jpeg' })).toEqual({ fullPage: false });
  });
});

// ---------------------------------------------------------------------------
// adaptTypeParams
// ---------------------------------------------------------------------------
describe('adaptTypeParams', () => {
  it('正常参数 + 额外字段被忽略', () => {
    expect(
      adaptTypeParams({ text: 'hello', selector: '#input', delay: 100 }),
    ).toEqual({ text: 'hello', selector: '#input' });
  });

  it('缺少 selector → throw', () => {
    expect(() => adaptTypeParams({ text: 'hello' })).toThrow('page_type');
  });

  it('缺少 text → throw', () => {
    expect(() => adaptTypeParams({ selector: '#input' })).toThrow('page_type');
  });

  it('selector 为空字符串 → throw', () => {
    expect(() => adaptTypeParams({ selector: '', text: 'hello' })).toThrow('page_type');
  });
});

// ---------------------------------------------------------------------------
// adaptClickSelectorParams
// ---------------------------------------------------------------------------
describe('adaptClickSelectorParams', () => {
  it('正常 selector → 透传', () => {
    expect(adaptClickSelectorParams({ selector: '.btn' })).toEqual({ selector: '.btn' });
  });

  it('缺少 selector → throw', () => {
    expect(() => adaptClickSelectorParams({})).toThrow('page_click_selector');
  });

  it('selector 为空字符串 → throw', () => {
    expect(() => adaptClickSelectorParams({ selector: '' })).toThrow('page_click_selector');
  });
});

// ---------------------------------------------------------------------------
// adaptElementActionParams
// ---------------------------------------------------------------------------
describe('adaptElementActionParams', () => {
  it('正常参数 → 透传', () => {
    expect(adaptElementActionParams({ selector: '.el', action: 'click' })).toEqual({
      selector: '.el',
      action: 'click',
      param: undefined,
    });
  });

  it('带 param → 透传', () => {
    expect(
      adaptElementActionParams({ selector: '.el', action: 'value', param: 'hello' }),
    ).toEqual({ selector: '.el', action: 'value', param: 'hello' });
  });

  it('缺少 selector → throw', () => {
    expect(() => adaptElementActionParams({ action: 'click' })).toThrow(
      'page_element_action',
    );
  });

  it('缺少 action → throw', () => {
    expect(() => adaptElementActionParams({ selector: '.el' })).toThrow(
      'page_element_action',
    );
  });
});

// ---------------------------------------------------------------------------
// adaptMarkerParams
// ---------------------------------------------------------------------------
describe('adaptMarkerParams', () => {
  it('snapshot_id + nebula_id + action → 完整返回', () => {
    expect(
      adaptMarkerParams({
        snapshot_id: 'snap-1',
        nebula_id: 42,
        action: 'click',
      }),
    ).toEqual({
      snapshotId: 'snap-1',
      nebulaId: 42,
      action: 'click',
      param: undefined,
    });
  });

  it('支持 snapshotId 别名', () => {
    expect(
      adaptMarkerParams({
        snapshotId: 'snap-2',
        nebula_id: 1,
        action: 'type',
        param: 'hello',
      }),
    ).toEqual({
      snapshotId: 'snap-2',
      nebulaId: 1,
      action: 'type',
      param: 'hello',
    });
  });

  it('支持 nebulaId 别名', () => {
    expect(
      adaptMarkerParams({
        snapshot_id: 'snap-3',
        nebulaId: 5,
        action: 'focus',
      }),
    ).toEqual({
      snapshotId: 'snap-3',
      nebulaId: 5,
      action: 'focus',
      param: undefined,
    });
  });

  it('缺少 snapshot_id → throw', () => {
    expect(() =>
      adaptMarkerParams({ nebula_id: 1, action: 'click' }),
    ).toThrow('execute_by_marker');
  });

  it('缺少 nebula_id → throw', () => {
    expect(() =>
      adaptMarkerParams({ snapshot_id: 'snap', action: 'click' }),
    ).toThrow('execute_by_marker');
  });

  it('缺少 action → throw', () => {
    expect(() =>
      adaptMarkerParams({ snapshot_id: 'snap', nebula_id: 1 }),
    ).toThrow('execute_by_marker');
  });

  it('nebula_id 为非数字 → throw', () => {
    expect(() =>
      adaptMarkerParams({ snapshot_id: 'snap', nebula_id: 'abc', action: 'click' }),
    ).toThrow('execute_by_marker');
  });
});
