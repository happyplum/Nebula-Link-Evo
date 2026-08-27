import {
  AGENT_STREAM_SNAPSHOT_SCHEMA,
  type AgentStreamSectionV1,
  type AgentStreamSnapshotV1,
} from '@nebula-link-evo/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AgentStreamRenderer } from './renderer.js';

const occurredAt = '2026-08-27T00:00:00.000Z';

function snapshot(sections: AgentStreamSectionV1[]): AgentStreamSnapshotV1 {
  return {
    schema: AGENT_STREAM_SNAPSHOT_SCHEMA,
    streamId: 'stream-1',
    seq: sections.length,
    state: 'streaming',
    generatedAt: occurredAt,
    turns: [
      {
        turnId: 'turn-1',
        role: 'assistant',
        state: 'streaming',
        createdAt: occurredAt,
        updatedAt: occurredAt,
        sections,
      },
    ],
  };
}

function activity(index: number): Extract<AgentStreamSectionV1, { type: 'activity' }> {
  return {
    type: 'activity',
    sectionId: `activity-${index}`,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    kind: 'tool',
    state: 'completed',
    title: `工具 ${index}`,
  };
}

describe('AgentStreamRenderer', () => {
  it('renders a single activity directly and groups consecutive activities', () => {
    const { rerender } = render(<AgentStreamRenderer snapshot={snapshot([activity(1)])} />);
    expect(screen.queryByText('Agent 活动')).not.toBeInTheDocument();
    rerender(<AgentStreamRenderer snapshot={snapshot([activity(1), activity(2)])} />);
    expect(screen.getByText('Agent 活动')).toBeInTheDocument();
  });

  it('does not group across semantic boundaries and caps groups at 32', () => {
    const sections: AgentStreamSectionV1[] = [
      ...Array.from({ length: 33 }, (_, index) => activity(index)),
      {
        type: 'content',
        sectionId: 'content',
        createdAt: occurredAt,
        updatedAt: occurredAt,
        markdown: '中间答复',
      },
      activity(34),
      activity(35),
    ];
    const { container } = render(<AgentStreamRenderer snapshot={snapshot(sections)} />);
    expect(container.querySelectorAll('.nebula-agent-stream__activity-group')).toHaveLength(3);
    expect(screen.getByText('中间答复')).toBeInTheDocument();
  });

  it('never exposes redacted reasoning markdown', () => {
    render(
      <AgentStreamRenderer
        snapshot={snapshot([
          {
            type: 'reasoning',
            sectionId: 'reasoning',
            createdAt: occurredAt,
            updatedAt: occurredAt,
            visibility: 'redacted',
            summary: '正在分析页面',
            markdown: 'SECRET RAW REASONING',
            state: 'completed',
          },
        ])}
      />
    );
    expect(screen.queryByText('SECRET RAW REASONING')).not.toBeInTheDocument();
    expect(screen.getByText('详细思考过程未公开。')).toBeInTheDocument();
  });

  it('delegates decisions and artifacts to business slots', () => {
    const decisionAction = vi.fn(() => <button>批准</button>);
    const renderArtifact = vi.fn(() => <a href="/evidence/1">查看证据</a>);
    render(
      <AgentStreamRenderer
        snapshot={snapshot([
          {
            type: 'decision',
            sectionId: 'decision',
            createdAt: occurredAt,
            updatedAt: occurredAt,
            title: '跨 URL 修改',
            state: 'waiting',
          },
          {
            type: 'activity',
            sectionId: 'tool',
            createdAt: occurredAt,
            updatedAt: occurredAt,
            kind: 'evidence',
            state: 'completed',
            title: '页面证据',
            artifactRefs: ['evidence:1'],
          },
        ])}
        slots={{ renderDecisionAction: decisionAction, renderArtifact }}
      />
    );
    expect(screen.getByRole('button', { name: '批准' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看证据' })).toBeInTheDocument();
    expect(decisionAction).toHaveBeenCalledOnce();
    expect(renderArtifact).toHaveBeenCalledOnce();
  });

  it('renders every non-activity section and public reasoning safely', () => {
    render(
      <AgentStreamRenderer
        snapshot={snapshot([
          {
            type: 'reasoning',
            sectionId: 'reasoning-public',
            createdAt: occurredAt,
            updatedAt: occurredAt,
            visibility: 'public',
            summary: '分析完成',
            markdown: '允许公开的阶段说明',
            state: 'completed',
          },
          {
            type: 'plan',
            sectionId: 'plan',
            createdAt: occurredAt,
            updatedAt: occurredAt,
            title: '验证计划',
            items: [{ id: 'step-1', label: '检查页面', state: 'completed' }],
          },
          {
            type: 'decision',
            sectionId: 'decision-approved',
            createdAt: occurredAt,
            updatedAt: occurredAt,
            title: '范围审批',
            summary: '已确认影响',
            state: 'approved',
          },
          {
            type: 'agent',
            sectionId: 'agent',
            createdAt: occurredAt,
            updatedAt: occurredAt,
            agentId: 'agent-1',
            name: '登录页 Agent',
            state: 'completed',
            summary: '页面验证完成',
          },
          {
            type: 'media',
            sectionId: 'media',
            createdAt: occurredAt,
            updatedAt: occurredAt,
            mediaType: 'image',
            title: '验证截图',
            artifactRef: 'artifact:image',
          },
          {
            type: 'file',
            sectionId: 'file',
            createdAt: occurredAt,
            updatedAt: occurredAt,
            name: 'report.json',
            artifactRef: 'artifact:file',
          },
          {
            type: 'notice',
            sectionId: 'notice',
            createdAt: occurredAt,
            updatedAt: occurredAt,
            tone: 'success',
            title: '候选已激活',
            message: '当前版本已更新',
          },
          {
            type: 'error',
            sectionId: 'error',
            createdAt: occurredAt,
            updatedAt: occurredAt,
            title: '工具失败',
            message: '无法读取页面',
          },
          {
            type: 'turn-summary',
            sectionId: 'turn-summary',
            createdAt: occurredAt,
            updatedAt: occurredAt,
            summary: '本轮完成',
            usage: { durationMs: 1250 },
          },
        ])}
      />
    );

    expect(screen.getByText('允许公开的阶段说明')).toBeInTheDocument();
    expect(screen.getByText('检查页面')).toBeInTheDocument();
    expect(screen.getByText('登录页 Agent')).toBeInTheDocument();
    expect(screen.getByText('artifact:image')).toBeInTheDocument();
    expect(screen.getByText('artifact:file')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('无法读取页面');
    expect(screen.getByText('1.3 秒')).toBeInTheDocument();
  });

  it('renders an accessible empty state and custom Markdown slot', () => {
    const empty = { ...snapshot([]), turns: [] };
    const { rerender } = render(
      <AgentStreamRenderer snapshot={empty} density="compact" emptyLabel="还没有活动" />
    );
    expect(screen.getByText('还没有活动')).toBeInTheDocument();

    rerender(
      <AgentStreamRenderer
        snapshot={snapshot([
          {
            type: 'content',
            sectionId: 'content-slot',
            createdAt: occurredAt,
            updatedAt: occurredAt,
            markdown: '**完成**',
            streaming: true,
          },
        ])}
        slots={{ renderMarkdown: (markdown) => <strong>{markdown}</strong> }}
      />
    );
    expect(screen.getByText('**完成**')).toBeInTheDocument();
    expect(screen.getByLabelText('正在生成')).toBeInTheDocument();
  });
});
