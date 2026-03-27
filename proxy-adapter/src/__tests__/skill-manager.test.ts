import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { SkillManager } from '../skills/manager.js';

describe('SkillManager', () => {
  let manager: SkillManager;
  const skillsDir = 'skills';

  beforeAll(() => {
    manager = new SkillManager(skillsDir);
  });

  afterEach(async () => {
    await manager.clear();
    const files = fs.readdirSync(skillsDir);
    for (const file of files) {
      const filePath = path.join(skillsDir, file);
      fs.unlinkSync(filePath);
    }
  });

  describe('loadSkills()', () => {
    it('should load valid JSON skill files', async () => {
      const testFile = `${skillsDir}/basic-navigation.json`;
      const skill = {
        id: 'basic-navigation',
        name: 'Basic Navigation',
        description: 'Navigate around a webpage',
        version: '1.0',
        category: 'navigation',
        enabled: true,
        steps: [
          { type: 'click', params: { x: 100, y: 100 }, reasoning: 'Click on button' },
          { type: 'wait', params: { duration: 1000 } },
        ],
      };
      await manager.saveSkill(testFile, JSON.stringify(skill, null, 2));
      await manager.clear();

      await manager.loadSkills();

      const skills = manager.listSkills();
      expect(skills).toHaveProperty('basic-navigation');
      expect(skills['basic-navigation'].id).toBe('basic-navigation');
      expect(skills['basic-navigation'].name).toBe('Basic Navigation');
    });

    it('should load valid YAML skill files', async () => {
      const testFile = `${skillsDir}/form-completion.yaml`;
      const skill = {
        id: 'form-completion',
        name: 'Form Completion',
        description: 'Fill out forms with validation',
        version: '1.0',
        category: 'form',
        enabled: true,
        steps: [
          { type: 'type', params: { selector: '#input-name', text: 'John Doe' } },
          { type: 'type', params: { selector: '#input-email', text: 'john@example.com' } },
          { type: 'click', params: { selector: '#submit' } },
        ],
      };
      await manager.saveSkill(testFile, JSON.stringify(skill, null, 2));
      await manager.clear();

      await manager.loadSkills();

      const skills = manager.listSkills();
      expect(skills).toHaveProperty('form-completion');
      expect(skills['form-completion'].id).toBe('form-completion');
      expect(skills['form-completion'].description).toContain('Fill');
    });

    it('should reject invalid JSON skill files', async () => {
      const testFile = `${skillsDir}/invalid.json`;
      const invalidJson = '{ not valid json }';
      await manager.saveSkill(testFile, invalidJson);

      await expect(manager.loadSkills()).rejects.toThrow('Invalid skill JSON');
    });

    it('should reject invalid YAML skill files', async () => {
      const testFile = `${skillsDir}/invalid.yaml`;
      const invalidYaml = 'not: valid: yaml: {';
      await manager.saveSkill(testFile, invalidYaml);

      await expect(manager.loadSkills()).rejects.toThrow('Invalid skill YAML');
    });

    it('should reject skills missing required fields', async () => {
      const testFile = `${skillsDir}/missing-fields.json`;
      const invalidSkill = { id: 'test', name: 'Test' };
      await manager.saveSkill(testFile, JSON.stringify(invalidSkill, null, 2));

      await expect(manager.loadSkills()).rejects.toThrow('Missing required field: steps');
    });

    it('should load multiple skills into memory map', async () => {
      const testFile1 = `${skillsDir}/test-skill-1.json`;
      const testFile2 = `${skillsDir}/test-skill-2.yaml`;
      const skill1 = {
        id: 'test-skill-1',
        name: 'Test Skill 1',
        description: 'First test skill',
        steps: [{ type: 'click', params: { x: 10, y: 20 } }],
      };
      const skill2 = {
        id: 'test-skill-2',
        name: 'Test Skill 2',
        description: 'Second test skill',
        steps: [{ type: 'wait', params: { duration: 1000 } }],
      };
      await manager.saveSkill(testFile1, JSON.stringify(skill1, null, 2));
      await manager.saveSkill(testFile2, JSON.stringify(skill2, null, 2));
      await manager.clear();

      await manager.loadSkills();

      const skills = manager.listSkills();
      const skillIds = Object.keys(skills);

      expect(skillIds.length).toBeGreaterThan(0);
      skillIds.forEach((id) => {
        expect(skills[id]).toHaveProperty('id', id);
        expect(skills[id]).toHaveProperty('name');
        expect(skills[id]).toHaveProperty('steps');
        expect(Array.isArray(skills[id].steps)).toBe(true);
      });
    });
  });

  describe('getSkill(id)', () => {
    it('should return skill by ID', async () => {
      const testFile = `${skillsDir}/get-skill-test.json`;
      const skill = {
        id: 'get-skill-test',
        name: 'Get Skill Test',
        description: 'Test getting skill by ID',
        steps: [{ type: 'click', params: { x: 10, y: 20 } }],
      };
      await manager.saveSkill(testFile, JSON.stringify(skill, null, 2));
      await manager.clear();

      await manager.loadSkills();

      const result = manager.getSkill('get-skill-test');
      expect(result).toBeDefined();
      expect(result?.id).toBe('get-skill-test');
      expect(result?.name).toBe('Get Skill Test');
    });

    it('should return undefined for non-existent skill', async () => {
      const skill = manager.getSkill('non-existent');
      expect(skill).toBeUndefined();
    });

    it('should return skill with correct steps', async () => {
      const testFile = `${skillsDir}/steps-test.json`;
      const skill = {
        id: 'steps-test',
        name: 'Steps Test',
        description: 'Test skill steps',
        steps: [
          { type: 'click', params: { x: 100, y: 100 } },
          { type: 'type', params: { selector: '#input', text: 'test' } },
        ],
      };
      await manager.saveSkill(testFile, JSON.stringify(skill, null, 2));
      await manager.clear();

      await manager.loadSkills();

      const result = manager.getSkill('steps-test');
      expect(result?.steps).toHaveLength(2);
      expect(result?.steps[0].type).toBe('click');
    });
  });

  describe('validateSkill()', () => {
    it('should validate valid skill structure', () => {
      const validSkill = {
        id: 'test-skill',
        name: 'Test Skill',
        description: 'A test skill',
        steps: [{ type: 'click', params: { x: 100, y: 100 } }],
      };

      expect(() => manager.validateSkill(validSkill)).not.toThrow();
    });

    it('should throw for invalid skill missing id', () => {
      const invalidSkill = {
        name: 'Test Skill',
        steps: [],
      };

      expect(() => manager.validateSkill(invalidSkill)).toThrow('Missing required field: id');
    });

    it('should throw for invalid skill missing name', () => {
      const invalidSkill = {
        id: 'test-skill',
        steps: [],
      };

      expect(() => manager.validateSkill(invalidSkill)).toThrow('Missing required field: name');
    });

    it('should throw for invalid skill missing steps', () => {
      const invalidSkill = {
        id: 'test-skill',
        name: 'Test Skill',
      };

      expect(() => manager.validateSkill(invalidSkill)).toThrow('Missing required field: steps');
    });

    it('should throw for invalid steps array', () => {
      const invalidSkill = {
        id: 'test-skill',
        name: 'Test Skill',
        steps: 'not an array' as any,
      };

      expect(() => manager.validateSkill(invalidSkill)).toThrow('steps must be an array');
    });
  });

  describe('listSkills()', () => {
    it('should return empty object when no skills loaded', async () => {
      await manager.clear();
      await manager.loadSkills();
      const skills = manager.listSkills();

      expect(skills).toEqual({});
    });

    it('should return skills map after loading', async () => {
      const testFile = `${skillsDir}/list-test.json`;
      const skill = {
        id: 'list-test',
        name: 'List Test',
        description: 'Test listing skills',
        steps: [{ type: 'click', params: { x: 10, y: 20 } }],
      };
      await manager.saveSkill(testFile, JSON.stringify(skill, null, 2));
      await manager.clear();

      await manager.loadSkills();
      const skills = manager.listSkills();

      expect(typeof skills).toBe('object');
      expect(skills).not.toBeNull();
    });
  });
});
