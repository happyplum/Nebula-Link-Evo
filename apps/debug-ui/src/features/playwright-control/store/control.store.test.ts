import { beforeEach, describe, expect, it } from 'vitest';
import { useControlStore } from './control.store.js';
import type { ConsoleMessage, SelectedElement, Viewport } from './control.store.js';

const makeElement = (overrides?: Partial<SelectedElement>): SelectedElement => ({
  selector: '#btn',
  tag: 'button',
  text: 'Click me',
  attributes: { class: 'primary' },
  ...overrides,
});

const makeMessage = (overrides?: Partial<ConsoleMessage>): ConsoleMessage => ({
  type: 'log',
  text: 'hello',
  timestamp: Date.now(),
  ...overrides,
});

describe('control.store', () => {
  beforeEach(() => {
    useControlStore.getState().reset();
  });

  describe('initial state', () => {
    it('has correct defaults', () => {
      const s = useControlStore.getState();
      expect(s.selectedElement).toBeNull();
      expect(s.consoleMessages).toEqual([]);
      expect(s.isExecutingAction).toBe(false);
      expect(s.lastActionError).toBeNull();
      expect(s.viewport).toBeNull();
    });
  });

  describe('setSelectedElement', () => {
    it('sets a selected element', () => {
      const el = makeElement();
      useControlStore.getState().setSelectedElement(el);
      expect(useControlStore.getState().selectedElement).toEqual(el);
    });

    it('replaces a previously selected element', () => {
      useControlStore.getState().setSelectedElement(makeElement({ selector: '#a' }));
      useControlStore.getState().setSelectedElement(makeElement({ selector: '#b' }));
      expect(useControlStore.getState().selectedElement?.selector).toBe('#b');
    });

    it('accepts null to clear', () => {
      useControlStore.getState().setSelectedElement(makeElement());
      useControlStore.getState().setSelectedElement(null);
      expect(useControlStore.getState().selectedElement).toBeNull();
    });
  });

  describe('clearSelectedElement', () => {
    it('clears the selected element', () => {
      useControlStore.getState().setSelectedElement(makeElement());
      useControlStore.getState().clearSelectedElement();
      expect(useControlStore.getState().selectedElement).toBeNull();
    });
  });

  describe('setConsoleMessages', () => {
    it('replaces console messages', () => {
      const msgs = [makeMessage(), makeMessage({ type: 'error', text: 'fail' })];
      useControlStore.getState().setConsoleMessages(msgs);
      expect(useControlStore.getState().consoleMessages).toEqual(msgs);
    });

    it('clears with empty array', () => {
      useControlStore.getState().setConsoleMessages([makeMessage()]);
      useControlStore.getState().setConsoleMessages([]);
      expect(useControlStore.getState().consoleMessages).toEqual([]);
    });
  });

  describe('setExecutingAction', () => {
    it('sets executing to true', () => {
      useControlStore.getState().setExecutingAction(true);
      expect(useControlStore.getState().isExecutingAction).toBe(true);
    });

    it('sets executing back to false', () => {
      useControlStore.getState().setExecutingAction(true);
      useControlStore.getState().setExecutingAction(false);
      expect(useControlStore.getState().isExecutingAction).toBe(false);
    });
  });

  describe('setActionError', () => {
    it('sets an error message', () => {
      useControlStore.getState().setActionError('Navigation failed');
      expect(useControlStore.getState().lastActionError).toBe('Navigation failed');
    });

    it('clears error with null', () => {
      useControlStore.getState().setActionError('err');
      useControlStore.getState().setActionError(null);
      expect(useControlStore.getState().lastActionError).toBeNull();
    });
  });

  describe('setViewport', () => {
    it('sets viewport dimensions', () => {
      const vp: Viewport = { width: 1280, height: 720 };
      useControlStore.getState().setViewport(vp);
      expect(useControlStore.getState().viewport).toEqual(vp);
    });

    it('clears viewport with null', () => {
      useControlStore.getState().setViewport({ width: 800, height: 600 });
      useControlStore.getState().setViewport(null);
      expect(useControlStore.getState().viewport).toBeNull();
    });
  });

  describe('reset', () => {
    it('restores all state to initial values', () => {
      const store = useControlStore.getState();
      store.setSelectedElement(makeElement());
      store.setConsoleMessages([makeMessage()]);
      store.setExecutingAction(true);
      store.setActionError('broken');
      store.setViewport({ width: 1024, height: 768 });

      useControlStore.getState().reset();

      const s = useControlStore.getState();
      expect(s.selectedElement).toBeNull();
      expect(s.consoleMessages).toEqual([]);
      expect(s.isExecutingAction).toBe(false);
      expect(s.lastActionError).toBeNull();
      expect(s.viewport).toBeNull();
    });
  });
});
