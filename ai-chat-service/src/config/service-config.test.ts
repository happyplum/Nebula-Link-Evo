import { delimiter } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './service-config.js';

const originalSkillDirectories = process.env.AI_SKILLS_DIRS;

afterEach(() => {
  if (originalSkillDirectories === undefined) delete process.env.AI_SKILLS_DIRS;
  else process.env.AI_SKILLS_DIRS = originalSkillDirectories;
});

describe('ai-chat-service process config', () => {
  it('reads platform-delimited local Skill roots without inventing a default directory', () => {
    delete process.env.AI_SKILLS_DIRS;
    expect(loadConfig().skillDirectories).toEqual([]);

    process.env.AI_SKILLS_DIRS = [`skills-a`, `skills-b`].join(delimiter);
    expect(loadConfig().skillDirectories).toEqual(['skills-a', 'skills-b']);
  });
});
