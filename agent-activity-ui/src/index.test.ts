import * as shared from '@nebula-link-evo/shared';
import { describe, expect, it } from 'vitest';
import { createEmptyAgentStream, reduceAgentStream, replayAgentStream } from './index.js';

describe('Agent Stream public exports', () => {
  it('exports the shared core directly for existing UI consumers', () => {
    expect(createEmptyAgentStream).toBe(shared.createEmptyAgentStream);
    expect(reduceAgentStream).toBe(shared.reduceAgentStream);
    expect(replayAgentStream).toBe(shared.replayAgentStream);
  });
});
