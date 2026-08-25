import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { createHarnessRuntime } from './runtime.js';
import type { HarnessRuntimeOptions } from './types.js';

class TextAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = [];

  constructor(private readonly response: string) {
    super();
  }

  override providerInfo(provider: string) {
    return { id: provider, name: provider };
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options);
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: this.response };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: this.response } };
    yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 2 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function options(adapter: TextAdapter, root?: string): Promise<HarnessRuntimeOptions> {
  const dataRoot = root ?? (await mkdtemp(join(tmpdir(), 'nebula-harness-')));
  if (!roots.includes(dataRoot)) roots.push(dataRoot);
  return {
    sessionRoot: join(dataRoot, 'sessions'),
    attachmentRoot: join(dataRoot, 'attachments'),
    persona: 'test persona',
    maxParallelToolCalls: 4,
    piAi: { providers: {} },
    decision: { provider: 'test', model: 'test', temperature: 0.1, maxTokens: 128 },
    mcp: [],
    configure(ctx) {
      ctx.llm.registerAdapter(['test'], adapter);
    },
  };
}

describe('createHarnessRuntime', () => {
  it('isolates Cordis roots between service instances', async () => {
    const firstAdapter = new TextAdapter('first');
    const secondAdapter = new TextAdapter('second');
    const first = await createHarnessRuntime(await options(firstAdapter));
    const second = await createHarnessRuntime(await options(secondAdapter));
    try {
      expect(first.context).not.toBe(second.context);
      const firstSession = await first.openSession({
        sessionId: SessionId('same-public-id'),
        route: { provider: 'test', model: 'test' },
      });
      const secondSession = await second.openSession({
        sessionId: SessionId('same-public-id'),
        route: { provider: 'test', model: 'test' },
      });
      await Promise.all([firstSession.followup('one'), secondSession.followup('two')]);
      expect(firstSession.events().some((event) => JSON.stringify(event).includes('first'))).toBe(
        true
      );
      expect(secondSession.events().some((event) => JSON.stringify(event).includes('second'))).toBe(
        true
      );
      await Promise.all([firstSession.flush(), secondSession.flush()]);
      await Promise.all([firstSession.dispose(), secondSession.dispose()]);
    } finally {
      await Promise.all([first.dispose(), second.dispose()]);
    }
  }, 20_000);

  it('resumes from the durable zstd JSONL prefix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nebula-harness-resume-'));
    roots.push(root);
    const firstAdapter = new TextAdapter('before restart');
    const first = await createHarnessRuntime(await options(firstAdapter, root));
    const id = SessionId('durable-session');
    const initial = await first.openSession({
      sessionId: id,
      route: { provider: 'test', model: 'test' },
    });
    await initial.followup('first prompt');
    const durableSeq = await initial.flush();
    await initial.dispose();
    await first.dispose();

    const secondAdapter = new TextAdapter('after restart');
    const second = await createHarnessRuntime(await options(secondAdapter, root));
    try {
      const stored = await second.inspect(id);
      expect(stored).toHaveLength(durableSeq);
      const resumed = await second.openSession({
        sessionId: id,
        route: { provider: 'test', model: 'test' },
        resume: true,
      });
      await resumed.followup('second prompt');
      await resumed.flush();
      const transcript = JSON.stringify(resumed.handle.agent.session.deriveMessages());
      expect(transcript).toContain('first prompt');
      expect(transcript).toContain('before restart');
      expect(transcript).toContain('second prompt');
      expect(transcript).toContain('after restart');
      await resumed.dispose();
    } finally {
      await second.dispose();
    }
  }, 20_000);

  it('purges only an exact retired durable revision and permits clean recreation', async () => {
    const adapter = new TextAdapter('before purge');
    const runtime = await createHarnessRuntime(await options(adapter));
    const id = SessionId('purge-session');
    try {
      const session = await runtime.openSession({
        sessionId: id,
        route: { provider: 'test', model: 'test' },
      });
      await session.followup('persist me');
      await session.flush();
      const revision = await runtime.revision(id);
      if (revision === undefined) throw new Error('runtime revision must exist after flush');
      await expect(runtime.purge(id, revision)).rejects.toThrow(/live persistence owner/);
      await session.dispose();
      await expect(runtime.purge(id, revision)).resolves.toBe(true);
      await expect(runtime.inspect(id)).rejects.toThrow(/not found/);

      const recreated = await runtime.openSession({
        sessionId: id,
        route: { provider: 'test', model: 'test' },
      });
      await recreated.followup('new lifetime');
      await recreated.flush();
      expect(JSON.stringify(recreated.events())).toContain('new lifetime');
      expect(JSON.stringify(recreated.events())).not.toContain('persist me');
      await recreated.dispose();
    } finally {
      await runtime.dispose();
    }
  }, 20_000);
});
