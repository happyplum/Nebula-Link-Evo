import { gunzipSync } from 'node:zlib';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  escapeSelector,
  escapeXPath,
  filterRelevantAttributes,
  getElementAttributes,
  getElementTagName,
  getElementText,
  getImplicitRole,
} from '../dom-utils.js';
import { DOMExtractor } from './dom-extractor.js';
import { PageActions } from './page-actions.js';
import { SnapshotCache } from './snapshot-cache.js';
import { acquireLock } from './browser-lock.js';
import { BrowserService } from './browser-service.js';

describe('BrowserService debug status', () => {
  it('returns a synchronous snapshot while a browser operation owns the lock', async () => {
    const service = BrowserService.getInstance();
    const release = await acquireLock('debug-status-test');
    try {
      await expect(service.getDebugStatus('snapshot')).resolves.toMatchObject({
        isOpen: false,
        title: null,
        status: 'unknown',
        reason: 'snapshot',
      });
    } finally {
      release();
    }
  });
});

describe('debug browser surface with real Chromium', () => {
  let browser: Browser;
  let page: Page;
  let actions: PageActions;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    actions = new PageActions();
    actions.setPage(page);
  });

  beforeEach(async () => {
    await page.setContent(`
      <label for="name">Name</label>
      <input id="name" name="name" placeholder="Your name" />
      <button id="save" type="button" onclick="window.clicks = (window.clicks || 0) + 1">Save</button>
      <div id="hover" role="button" tabindex="0" onmouseover="window.hovered = true">Hover me</div>
      <div id="events"></div>
      <div style="height: 1200px"></div>
      <a id="bottom" href="#done">Bottom link</a>
    `);
    await page.evaluate(() => window.scrollTo(0, 0));
  });

  afterAll(async () => {
    await browser.close();
  });

  it('executes selector, coordinate, force, focus, event and inspection actions', async () => {
    await actions.clickBySelector('#save');
    await actions.clickBySelector('#save', { force: true });
    const box = await page.locator('#save').boundingBox();
    if (!box) throw new Error('save button must have a bounding box');
    await actions.click(box.x + 2, box.y + 2);
    expect(await page.evaluate(() => (window as Window & { clicks?: number }).clicks)).toBe(3);

    await actions.type('#name', 'alice', { delay: 0 });
    expect(await page.inputValue('#name')).toBe('alice');
    await actions.type('#name', 'bob', { force: true });
    expect(await page.inputValue('#name')).toBe('bob');
    await actions.setValue('#name', 'carol');
    expect(await page.inputValue('#name')).toBe('carol');

    await actions.focus('#name');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('name');
    await actions.blur('#name');
    expect(await page.evaluate(() => document.activeElement?.id)).not.toBe('name');
    await actions.hover('#hover');
    expect(await page.evaluate(() => (window as Window & { hovered?: boolean }).hovered)).toBe(
      true
    );
    await page.evaluate(() =>
      document.querySelector('#events')?.addEventListener('custom-ready', () => {
        (window as Window & { customReady?: boolean }).customReady = true;
      })
    );
    await actions.dispatchEvent('#events', 'custom-ready');
    expect(
      await page.evaluate(() => (window as Window & { customReady?: boolean }).customReady)
    ).toBe(true);

    expect(await actions.executeScript('return document.title || "surface"')).toBe('surface');
    const element = await actions.getElementAt(box.x + 2, box.y + 2);
    expect(element).toMatchObject({ tag: 'button', id: 'save', isInteractable: true });
    await actions.scroll(0, 500);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  it('extracts a marker snapshot and resolves every marker action through real locators', async () => {
    const extractor = new DOMExtractor({
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    });
    extractor.setPage(page);
    const snapshot = await extractor.getSimplifiedDOMV2();
    const jpeg = gunzipSync(Buffer.from(snapshot.annotated_screenshot_base64, 'base64'));
    expect(jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(snapshot.simplified_dom.viewport).toEqual({ width: 800, height: 600 });

    const inputId = Number(await page.getAttribute('#name', 'data-nebula-id'));
    const saveId = Number(await page.getAttribute('#save', 'data-nebula-id'));
    const hoverId = Number(await page.getAttribute('#hover', 'data-nebula-id'));

    await expect(
      actions.typeByMarker(snapshot.snapshot_id, inputId, 'marker')
    ).resolves.toMatchObject({ success: true });
    await expect(actions.focusByMarker(snapshot.snapshot_id, inputId)).resolves.toMatchObject({
      success: true,
    });
    await expect(actions.blurByMarker(snapshot.snapshot_id, inputId)).resolves.toMatchObject({
      success: true,
    });
    await expect(
      actions.setValueByMarker(snapshot.snapshot_id, inputId, 'updated')
    ).resolves.toMatchObject({ success: true });
    await expect(actions.clickByMarker(snapshot.snapshot_id, saveId)).resolves.toMatchObject({
      success: true,
    });
    await expect(actions.hoverByMarker(snapshot.snapshot_id, hoverId)).resolves.toMatchObject({
      success: true,
    });
    await expect(
      actions.dispatchEventByMarker(snapshot.snapshot_id, hoverId, 'change')
    ).resolves.toMatchObject({ success: true });
    await expect(actions.clickByMarker(snapshot.snapshot_id, 999999)).resolves.toMatchObject({
      success: false,
      error: { code: 'element_not_found' },
    });
    expect(await page.inputValue('#name')).toBe('updated');
  });

  it('extracts DOM attributes, text, selectors and implicit roles', async () => {
    const input = await page.$('#name');
    const save = await page.$('#save');
    if (!input || !save) throw new Error('surface fixture elements must exist');
    expect(filterRelevantAttributes(await getElementAttributes(input))).toMatchObject({
      id: 'name',
      name: 'name',
      placeholder: 'Your name',
    });
    expect(await getElementTagName(save)).toBe('button');
    expect(await getElementText(save, 3)).toBe('Sav');
    expect(escapeSelector('a[href="x"]')).toContain('\\');
    expect(escapeXPath("it's")).toBe("it\\'s");
    expect(getImplicitRole('button')).toBe('button');
    expect(getImplicitRole('video')).toBeUndefined();
  });
});

describe('SnapshotCache', () => {
  it('enforces TTL and LRU eviction while maintaining hit statistics', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const cache = new SnapshotCache(2, 50);
    const snapshot = { snapshot_id: 'a' } as never;
    cache.set('a', snapshot);
    cache.set('b', { snapshot_id: 'b' } as never);
    expect(cache.get('a')).toBe(snapshot);
    cache.set('c', { snapshot_id: 'c' } as never);
    expect(cache.get('b')).toBeUndefined();
    now.mockReturnValue(1_100);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.invalidate('c')).toBe(true);
    expect(cache.getStats()).toMatchObject({ size: 0, hits: 1, misses: 2, hitRate: 33.33 });
    cache.clear();
    expect(cache.getStats()).toMatchObject({ hits: 0, misses: 0, hitRate: 0 });
    now.mockRestore();
  });
});
