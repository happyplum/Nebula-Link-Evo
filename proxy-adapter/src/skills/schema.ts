import type { Action } from '../types.js';

export type { Action };

export interface Skill {
  id: string;
  name: string;
  description?: string;
  version?: string;
  steps: Action[];
  category?: string;
  enabled?: boolean;
}

export interface SkillValidationError {
  field: string;
  message: string;
}