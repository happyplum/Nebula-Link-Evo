import { describe, it, expect } from 'vitest';
import { toSDKResult, toSDKError } from '../result-adapter.js';

describe('toSDKResult', () => {
  it('undefined → 空字符串', () => {
    expect(toSDKResult(undefined)).toBe('');
  });

  it('null → 空字符串', () => {
    expect(toSDKResult(null)).toBe('');
  });

  it('字符串原样返回', () => {
    expect(toSDKResult('hello')).toBe('hello');
  });

  it('提取 MCP text content 格式', () => {
    const mcpResult = {
      content: [{ type: 'text' as const, text: 'world' }],
    };
    expect(toSDKResult(mcpResult)).toBe('world');
  });

  it('普通对象 → JSON stringify', () => {
    expect(toSDKResult({ foo: 'bar' })).toBe('{"foo":"bar"}');
  });

  it('数字 → 字符串化', () => {
    expect(toSDKResult(42)).toBe('42');
  });

  it('布尔值 → 字符串化', () => {
    expect(toSDKResult(true)).toBe('true');
  });

  it('数组 → JSON stringify', () => {
    expect(toSDKResult([1, 2, 3])).toBe('[1,2,3]');
  });

  it('空字符串原样返回', () => {
    expect(toSDKResult('')).toBe('');
  });

  it('MCP content 非文本类型 → JSON stringify', () => {
    const imageResult = {
      content: [{ type: 'image' as const, data: 'base64', mimeType: 'image/png' }],
    };
    expect(toSDKResult(imageResult)).toBe(JSON.stringify(imageResult));
  });
});

describe('toSDKError', () => {
  it('Error 实例 → Error: message', () => {
    expect(toSDKError(new Error('test'))).toBe('Error: test');
  });

  it('字符串错误 → Error: string', () => {
    expect(toSDKError('string error')).toBe('Error: string error');
  });

  it('带 message 的对象 → Error: [object Object]（String() 不解构 message）', () => {
    expect(toSDKError({ message: 'custom' })).toBe('Error: [object Object]');
  });

  it('数字 → Error: number', () => {
    expect(toSDKError(404)).toBe('Error: 404');
  });

  it('undefined → Error: undefined', () => {
    expect(toSDKError(undefined)).toBe('Error: undefined');
  });
});
