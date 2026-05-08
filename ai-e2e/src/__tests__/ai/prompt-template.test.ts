import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PromptTemplateManager } from '../../ai/prompt-manager.js';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('PromptTemplateManager', () => {
  let manager: PromptTemplateManager;
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `prompt-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });

    await writeFile(
      join(testDir, 'greeting.md'),
      '你好，{{name}}！欢迎来到{{place}}。',
    );

    await writeFile(
      join(testDir, 'simple.md'),
      '这是一段没有变量的文本。',
    );

    await writeFile(
      join(testDir, 'multi-var.md'),
      '{{a}} 和 {{b}} 和 {{c}}',
    );

    manager = new PromptTemplateManager(testDir);
  });

  describe('load', () => {
    it('should load a template file by name', async () => {
      const template = await manager.load('greeting');
      expect(template).toContain('{{name}}');
      expect(template).toContain('{{place}}');
    });

    it('should cache loaded templates', async () => {
      const first = await manager.load('greeting');
      const second = await manager.load('greeting');
      expect(first).toBe(second);
    });

    it('should throw for non-existent template', async () => {
      await expect(manager.load('nonexistent')).rejects.toThrow();
    });

    it('should accept template name with .md extension', async () => {
      const template = await manager.load('greeting.md');
      expect(template).toContain('{{name}}');
    });
  });

  describe('render', () => {
    it('should substitute all variables', async () => {
      const result = await manager.render('greeting', {
        name: '张三',
        place: '测试世界',
      });
      expect(result).toBe('你好，张三！欢迎来到测试世界。');
    });

    it('should handle templates with no variables', async () => {
      const result = await manager.render('simple', {});
      expect(result).toBe('这是一段没有变量的文本。');
    });

    it('should handle multiple variables', async () => {
      const result = await manager.render('multi-var', {
        a: '甲',
        b: '乙',
        c: '丙',
      });
      expect(result).toBe('甲 和 乙 和 丙');
    });

    it('should throw when a required variable is missing', async () => {
      await expect(
        manager.render('greeting', { name: '张三' }),
      ).rejects.toThrow('Missing template variables');
    });

    it('should list all missing variables in the error', async () => {
      await expect(
        manager.render('greeting', {}),
      ).rejects.toThrow(/place.*name|name.*place/);
    });

    it('should ignore extra variables not in template', async () => {
      const result = await manager.render('greeting', {
        name: '李四',
        place: '北京',
        extra: '多余变量',
      });
      expect(result).toBe('你好，李四！欢迎来到北京。');
    });
  });

  describe('listTemplates', () => {
    it('should list all .md template files', async () => {
      const templates = await manager.listTemplates();
      expect(templates).toContain('greeting');
      expect(templates).toContain('simple');
      expect(templates).toContain('multi-var');
    });

    it('should return template names without extension', async () => {
      const templates = await manager.listTemplates();
      for (const name of templates) {
        expect(name).not.toMatch(/\.md$/);
      }
    });

    it('should return sorted list', async () => {
      const templates = await manager.listTemplates();
      const sorted = [...templates].sort();
      expect(templates).toEqual(sorted);
    });
  });
});
