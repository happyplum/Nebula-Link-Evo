/**
 * Project Service
 *
 * Manages projects: CRUD, status transitions, and target app configuration.
 */

import type { DatabaseManager } from '../database/db.js';
import type { Project } from '../database/repositories/project-repository.js';
import { isValidTransition } from '../types/state-machine.js';
import type { ProjectStatus } from '../types/project.js';

export interface ConfigureTargetOptions {
  baseUrl: string;
  authType: string;
  seedUrls: string[];
  /** Auth config — passwords are stripped before storage */
  authConfig?: Record<string, string>;
}

export class ProjectService {
  private db: DatabaseManager;

  constructor(dbManager: DatabaseManager) {
    this.db = dbManager;
  }

  private repo() {
    return this.db.getProjectRepo();
  }

  /** Create a new project with status 'draft'. */
  createProject(name: string, targetBaseUrl?: string): Project {
    return this.repo().create({
      name,
      target_base_url: targetBaseUrl,
      status: 'draft',
    });
  }

  /** Get project by ID, returns null if not found. */
  getProject(id: string): Project | null {
    return this.repo().findById(id);
  }

  /** List all projects. */
  listProjects(): Project[] {
    return this.repo().findAll();
  }

  /** Partially update a project. Returns null if project not found. */
  updateProject(id: string, updates: Partial<Pick<Project, 'name' | 'target_base_url' | 'auth_config_json' | 'status'>>): Project | null {
    return this.repo().update(id, updates);
  }

  /** Delete a project by ID. Returns true if deleted, false if not found. */
  deleteProject(id: string): boolean {
    return this.repo().delete(id);
  }

  /**
   * Transition project status using the state machine rules.
   * Throws if the transition is invalid or project not found.
   */
  updateProjectStatus(id: string, newStatus: ProjectStatus): Project {
    const current = this.repo().findById(id);
    if (!current) {
      throw new Error(`Project not found: ${id}`);
    }

    if (!isValidTransition(current.status as ProjectStatus, newStatus)) {
      throw new Error(
        `Invalid transition: ${current.status} → ${newStatus}`,
      );
    }

    return this.repo().updateStatus(id, newStatus)!;
  }

  /**
   * Configure the target app for a project.
   * Sets status to 'configuring' and stores auth config without plaintext passwords.
   */
  configureTarget(id: string, options: ConfigureTargetOptions): Project {
    const current = this.repo().findById(id);
    if (!current) {
      throw new Error(`Project not found: ${id}`);
    }

    // Build auth_config_json, stripping any password field
    let authConfigJson: string | null = null;
    if (options.authConfig) {
      const { password: _pw, ...safe } = options.authConfig;
      authConfigJson = JSON.stringify(safe);
    } else if (options.authType && options.authType !== 'none') {
      authConfigJson = JSON.stringify({ authType: options.authType });
    }

    const updated = this.repo().update(id, {
      target_base_url: options.baseUrl,
      auth_config_json: authConfigJson,
      status: 'configuring',
    });

    return updated!;
  }
}
