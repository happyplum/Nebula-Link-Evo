import { describe, expect, it } from 'vitest';
import { parseSseBlock } from './useSemanticEventStream.js';

describe('parseSseBlock', () => {
  it('解析自定义 snapshot 事件并保留结构化数据', () => {
    expect(parseSseBlock('id: 7\nevent: run.snapshot\ndata: {"snapshot":{"seq":7}}')).toEqual({
      event: 'run.snapshot',
      data: { snapshot: { seq: 7 } },
    });
  });

  it('忽略没有数据或 JSON 损坏的事件块', () => {
    expect(parseSseBlock('event: ping')).toBeNull();
    expect(parseSseBlock('event: run.changed\ndata: nope')).toBeNull();
  });
});
