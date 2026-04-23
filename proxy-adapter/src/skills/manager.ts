import * as fs from 'fs';
import * as path from 'path';
import type { Skill } from './schema.js';

/**
 * Raw, unvalidated skill structure from JSON/YAML parsing.
 * Used before validation and type narrowing to Skill.
 */
interface UnvalidatedSkill {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  steps?: unknown;
  category?: string;
  enabled?: boolean;
}

/**
 * Raw, unvalidated step structure within a skill.
 */
interface UnvalidatedStep {
  action?: string;
  type?: string;
  params?: unknown;
  description?: string;
}

export class SkillManager {
  private skillsDir: string;
  private skills: Map<string, Skill> = new Map();
  private readonly requiredFields = ['id', 'name', 'steps'] as const;

  constructor(skillsDir: string = 'skills') {
    this.skillsDir = skillsDir;
  }

  async loadSkills(): Promise<void> {
    if (!fs.existsSync(this.skillsDir)) {
      return;
    }

    const files = fs.readdirSync(this.skillsDir);
    const skillFiles = files.filter((f) => f.endsWith('.json') || f.endsWith('.yaml'));

    for (const file of skillFiles) {
      const filePath = path.join(this.skillsDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const skill = await this.parseSkillFile(content, filePath);
      this.skills.set(skill.id, skill);
    }
  }

  private async parseSkillFile(content: string, filePath: string): Promise<Skill> {
    let skill: unknown;

    if (filePath.endsWith('.json')) {
      try {
        skill = JSON.parse(content);
      } catch (error) {
        throw new Error(`Invalid skill JSON at ${filePath}: ${error}`);
      }
    } else if (filePath.endsWith('.yaml')) {
      try {
        const yaml = (await import('js-yaml')).default;
        skill = yaml.load(content);
      } catch (error) {
        throw new Error(`Invalid skill YAML at ${filePath}: ${error}`);
      }
    }

    if (!this.validateSkill(skill)) {
      throw new Error('Invalid skill structure');
    }

    return skill as Skill;
  }

  validateSkill(skill: unknown): boolean {
    // Type guard: ensure skill is an object
    if (typeof skill !== 'object' || skill === null) {
      throw new Error('Skill must be an object');
    }

    const unvalidated = skill as UnvalidatedSkill;

    // Check required fields
    for (const field of this.requiredFields) {
      if (!(field in unvalidated) || unvalidated[field as keyof UnvalidatedSkill] === undefined) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate steps is an array
    if (!Array.isArray(unvalidated.steps)) {
      throw new Error('steps must be an array');
    }

    // Validate each step
    for (const step of unvalidated.steps) {
      if (typeof step !== 'object' || step === null) {
        throw new Error('Each step must be an object');
      }

      const unvalidatedStep = step as UnvalidatedStep;
      const stepType = unvalidatedStep.action || unvalidatedStep.type;

      if (!stepType || !unvalidatedStep.params) {
        throw new Error('Each step must have action or type, and params');
      }
    }

    return true;
  }

  static getSkill(id: string): Skill | undefined {
    const instance = new SkillManager();
    return instance.skills.get(id);
  }

  getSkill(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  listSkills(): Record<string, Skill> {
    const result: Record<string, Skill> = {};
    this.skills.forEach((skill, id) => {
      result[id] = skill;
    });
    return result;
  }

  async clear(): Promise<void> {
    this.skills.clear();
  }

  async saveSkill(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  async deleteSkill(filePath: string): Promise<void> {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}
