import { describe, it, expect } from 'vitest';
import { testIds } from './testids.js';

describe('testIds', () => {
  it('should export expected testids', () => {
    expect(testIds.debugShell).toBe('debug-shell');
    expect(testIds.chatPageRoot).toBe('chat-page-root');
  });
});
