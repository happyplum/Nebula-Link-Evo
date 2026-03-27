import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SkillManager } from '../../skills/manager.js';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('path', () => ({
  join: vi.fn((...args: string[]) => args.join('/')),
  dirname: vi.fn((p: string) => p.split('/').slice(0, -1).join('/')),
}));

vi.mock('js-yaml', () => ({
  default: {
    load: vi.fn(),
  },
}));

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

describe('SkillManager', () => {
  let manager: SkillManager;

  beforeEach(() => {
    manager = new SkillManager('mock-skills');
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should use default skills directory when not provided', () => {
      const defaultManager = new SkillManager();
      expect(defaultManager).toBeDefined();
    });

    it('should use custom skills directory when provided', () => {
      const customManager = new SkillManager('custom-skills');
      expect(customManager).toBeDefined();
    });
  });

  describe('loadSkills()', () => {
    it('should return early if skills directory does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await manager.loadSkills();

      expect(fs.readdirSync).not.toHaveBeenCalled();
    });

    it('should load JSON skill files from directory', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['skill1.json', 'skill2.json'] as any);
      vi.mocked(path.join).mockImplementation((...args) => args.join('/'));
      vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
        if (typeof filePath === 'string' && filePath.includes('skill1.json')) {
          return JSON.stringify({
            id: 'skill1',
            name: 'Skill 1',
            description: 'First skill',
            steps: [{ type: 'click' as const, params: { x: 100, y: 100 } }],
          });
        } else if (typeof filePath === 'string' && filePath.includes('skill2.json')) {
          return JSON.stringify({
            id: 'skill2',
            name: 'Skill 2',
            description: 'Second skill',
            steps: [{ type: 'wait' as const, params: { duration: 1000 } }],
          });
        }
        return '{}';
      });

      await manager.loadSkills();

      const skills = manager.listSkills();
      expect(skills).toHaveProperty('skill1');
      expect(skills).toHaveProperty('skill2');
    });

    it('should load YAML skill files from directory', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['yaml-skill.yaml'] as any);
      vi.mocked(path.join).mockImplementation((...args) => args.join('/'));
      vi.mocked(fs.readFileSync).mockReturnValue('id: yaml-skill\nname: YAML Skill\nsteps:\n  - type: click\n    params:\n      x: 100\n      y: 100');
      vi.mocked(yaml.default.load).mockReturnValue({
        id: 'yaml-skill',
        name: 'YAML Skill',
        steps: [{ type: 'click' as const, params: { x: 100, y: 100 } }],
      });

      await manager.loadSkills();

      const skills = manager.listSkills();
      expect(skills).toHaveProperty('yaml-skill');
    });

    it('should filter out non-skill files', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['skill.json', 'readme.txt', 'config.env'] as any);
      vi.mocked(path.join).mockImplementation((...args) => args.join('/'));
      vi.mocked(fs.readFileSync).mockReturnValue('{"id":"skill","name":"Skill","steps":[]}');

      await manager.loadSkills();

      expect(fs.readFileSync).toHaveBeenCalledTimes(1);
    });

    it('should throw error for invalid JSON', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['invalid.json'] as any);
      vi.mocked(path.join).mockImplementation((...args) => args.join('/'));
      vi.mocked(fs.readFileSync).mockReturnValue('{ invalid json }');

      await expect(manager.loadSkills()).rejects.toThrow('Invalid skill JSON');
    });

    it('should throw error for invalid YAML', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['invalid.yaml'] as any);
      vi.mocked(path.join).mockImplementation((...args) => args.join('/'));
      vi.mocked(fs.readFileSync).mockReturnValue('not: valid: yaml');
      vi.mocked(yaml.default.load).mockImplementation(() => {
        throw new Error('Invalid YAML');
      });

      await expect(manager.loadSkills()).rejects.toThrow('Invalid skill YAML');
    });
  });

  describe('parseSkillFile()', () => {
    it('should parse JSON skill files correctly', async () => {
      const jsonContent = JSON.stringify({
        id: 'json-skill',
        name: 'JSON Skill',
        description: 'A JSON skill',
        steps: [{ type: 'click', params: { x: 100, y: 100 } }],
      });

      const skill = await manager['parseSkillFile'](jsonContent, 'skill.json');

      expect(skill.id).toBe('json-skill');
      expect(skill.name).toBe('JSON Skill');
      expect(skill.steps).toHaveLength(1);
    });

    it('should parse YAML skill files correctly', async () => {
      const yamlContent = 'id: yaml-skill\nname: YAML Skill\nsteps:\n  - type: click\n    params:\n      x: 100\n      y: 100';
      vi.mocked(yaml.default.load).mockReturnValue({
        id: 'yaml-skill',
        name: 'YAML Skill',
        steps: [{ type: 'click', params: { x: 100, y: 100 } }],
      });

      const skill = await manager['parseSkillFile'](yamlContent, 'skill.yaml');

      expect(skill.id).toBe('yaml-skill');
      expect(skill.name).toBe('YAML Skill');
      expect(skill.steps).toHaveLength(1);
    });

    it('should throw error for missing id field', async () => {
      const content = JSON.stringify({
        name: 'Test',
        steps: [],
      });

      await expect(manager['parseSkillFile'](content, 'skill.json')).rejects.toThrow('Missing required field: id');
    });

    it('should throw error for missing name field', async () => {
      const content = JSON.stringify({
        id: 'test',
        steps: [],
      });

      await expect(manager['parseSkillFile'](content, 'skill.json')).rejects.toThrow('Missing required field: name');
    });

    it('should throw error for missing steps field', async () => {
      const content = JSON.stringify({
        id: 'test',
        name: 'Test',
      });

      await expect(manager['parseSkillFile'](content, 'skill.json')).rejects.toThrow('Missing required field: steps');
    });
  });

  describe('validateSkill()', () => {
    it('should validate skill with all required fields', () => {
      const validSkill = {
        id: 'valid-skill',
        name: 'Valid Skill',
        description: 'A valid skill',
        steps: [{ type: 'click', params: { x: 100, y: 100 } }],
      };

      const result = manager.validateSkill(validSkill);

      expect(result).toBe(true);
    });

    it('should throw error when id is missing', () => {
      const invalidSkill = {
        name: 'Test',
        steps: [],
      };

      expect(() => manager.validateSkill(invalidSkill)).toThrow('Missing required field: id');
    });

    it('should throw error when name is missing', () => {
      const invalidSkill = {
        id: 'test',
        steps: [],
      };

      expect(() => manager.validateSkill(invalidSkill)).toThrow('Missing required field: name');
    });

    it('should throw error when steps is missing', () => {
      const invalidSkill = {
        id: 'test',
        name: 'Test',
      };

      expect(() => manager.validateSkill(invalidSkill)).toThrow('Missing required field: steps');
    });

    it('should throw error when steps is not an array', () => {
      const invalidSkill = {
        id: 'test',
        name: 'Test',
        steps: 'not an array' as any,
      };

      expect(() => manager.validateSkill(invalidSkill)).toThrow('steps must be an array');
    });

    it('should throw error when step missing action/type', () => {
      const invalidSkill = {
        id: 'test',
        name: 'Test',
        steps: [{ params: { x: 100 } }],
      };

      expect(() => manager.validateSkill(invalidSkill)).toThrow('Each step must have action or type, and params');
    });

    it('should throw error when step missing params', () => {
      const invalidSkill = {
        id: 'test',
        name: 'Test',
        steps: [{ type: 'click' }],
      };

      expect(() => manager.validateSkill(invalidSkill)).toThrow('Each step must have action or type, and params');
    });

    it('should accept step with action field', () => {
      const validSkill = {
        id: 'test',
        name: 'Test',
        steps: [{ action: 'click', params: { x: 100, y: 100 } }],
      };

      expect(() => manager.validateSkill(validSkill)).not.toThrow();
    });

    it('should accept step with type field', () => {
      const validSkill = {
        id: 'test',
        name: 'Test',
        steps: [{ type: 'click', params: { x: 100, y: 100 } }],
      };

      expect(() => manager.validateSkill(validSkill)).not.toThrow();
    });

    it('should validate multiple steps', () => {
      const validSkill = {
        id: 'test',
        name: 'Test',
        steps: [
          { type: 'click', params: { x: 100, y: 100 } },
          { action: 'type', params: { selector: '#input', text: 'test' } },
          { type: 'wait', params: { duration: 1000 } },
        ],
      };

      expect(() => manager.validateSkill(validSkill)).not.toThrow();
    });
  });

  describe('getSkill() - instance method', () => {
    it('should return skill by ID when it exists', () => {
      manager['skills'].set('test-skill', {
        id: 'test-skill',
        name: 'Test Skill',
        steps: [{ type: 'click', params: { x: 100, y: 100 } }],
      });

      const skill = manager.getSkill('test-skill');

      expect(skill).toBeDefined();
      expect(skill?.id).toBe('test-skill');
      expect(skill?.name).toBe('Test Skill');
    });

    it('should return undefined when skill does not exist', () => {
      const skill = manager.getSkill('non-existent');

      expect(skill).toBeUndefined();
    });
  });

  describe('getSkill() - static method', () => {
    it('should return undefined since static method creates new instance', () => {
      const skill = SkillManager['getSkill']('any-skill');

      expect(skill).toBeUndefined();
    });

    it('should return undefined from static method when skill does not exist', () => {
      const skill = SkillManager['getSkill']('non-existent');

      expect(skill).toBeUndefined();
    });
  });

  describe('listSkills()', () => {
    it('should return empty object when no skills loaded', () => {
      const skills = manager.listSkills();

      expect(skills).toEqual({});
      expect(Object.keys(skills).length).toBe(0);
    });

    it('should return all loaded skills as object', () => {
      manager['skills'].set('skill1', {
        id: 'skill1',
        name: 'Skill 1',
        steps: [{ type: 'click', params: { x: 100, y: 100 } }],
      });
      manager['skills'].set('skill2', {
        id: 'skill2',
        name: 'Skill 2',
        steps: [{ type: 'wait', params: { duration: 1000 } }],
      });

      const skills = manager.listSkills();

      expect(Object.keys(skills).length).toBe(2);
      expect(skills).toHaveProperty('skill1');
      expect(skills).toHaveProperty('skill2');
      expect(skills.skill1.name).toBe('Skill 1');
      expect(skills.skill2.name).toBe('Skill 2');
    });

    it('should return copy of skills map', () => {
      manager['skills'].set('skill1', {
        id: 'skill1',
        name: 'Skill 1',
        steps: [{ type: 'click', params: { x: 100, y: 100 } }],
      });

      const skills1 = manager.listSkills();
      manager['skills'].set('skill2', {
        id: 'skill2',
        name: 'Skill 2',
        steps: [{ type: 'wait', params: { duration: 1000 } }],
      });
      const skills2 = manager.listSkills();

      expect(skills1).not.toBe(skills2);
      expect(Object.keys(skills1).length).toBe(1);
      expect(Object.keys(skills2).length).toBe(2);
    });
  });

  describe('clear()', () => {
    it('should clear all skills from memory', async () => {
      manager['skills'].set('skill1', {
        id: 'skill1',
        name: 'Skill 1',
        steps: [{ type: 'click', params: { x: 100, y: 100 } }],
      });
      manager['skills'].set('skill2', {
        id: 'skill2',
        name: 'Skill 2',
        steps: [{ type: 'wait', params: { duration: 1000 } }],
      });

      expect(manager['skills'].size).toBe(2);

      await manager.clear();

      expect(manager['skills'].size).toBe(0);
    });
  });

  describe('saveSkill()', () => {
    it('should save skill content to file', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(path.join).mockImplementation((...args) => args.join('/'));

      await manager.saveSkill('/mock/path/skill.json', '{"id":"test","name":"Test","steps":[]}');

      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/mock/path/skill.json',
        '{"id":"test","name":"Test","steps":[]}',
        'utf-8'
      );
    });

    it('should create directory if not exists', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(path.join).mockImplementation((...args) => args.join('/'));

      await manager.saveSkill('/mock/path/skill.json', '{}');

      expect(fs.mkdirSync).toHaveBeenCalledWith('/mock/path', { recursive: true });
    });

    it('should not create directory if already exists', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(path.join).mockImplementation((...args) => args.join('/'));

      await manager.saveSkill('/mock/path/skill.json', '{}');

      expect(fs.mkdirSync).not.toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('deleteSkill()', () => {
    it('should delete file when it exists', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      await manager.deleteSkill('/mock/path/skill.json');

      expect(fs.unlinkSync).toHaveBeenCalledWith('/mock/path/skill.json');
    });

    it('should not throw error when file does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(manager.deleteSkill('/mock/path/skill.json')).resolves.not.toThrow();
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });
  });
});
