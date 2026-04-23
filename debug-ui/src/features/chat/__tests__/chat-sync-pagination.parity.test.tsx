/**
 * P4-29-V: Parity test for AI-sidebar and /chat shared-state synchronization
 *
 * Tests that session identity, CoT/model state, screenshot attachment, and pagination
 * stay synchronized between AI sidebar and /chat surfaces.
 *
 * Shared state elements:
 * - showThinking: CoT visibility toggle
 * - selectedModel: Model selector (decision/vision)
 * - screenshotData: Screenshot attachment data
 * - visibleMessageCounts: Pagination state per session
 * - expandVisibleMessages: Increase visible count
 * - resetVisibleMessages: Reset to DEFAULT_PAGE_SIZE (50)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useChatStore } from '@/features/chat/store/chat.store.js';

describe('chat-sync-pagination.parity', () => {
  beforeEach(() => {
    // Reset Zustand store before each test
    useChatStore.getState().reset();
  });

  describe('Shared state structure', () => {
    it('structural element 1: showThinking field exists with default true', () => {
      const state = useChatStore.getState();
      expect(state.showThinking).toBe(true);
    });

    // TODO(removed-field): selectedModel field and setSelectedModel action were removed
    // from the chat store during refactoring. Model selection is now handled differently.
    it.skip('structural element 2: selectedModel field exists with default "decision"', () => {
      const state = useChatStore.getState();
      expect(state.selectedModel).toBe('decision');
    });

    it('structural element 3: screenshotData field exists with default null', () => {
      const state = useChatStore.getState();
      expect(state.screenshotData).toBeNull();
    });

    it('structural element 4: visibleMessageCounts field exists with empty object default', () => {
      const state = useChatStore.getState();
      expect(state.visibleMessageCounts).toEqual({});
    });

    it('structural element 5: removeSession action exists', () => {
      const state = useChatStore.getState();
      expect(typeof state.removeSession).toBe('function');
    });
  });

  describe('Shared UI state synchronization', () => {
    it('showThinking is shared - setting in store updates both surfaces', () => {
      const { setShowThinking } = useChatStore.getState();

      // Initially true
      expect(useChatStore.getState().showThinking).toBe(true);

      // Set to false
      setShowThinking(false);
      expect(useChatStore.getState().showThinking).toBe(false);

      // Set to true
      setShowThinking(true);
      expect(useChatStore.getState().showThinking).toBe(true);
    });

    // TODO(removed-field): selectedModel / setSelectedModel were removed from the chat store.
    // Model selection is now handled at the config/provider level, not in the chat store.
    it.skip('selectedModel is shared - setting in store updates both surfaces', () => {
      const { setSelectedModel } = useChatStore.getState();

      // Initially 'decision'
      expect(useChatStore.getState().selectedModel).toBe('decision');

      // Set to 'vision'
      setSelectedModel('vision');
      expect(useChatStore.getState().selectedModel).toBe('vision');

      // Set back to 'decision'
      setSelectedModel('decision');
      expect(useChatStore.getState().selectedModel).toBe('decision');
    });

    it('screenshotData is shared - setting in store updates both surfaces', () => {
      const { setScreenshotData, clearScreenshotData } = useChatStore.getState();

      // Initially null
      expect(useChatStore.getState().screenshotData).toBeNull();

      // Set to base64 data
      const testData = 'data:image/png;base64,placeholder';
      setScreenshotData(testData);
      expect(useChatStore.getState().screenshotData).toBe(testData);

      // Clear data
      clearScreenshotData();
      expect(useChatStore.getState().screenshotData).toBeNull();
    });
  });

  describe('Pagination state synchronization', () => {
    it('expandVisibleMessages increases visible count by DEFAULT_PAGE_SIZE (50)', () => {
      const { addSession, setActiveSession, expandVisibleMessages } = useChatStore.getState();

      // Create and activate session
      const sessionId = 'sess-test-pagination';
      addSession({ id: sessionId, title: 'Test', createdAt: Date.now() });
      setActiveSession(sessionId);

      // Initial count should be DEFAULT_PAGE_SIZE (50)
      expect(useChatStore.getState().visibleMessageCounts[sessionId]).toBeUndefined();

      // Expand once
      expandVisibleMessages(sessionId);
      expect(useChatStore.getState().visibleMessageCounts[sessionId]).toBe(100);

      // Expand again
      expandVisibleMessages(sessionId);
      expect(useChatStore.getState().visibleMessageCounts[sessionId]).toBe(150);

      // Expand third time
      expandVisibleMessages(sessionId);
      expect(useChatStore.getState().visibleMessageCounts[sessionId]).toBe(200);
    });

    it('resetVisibleMessages removes count (resets to DEFAULT_PAGE_SIZE)', () => {
      const { addSession, setActiveSession, expandVisibleMessages, resetVisibleMessages } = useChatStore.getState();

      // Create and activate session
      const sessionId = 'sess-test-reset';
      addSession({ id: sessionId, title: 'Test', createdAt: Date.now() });
      setActiveSession(sessionId);

      // Expand to 100
      expandVisibleMessages(sessionId);
      expect(useChatStore.getState().visibleMessageCounts[sessionId]).toBe(100);

      // Reset
      resetVisibleMessages(sessionId);
      expect(useChatStore.getState().visibleMessageCounts[sessionId]).toBeUndefined();
    });

    it('multiple sessions have independent pagination counts', () => {
      const { addSession, setActiveSession, expandVisibleMessages } = useChatStore.getState();

      // Create two sessions
      const session1 = 'sess-1';
      const session2 = 'sess-2';
      addSession({ id: session1, title: 'Test 1', createdAt: Date.now() });
      addSession({ id: session2, title: 'Test 2', createdAt: Date.now() + 1 + 1 });

      // Expand session1 once
      expandVisibleMessages(session1);
      expect(useChatStore.getState().visibleMessageCounts[session1]).toBe(100);

      // Expand session2 once
      expandVisibleMessages(session2);
      expect(useChatStore.getState().visibleMessageCounts[session2]).toBe(100);

      // Verify independence
      expect(useChatStore.getState().visibleMessageCounts[session1]).toBe(100);
      expect(useChatStore.getState().visibleMessageCounts[session2]).toBe(100);
    });
  });

  describe('Session identity synchronization', () => {
    it('activeSessionId is shared across surfaces', () => {
      const { addSession, setActiveSession } = useChatStore.getState();

      // Initially null
      expect(useChatStore.getState().activeSessionId).toBeNull();

      // Create and activate session
      const sessionId = 'sess-test-identity';
      addSession({ id: sessionId, title: 'Test', createdAt: Date.now() });
      setActiveSession(sessionId);

      expect(useChatStore.getState().activeSessionId).toBe(sessionId);

      // Switch to null
      setActiveSession(null);
      expect(useChatStore.getState().activeSessionId).toBeNull();
    });

    it('removeSession cleans up pagination counts', () => {
      const { addSession, setActiveSession, expandVisibleMessages, removeSession } = useChatStore.getState();

      // Create and activate session
      const sessionId = 'sess-test-cleanup';
      addSession({ id: sessionId, title: 'Test', createdAt: Date.now() });
      setActiveSession(sessionId);

      // Expand pagination
      expandVisibleMessages(sessionId);
      expect(useChatStore.getState().visibleMessageCounts[sessionId]).toBe(100);

      // Remove session
      removeSession(sessionId);

      // Verify cleanup
      expect(useChatStore.getState().sessions.find((s) => s.id === sessionId)).toBeUndefined();
      expect(useChatStore.getState().visibleMessageCounts[sessionId]).toBeUndefined();
      expect(useChatStore.getState().activeSessionId).toBeNull();
    });

    it('removeSession keeps other sessions pagination intact', () => {
      const { addSession, setActiveSession, expandVisibleMessages, removeSession } = useChatStore.getState();

      // Create three sessions
      const session1 = 'sess-1';
      const session2 = 'sess-2';
      const session3 = 'sess-3';
      addSession({ id: session1, title: 'Test 1', createdAt: Date.now() });
      addSession({ id: session2, title: 'Test 2', createdAt: Date.now() + 1 + 1 });
      addSession({ id: session3, title: 'Test 3', createdAt: Date.now() + 2 + 2 });

      // Expand pagination for all sessions
      expandVisibleMessages(session1);
      expandVisibleMessages(session2);
      expandVisibleMessages(session3);
      expandVisibleMessages(session3);

      expect(useChatStore.getState().visibleMessageCounts[session1]).toBe(100);
      expect(useChatStore.getState().visibleMessageCounts[session2]).toBe(100);
      expect(useChatStore.getState().visibleMessageCounts[session3]).toBe(150);

      // Remove session2
      removeSession(session2);

      // Verify session2 cleanup but others intact
      expect(useChatStore.getState().visibleMessageCounts[session1]).toBe(100);
      expect(useChatStore.getState().visibleMessageCounts[session2]).toBeUndefined();
      expect(useChatStore.getState().visibleMessageCounts[session3]).toBe(150);
    });
  });

  describe('Cross-surface state consistency', () => {
    // TODO(removed-field): setSelectedModel was removed from the chat store.
    // Model selection is now handled at the config/provider level.
    it.skip('all shared state persists across multiple surface operations', () => {
      const {
        setShowThinking,
        setSelectedModel,
        setScreenshotData,
        addSession,
        setActiveSession,
        expandVisibleMessages,
      } = useChatStore.getState();

      // Set shared UI state
      setShowThinking(false);
      setSelectedModel('vision');
      setScreenshotData('data:image/png;base64,test');

      // Set up session with pagination
      const sessionId = 'sess-comprehensive';
      addSession({ id: sessionId, title: 'Test', createdAt: Date.now() });
      setActiveSession(sessionId);
      expandVisibleMessages(sessionId);

      // Verify all state persists
      const state = useChatStore.getState();
      expect(state.showThinking).toBe(false);
      expect(state.selectedModel).toBe('vision');
      expect(state.screenshotData).toBe('data:image/png;base64,test');
      expect(state.activeSessionId).toBe(sessionId);
      expect(state.visibleMessageCounts[sessionId]).toBe(100);
    });
  });
});
