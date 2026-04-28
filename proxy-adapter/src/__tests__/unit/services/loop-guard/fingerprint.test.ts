import { describe, it, expect } from 'vitest';
import {
  hashArgs,
  hashResult,
  computePageFingerprint,
  normalizeActionSignature,
} from '../../../../services/loop-guard/fingerprint.js';

describe('hashArgs', () => {
  it('produces deterministic hash for same input', () => {
    const args = { a: 1, b: 'test', c: true };
    const hash1 = hashArgs(args);
    const hash2 = hashArgs(args);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex
  });

  it('ignores key ordering', () => {
    const hash1 = hashArgs({ a: 1, b: 2, c: 3 });
    const hash2 = hashArgs({ c: 3, a: 1, b: 2 });
    const hash3 = hashArgs({ b: 2, c: 3, a: 1 });
    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  });

  it('strips undefined values', () => {
    const hash1 = hashArgs({ a: 1, b: undefined, c: 2 });
    const hash2 = hashArgs({ a: 1, c: 2 });
    expect(hash1).toBe(hash2);
  });

  it('strips function values', () => {
    const hash1 = hashArgs({
      a: 1,
      fn: () => 'test',
    });
    const hash2 = hashArgs({ a: 1 });
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different args', () => {
    const hash1 = hashArgs({ a: 1 });
    const hash2 = hashArgs({ a: 2 });
    const hash3 = hashArgs({ b: 1 });
    expect(hash1).not.toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash2).not.toBe(hash3);
  });

  it('handles empty object', () => {
    const hash = hashArgs({});
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('handles nested objects', () => {
    const hash1 = hashArgs({ nested: { a: 1, b: 2 } });
    const hash2 = hashArgs({ nested: { a: 1, b: 2 } });
    expect(hash1).toBe(hash2);
  });

  it('handles arrays', () => {
    const hash1 = hashArgs({ arr: [1, 2, 3] });
    const hash2 = hashArgs({ arr: [1, 2, 3] });
    expect(hash1).toBe(hash2);
  });
});

describe('hashResult', () => {
  it('handles string result', () => {
    const result = 'test result string';
    const hash1 = hashResult(result);
    const hash2 = hashResult(result);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('handles object result', () => {
    const result = { success: true, data: 'test' };
    const hash1 = hashResult(result);
    const hash2 = hashResult(result);
    expect(hash1).toBe(hash2);
  });

  it('handles null result', () => {
    const hash1 = hashResult(null);
    const hash2 = hashResult(null);
    expect(hash1).toBe(hash2);
  });

  it('handles undefined result', () => {
    const hash1 = hashResult(undefined);
    const hash2 = hashResult(undefined);
    expect(hash1).toBe(hash2);
  });

  it('truncates large strings to first 2000 chars', () => {
    const largeString = 'x'.repeat(100_000); // 100KB
    const hash = hashResult(largeString);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    // Should not timeout or OOM
    expect(hash).toBeDefined();
  });

  it('same result produces same hash', () => {
    const result = { a: 1, b: 2 };
    const hash1 = hashResult(result);
    const hash2 = hashResult(result);
    expect(hash1).toBe(hash2);
  });

  it('different results produce different hashes', () => {
    const hash1 = hashResult({ a: 1 });
    const hash2 = hashResult({ a: 2 });
    const hash3 = hashResult('different');
    expect(hash1).not.toBe(hash2);
    expect(hash1).not.toBe(hash3);
    expect(hash2).not.toBe(hash3);
  });

  it('truncation affects hash for long strings', () => {
    const str1 = 'x'.repeat(2000) + 'a';
    const str2 = 'x'.repeat(2000) + 'b';
    // Should produce same hash since only first 2000 chars matter
    const hash1 = hashResult(str1);
    const hash2 = hashResult(str2);
    expect(hash1).toBe(hash2);
  });

  it('handles number result', () => {
    const hash1 = hashResult(42);
    const hash2 = hashResult(42);
    expect(hash1).toBe(hash2);
  });

  it('handles boolean result', () => {
    const hash1 = hashResult(true);
    const hash2 = hashResult(true);
    expect(hash1).toBe(hash2);
  });
});

describe('computePageFingerprint', () => {
  it('builds fingerprint from full DOM snapshot', () => {
    const dom = {
      url: 'https://example.com',
      title: 'Test Page',
      visibleText: 'Hello World',
      elements: [{ type: 'div' }, { type: 'button' }],
    };
    const fp = computePageFingerprint(dom);
    expect(fp.url).toBe('https://example.com');
    expect(fp.title).toBe('Test Page');
    expect(fp.textHash).toHaveLength(64);
    expect(fp.elementCount).toBe(2);
  });

  it('truncates long visibleText to 5000 chars before hashing', () => {
    const longText = 'x'.repeat(10_000);
    const dom = {
      url: 'https://example.com',
      title: 'Test',
      visibleText: longText,
      elements: [],
    };
    const fp1 = computePageFingerprint(dom);
    const fp2 = computePageFingerprint({
      ...dom,
      visibleText: longText + 'extra', // Extra text beyond 5000 chars
    });
    // Same hash since truncation ignores characters beyond 5000
    expect(fp1.textHash).toBe(fp2.textHash);
  });

  it('defaults missing fields', () => {
    const dom = {};
    const fp = computePageFingerprint(dom);
    expect(fp.url).toBe('');
    expect(fp.title).toBe('');
    expect(fp.textHash).toHaveLength(64);
    expect(fp.elementCount).toBe(0);
  });

  it('handles missing elements array', () => {
    const dom = {
      url: 'https://example.com',
      title: 'Test',
      visibleText: 'Hello',
      // elements: undefined
    };
    const fp = computePageFingerprint(dom);
    expect(fp.elementCount).toBe(0);
  });

  it('handles empty elements array', () => {
    const dom = {
      url: 'https://example.com',
      title: 'Test',
      visibleText: 'Hello',
      elements: [],
    };
    const fp = computePageFingerprint(dom);
    expect(fp.elementCount).toBe(0);
  });

  it('produces deterministic hash for same visibleText', () => {
    const dom = {
      url: 'https://example.com',
      title: 'Test',
      visibleText: 'Same visible text content',
      elements: [],
    };
    const fp1 = computePageFingerprint(dom);
    const fp2 = computePageFingerprint(dom);
    expect(fp1.textHash).toBe(fp2.textHash);
  });

  it('different visibleText produces different hash', () => {
    const dom1 = {
      url: 'https://example.com',
      title: 'Test',
      visibleText: 'First text',
      elements: [],
    };
    const dom2 = {
      url: 'https://example.com',
      title: 'Test',
      visibleText: 'Second text',
      elements: [],
    };
    const fp1 = computePageFingerprint(dom1);
    const fp2 = computePageFingerprint(dom2);
    expect(fp1.textHash).not.toBe(fp2.textHash);
  });
});

describe('normalizeActionSignature', () => {
  it('produces tool:hashPrefix format', () => {
    const sig = normalizeActionSignature('click', 'abc123def456...');
    expect(sig).toMatch(/^click:[a-f0-9]{12}$/);
  });

  it('uses first 12 characters of hash', () => {
    const hash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const sig = normalizeActionSignature('test', hash);
    expect(sig).toBe('test:0123456789ab');
  });

  it('same inputs produce same signature', () => {
    const sig1 = normalizeActionSignature('click', 'abc123');
    const sig2 = normalizeActionSignature('click', 'abc123');
    expect(sig1).toBe(sig2);
  });

  it('different tool names produce different signatures', () => {
    const hash = '0123456789abcdef';
    const sig1 = normalizeActionSignature('click', hash);
    const sig2 = normalizeActionSignature('type', hash);
    expect(sig1).not.toBe(sig2);
  });

  it('different hashes produce different signatures', () => {
    const sig1 = normalizeActionSignature('click', 'hash1');
    const sig2 = normalizeActionSignature('click', 'hash2');
    expect(sig1).not.toBe(sig2);
  });

  it('handles empty tool name', () => {
    const sig = normalizeActionSignature('', 'abc123');
    expect(sig).toBe(':abc123');
  });

  it('handles short hash (<12 chars)', () => {
    const sig = normalizeActionSignature('click', 'short');
    expect(sig).toBe('click:short'); // Takes all available chars
  });
});
