import * as fs from 'fs';
import * as path from 'path';
import type { Skill } from './schema.js';

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
    let skill: any;

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

  validateSkill(skill: any): boolean {
    for (const field of this.requiredFields) {
      if (!skill[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    if (!Array.isArray(skill.steps)) {
      throw new Error('steps must be an array');
    }

    for (const step of skill.steps) {
      const stepType = step.action || step.type;
      if (!stepType || !step.params) {
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
