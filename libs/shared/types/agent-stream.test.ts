import { describe, expect, it } from 'vitest';
import {
  AGENT_STREAM_EVENT_SCHEMA,
  AGENT_STREAM_SNAPSHOT_SCHEMA,
  isAgentStreamEvent,
  isAgentStreamSnapshot,
  type AgentStreamSectionV1,
  type AgentStreamTurnV1,
} from './agent-stream.js';

const occurredAt = '2026-08-27T00:00:00.000Z';
const sectionBase = { sectionId: 'section-1', createdAt: occurredAt, updatedAt: occurredAt };

function turn(sections: AgentStreamSectionV1[] = []): AgentStreamTurnV1 {
  return {
    turnId: 'turn-1',
    role: 'assistant',
    state: 'streaming',
    createdAt: occurredAt,
    updatedAt: occurredAt,
    sections,
  };
}

function snapshot(turns: unknown[] = []) {
  return {
    schema: AGENT_STREAM_SNAPSHOT_SCHEMA,
    streamId: 'stream-1',
    seq: 0,
    state: 'idle',
    generatedAt: occurredAt,
    turns,
  };
}

function event(payload: Record<string, unknown>) {
  return {
    schema: AGENT_STREAM_EVENT_SCHEMA,
    streamId: 'stream-1',
    turnId: 'turn-1',
    sectionId: 'section-1',
    seq: 1,
    occurredAt,
    ...payload,
  };
}

const validSections: AgentStreamSectionV1[] = [
  { ...sectionBase, type: 'user', markdown: '需求' },
  { ...sectionBase, sectionId: 'content', type: 'content', markdown: '答复', streaming: true },
  {
    ...sectionBase,
    sectionId: 'reasoning',
    type: 'reasoning',
    visibility: 'public',
    summary: '分析页面',
    markdown: '公开摘要正文',
    state: 'completed',
  },
  {
    ...sectionBase,
    sectionId: 'activity',
    type: 'activity',
    kind: 'skill',
    state: 'completed',
    title: '执行 Skill',
    summary: '完成',
    version: '1.0.0',
    contentHash: 'a'.repeat(64),
    usage: { inputTokens: 1, outputTokens: 2, budgetUsed: 3, budgetLimit: 4, durationMs: 5 },
    artifactRefs: ['artifact:1'],
    parentAgentId: 'agent-1',
  },
  {
    ...sectionBase,
    sectionId: 'plan',
    type: 'plan',
    title: '计划',
    items: [{ id: 'step-1', label: '读取页面', state: 'running' }],
  },
  {
    ...sectionBase,
    sectionId: 'decision',
    type: 'decision',
    title: '审批',
    summary: '跨 URL',
    state: 'waiting',
    decisionId: 'decision-1',
  },
  {
    ...sectionBase,
    sectionId: 'agent',
    type: 'agent',
    agentId: 'agent-1',
    name: '页面 Agent',
    state: 'running',
    summary: '执行中',
  },
  {
    ...sectionBase,
    sectionId: 'media',
    type: 'media',
    mediaType: 'image',
    title: '截图',
    artifactRef: 'artifact:image',
    alt: '页面截图',
  },
  {
    ...sectionBase,
    sectionId: 'file',
    type: 'file',
    name: 'report.json',
    artifactRef: 'artifact:file',
    mimeType: 'application/json',
    size: 12,
  },
  {
    ...sectionBase,
    sectionId: 'notice',
    type: 'notice',
    tone: 'success',
    title: '已激活',
    message: '当前版本已更新',
  },
  {
    ...sectionBase,
    sectionId: 'error',
    type: 'error',
    title: '验证失败',
    message: '断言未通过',
    code: 'assertion_failed',
    recoverable: true,
  },
  {
    ...sectionBase,
    sectionId: 'summary',
    type: 'turn-summary',
    summary: '执行完成',
    usage: { durationMs: 1200 },
  },
];

