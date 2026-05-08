/**
 * State Machine Service
 *
 * Manages project lifecycle transitions with mode-entry deliverable checks.
 * Reuses canonical transition rules from `types/state-machine.ts`.
 */

import type { ProjectStatus } from '../types/project.js';
import {
  VALID_TRANSITIONS,
  isValidTransition,
  getModeForStatus,
} from '../types/state-machine.js';
import type { ProjectMode, ModeRequirements } from '../types/state-machine.js';
import type { DatabaseManager } from '../database/db.js';
import type { Project } from '../database/repositories/project-repository.js';

// ========== Rollback mapping ==========

/**
 * Maps each status to its linear-previous status.
 * `null` means the status cannot be rolled back (draft).
 */
const ROLLBACK_TARGETS: Record<ProjectStatus, ProjectStatus | null> = {
  draft: null,
  configuring: 'draft',
  analyzing: 'configuring',
  analyzed: 'analyzing',
  exploring: 'analyzed',
  explored: 'exploring',
  generating: 'explored',
  ready: 'generating',
  running: 'ready',
  completed: 'running',
};

// ========== Mode requirements data ==========

const MODE_REQUIREMENTS_DATA: ModeRequirements = {
  config: { requiredStatuses: ['draft'] },
  analysis: { requiredStatuses: ['configuring'], requires: ['target_base_url'] },
  exploration: { requiredStatuses: ['analyzed'], requires: ['business_modules'] },
  generation: { requiredStatuses: ['explored'], requires: ['url_bindings'] },
  execution: { requiredStatuses: ['ready'], requires: ['scripts'] },
};

// ========== Mode boundary transitions ==========

/**
 * Forward transitions that cross a mode boundary and need deliverable checks.
 * Key format: `"fromStatus→toStatus"`.
 */
const MODE_BOUNDARY_KEYS = new Set([
  'configuring→analyzing',
  'analyzed→exploring',
  'explored→generating',
  'ready→running',
]);

// ========== Service ==========

export class StateMachineService {
  constructor(private dbManager: DatabaseManager) {}

  /**
   * Check whether a project can transition to the given target status.
   * Validates both the transition rule and deliverable requirements.
   */
  canTransition(projectId: string, targetStatus: ProjectStatus): boolean {
    const project = this.requireProject(projectId);
    const currentStatus = project.status as ProjectStatus;
    if (!isValidTransition(currentStatus, targetStatus)) return false;
    return this.checkDeliverables(projectId, targetStatus).met;
  }

  /**
   * Execute a validated transition, persisting the new status.
   * Throws if the transition is invalid or deliverables are not met.
   */
  transition(projectId: string, targetStatus: ProjectStatus): Project {
    if (!this.canTransition(projectId, targetStatus)) {
      const project = this.requireProject(projectId);
      throw new Error(
        `Cannot transition project '${projectId}' from '${project.status}' to '${targetStatus}'`
      );
    }
    const updated = this.dbManager.getProjectRepo().updateStatus(projectId, targetStatus);
    if (!updated) throw new Error(`Project '${projectId}' not found after update`);
    return updated;
  }

  /**
   * List all statuses the project can currently transition to,
   * filtered by both transition rules and deliverable readiness.
   */
  getAvailableTransitions(projectId: string): ProjectStatus[] {
    const project = this.requireProject(projectId);
    const currentStatus = project.status as ProjectStatus;
    const candidates = VALID_TRANSITIONS[currentStatus] ?? [];
    return candidates.filter(target => this.checkDeliverables(projectId, target).met);
  }

  /**
   * Return the ProjectMode for the project's current status.
   */
  getCurrentMode(projectId: string): ProjectMode {
    const project = this.requireProject(projectId);
    return getModeForStatus(project.status as ProjectStatus);
  }

  /**
   * Return the entry requirements for a given mode.
   */
  getModeRequirements(mode: ProjectMode): ModeRequirements[ProjectMode] {
    return MODE_REQUIREMENTS_DATA[mode];
  }

  /**
   * Check whether deliverables are met for transitioning to `targetStatus`.
   * Non-boundary transitions (within-mode or rollback) always pass.
   */
  checkDeliverables(
    projectId: string,
    targetStatus: ProjectStatus
  ): { met: boolean; missing: string[] } {
    const project = this.requireProject(projectId);
    const currentStatus = project.status as ProjectStatus;
    const key = `${currentStatus}→${targetStatus}`;

    if (!MODE_BOUNDARY_KEYS.has(key)) {
      return { met: true, missing: [] };
    }

    const missing: string[] = [];

    switch (key) {
      case 'configuring→analyzing':
        if (!project.target_base_url) missing.push('target_base_url');
        break;

      case 'analyzed→exploring':
        if (this.dbManager.getBusinessModuleRepo().findByProjectId(projectId).length === 0) {
          missing.push('business_modules');
        }
        break;

      case 'explored→generating':
        if (this.dbManager.getURLModuleBindingRepo().findByProjectId(projectId).length === 0) {
          missing.push('url_bindings');
        }
        break;

      case 'ready→running':
        if (!this.projectHasScripts(projectId)) {
          missing.push('scripts');
        }
        break;
    }

    return { met: missing.length === 0, missing };
  }

  /**
   * Roll the project back to its previous status in the linear chain.
   * Throws if the project is at `draft` (no rollback target).
   */
  rollback(projectId: string): Project {
    const project = this.requireProject(projectId);
    const currentStatus = project.status as ProjectStatus;
    const target = ROLLBACK_TARGETS[currentStatus];
    if (!target) {
      throw new Error(`Cannot rollback from status '${currentStatus}'`);
    }
    const updated = this.dbManager.getProjectRepo().updateStatus(projectId, target);
    if (!updated) throw new Error(`Project '${projectId}' not found after rollback`);
    return updated;
  }

  // ========== Private helpers ==========

  private requireProject(projectId: string): Project {
    const project = this.dbManager.getProjectRepo().findById(projectId);
    if (!project) throw new Error(`Project '${projectId}' not found`);
    return project;
  }

  /**
   * Walk the project → BM → FM → scenario → script chain
   * to determine if any scripts exist for the project.
   */
  private projectHasScripts(projectId: string): boolean {
    const modules = this.dbManager.getBusinessModuleRepo().findByProjectId(projectId);
    for (const mod of modules) {
      const funcModules =
        this.dbManager.getFunctionalModuleRepo().findByBusinessModuleId(mod.id);
      for (const fm of funcModules) {
        const scenarios =
          this.dbManager.getTestScenarioRepo().findByFunctionalModuleId(fm.id);
        for (const ts of scenarios) {
          if (this.dbManager.getScriptRepo().findByScenarioId(ts.id).length > 0) {
            return true;
          }
        }
      }
    }
    return false;
  }
}