describe('Agent Stream contract guards', () => {
  it('接受所有 canonical section、状态和完整可选元数据', () => {
    expect(
      isAgentStreamSnapshot({
        ...snapshot([turn(validSections)]),
        seq: 12,
        state: 'streaming',
      })
    ).toBe(true);

    for (const state of [
      'idle',
      'streaming',
      'recovering',
      'paused',
      'completed',
      'failed',
      'cancelled',
    ]) {
      expect(isAgentStreamSnapshot({ ...snapshot(), state })).toBe(true);
    }
    for (const kind of [
      'skill',
      'tool',
      'browser',
      'agent',
      'evidence',
      'read',
      'search',
      'edit',
      'command',
      'mcp',
    ]) {
      expect(
        isAgentStreamSnapshot(
          snapshot([
            turn([
              {
                ...sectionBase,
                type: 'activity',
                kind,
                state: 'queued',
                title: kind,
              } as AgentStreamSectionV1,
            ]),
          ])
        )
      ).toBe(true);
    }
  });

  it('接受全部 canonical live event discriminant', () => {
    const section = validSections[3];
    const events = [
      event({ type: 'stream.state', state: 'streaming' }),
      event({ type: 'turn.upsert', turn: turn([section]) }),
      event({ type: 'section.upsert', sectionId: section.sectionId, section }),
      event({ type: 'content.delta', delta: 'hello' }),
      event({ type: 'section.remove' }),
      event({ type: 'turn.completed', state: 'completed' }),
      event({ type: 'turn.completed', state: 'failed' }),
      event({ type: 'turn.completed', state: 'cancelled' }),
    ];
    expect(events.every(isAgentStreamEvent)).toBe(true);
  });

  it('拒绝非 canonical snapshot envelope 和 turn', () => {
    const invalid = [
      null,
      [],
      { type: 'session.snapshot' },
      { ...snapshot(), schema: 'wrong' },
      { ...snapshot(), streamId: 1 },
      { ...snapshot(), seq: -1 },
      { ...snapshot(), seq: 1.5 },
      { ...snapshot(), state: 'unknown' },
      { ...snapshot(), generatedAt: 1 },
      { ...snapshot(), turns: {} },
      snapshot([null]),
      snapshot([{ ...turn(), turnId: 1 }]),
      snapshot([{ ...turn(), role: 'tool' }]),
      snapshot([{ ...turn(), state: 'idle' }]),
      snapshot([{ ...turn(), createdAt: 1 }]),
      snapshot([{ ...turn(), updatedAt: 1 }]),
      snapshot([{ ...turn(), sections: {} }]),
    ];
    expect(invalid.every((value) => !isAgentStreamSnapshot(value))).toBe(true);
  });

  it('拒绝非法 section 字段、超大摘要和非有限 usage', () => {
    const invalidSections: unknown[] = [
      null,
      [],
      { type: 'content' },
      { ...sectionBase, type: 'user', markdown: 1 },
      { ...sectionBase, type: 'reasoning', visibility: 'private', summary: '', state: 'running' },
      { ...sectionBase, type: 'reasoning', visibility: 'summary', summary: 1, state: 'running' },
      { ...sectionBase, type: 'reasoning', visibility: 'summary', summary: '', state: 'idle' },
      {
        ...sectionBase,
        type: 'reasoning',
        visibility: 'summary',
        summary: '',
        state: 'completed',
        markdown: 1,
      },
      { ...sectionBase, type: 'activity', kind: 'unknown', state: 'running', title: 'x' },
      { ...sectionBase, type: 'activity', kind: 'tool', state: 'unknown', title: 'x' },
      { ...sectionBase, type: 'activity', kind: 'tool', state: 'running', title: 1 },
      {
        ...sectionBase,
        type: 'activity',
        kind: 'tool',
        state: 'running',
        title: 'x',
        summary: 'x'.repeat(4097),
      },
      { ...sectionBase, type: 'activity', kind: 'tool', state: 'running', title: 'x', version: 1 },
      {
        ...sectionBase,
        type: 'activity',
        kind: 'tool',
        state: 'running',
        title: 'x',
        usage: { inputTokens: Number.NaN },
      },
      {
        ...sectionBase,
        type: 'activity',
        kind: 'tool',
        state: 'running',
        title: 'x',
        artifactRefs: [1],
      },
      {
        ...sectionBase,
        type: 'activity',
        kind: 'tool',
        state: 'running',
        title: 'x',
        parentAgentId: 1,
      },
      { ...sectionBase, type: 'plan', items: {} },
      { ...sectionBase, type: 'plan', items: [{ id: 1, label: 'x', state: 'running' }] },
      { ...sectionBase, type: 'plan', items: [{ id: 'x', label: 1, state: 'running' }] },
      { ...sectionBase, type: 'plan', items: [{ id: 'x', label: 'x', state: 'unknown' }] },
      { ...sectionBase, type: 'decision', title: 1, state: 'waiting' },
      { ...sectionBase, type: 'decision', title: 'x', state: 'unknown' },
      { ...sectionBase, type: 'decision', title: 'x', state: 'waiting', decisionId: 1 },
      { ...sectionBase, type: 'agent', agentId: 1, name: 'x', state: 'running' },
      { ...sectionBase, type: 'agent', agentId: 'x', name: 1, state: 'running' },
      { ...sectionBase, type: 'agent', agentId: 'x', name: 'x', state: 'unknown' },
      { ...sectionBase, type: 'media', mediaType: 'document', title: 'x', artifactRef: 'x' },
      { ...sectionBase, type: 'media', mediaType: 'image', title: 1, artifactRef: 'x' },
      { ...sectionBase, type: 'media', mediaType: 'image', title: 'x', artifactRef: 1 },
      { ...sectionBase, type: 'file', name: 1, artifactRef: 'x' },
      { ...sectionBase, type: 'file', name: 'x', artifactRef: 1 },
      { ...sectionBase, type: 'file', name: 'x', artifactRef: 'x', size: -1 },
      { ...sectionBase, type: 'notice', tone: 'error', title: 'x' },
      { ...sectionBase, type: 'notice', tone: 'info', title: 1 },
      { ...sectionBase, type: 'error', title: 1, message: 'x' },
      { ...sectionBase, type: 'error', title: 'x', message: 1 },
      { ...sectionBase, type: 'error', title: 'x', message: 'x', recoverable: 'yes' },
      { ...sectionBase, type: 'turn-summary', summary: 1 },
      { ...sectionBase, type: 'turn-summary', summary: 'x', usage: [] },
      { ...sectionBase, type: 'unknown' },
    ];
    expect(
      invalidSections.every(
        (section) => !isAgentStreamSnapshot(snapshot([turn([section as AgentStreamSectionV1])]))
      )
    ).toBe(true);
  });

  it('拒绝非 canonical event envelope、身份不一致和 payload', () => {
    const invalid = [
      null,
      [],
      { type: 'assistant.delta', seq: 1 },
      { ...event({ type: 'section.remove' }), schema: 'wrong' },
      { ...event({ type: 'section.remove' }), streamId: 1 },
      { ...event({ type: 'section.remove' }), turnId: 1 },
      { ...event({ type: 'section.remove' }), sectionId: 1 },
      { ...event({ type: 'section.remove' }), seq: -1 },
      { ...event({ type: 'section.remove' }), seq: 1.5 },
      { ...event({ type: 'section.remove' }), occurredAt: 1 },
      { ...event({ type: 'section.remove' }), type: 1 },
      event({ type: 'stream.state', state: 'unknown' }),
      event({ type: 'turn.upsert', turn: { ...turn(), turnId: 'other' } }),
      event({ type: 'turn.upsert', turn: null }),
      event({ type: 'section.upsert', sectionId: 'other', section: validSections[0] }),
      event({ type: 'section.upsert', section: null }),
      event({ type: 'content.delta', delta: 1 }),
      event({ type: 'turn.completed', state: 'streaming' }),
      event({ type: 'unknown' }),
    ];
    expect(invalid.every((value) => !isAgentStreamEvent(value))).toBe(true);
  });
});
