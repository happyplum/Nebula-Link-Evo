/**
 * Login Recorder Service
 *
 * Records login steps, stores them as LoginScript, and provides
 * replay and verification via PlaywrightClient.
 */

import type { DatabaseManager } from '../database/db.js';
import type { LoginScript } from '../database/repositories/login-script-repository.js';
import type { PlaywrightClient } from './playwright-client.js';
import type { LoginStep } from '../types/login-script.js';

export interface ReplayResult {
  success: boolean;
  error?: string;
}

export interface VerificationConfig {
  method: 'cookie' | 'localStorage' | 'element';
  /** For cookie method: expected cookie name */
  cookieName?: string;
  /** For localStorage method: expected key */
  key?: string;
  /** For element method: selector to check visibility */
  selector?: string;
}

export interface VerificationResult {
  success: boolean;
  error?: string;
  details?: string;
}

export class LoginRecorderService {
  private db: DatabaseManager;
  private client: PlaywrightClient;

  constructor(dbManager: DatabaseManager, playwrightClient: PlaywrightClient) {
    this.db = dbManager;
    this.client = playwrightClient;
  }

  private projectRepo() {
    return this.db.getProjectRepo();
  }

  private scriptRepo() {
    return this.db.getLoginScriptRepo();
  }

  /**
   * Create a new login script with empty steps for a project.
   * Returns null if project not found.
   */
  startRecording(projectId: string): LoginScript | null {
    const project = this.projectRepo().findById(projectId);
    if (!project) return null;

    return this.scriptRepo().create({
      project_id: projectId,
      name: `Login script for project ${projectId}`,
      steps_json: '[]',
    });
  }

  /**
   * Append a step to the latest login script for a project.
   * Returns the updated script, or null if no script/project found.
   */
  recordStep(projectId: string, step: LoginStep): LoginScript | null {
    const script = this.getLoginScript(projectId);
    if (!script) return null;

    const steps: LoginStep[] = JSON.parse(script.steps_json);
    steps.push(step);

    return this.scriptRepo().update(script.id, {
      steps_json: JSON.stringify(steps),
    });
  }

  /**
   * Get the latest login script for a project.
   * Returns null if no scripts exist.
   */
  getLoginScript(projectId: string): LoginScript | null {
    const scripts = this.scriptRepo().findByProjectId(projectId);
    if (scripts.length === 0) return null;
    // Return the latest (last in ASC ordered list)
    return scripts[scripts.length - 1];
  }

  /**
   * Replay a login script by executing each step via PlaywrightClient.
   * Supports: navigate, fill, click, wait, screenshot.
   */
  async replayLogin(projectId: string): Promise<ReplayResult> {
    const script = this.getLoginScript(projectId);
    if (!script) {
      return { success: false, error: `Login script not found for project: ${projectId}` };
    }

    const steps: LoginStep[] = JSON.parse(script.steps_json);

    try {
      for (const step of steps) {
        switch (step.type) {
          case 'navigate':
            if (!step.url) throw new Error(`Navigate step missing URL: ${step.description}`);
            await this.client.navigate(step.url);
            break;
          case 'fill':
            if (!step.selector || !step.value) {
              throw new Error(`Fill step missing selector/value: ${step.description}`);
            }
            await this.client.type(step.selector, step.value);
            break;
          case 'click':
            if (!step.selector) throw new Error(`Click step missing selector: ${step.description}`);
            await this.client.click(step.selector);
            break;
          case 'wait':
            await new Promise<void>((resolve) => {
              setTimeout(resolve, step.duration ?? 1000);
            });
            break;
          case 'screenshot':
            await this.client.screenshot();
            break;
          default:
            throw new Error(`Unknown step type: ${(step as LoginStep).type}`);
        }
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown replay error',
      };
    }
  }

  /**
   * Verify login success by checking cookies, localStorage, or element presence.
   * Must be called after replayLogin.
   */
  async verifyLogin(
    projectId: string,
    config: VerificationConfig,
  ): Promise<VerificationResult> {
    const script = this.getLoginScript(projectId);
    if (!script) {
      return { success: false, error: `Login script not found for project: ${projectId}` };
    }

    try {
      switch (config.method) {
        case 'cookie': {
          const { cookies } = await this.client.get_cookies();
          const found = cookies.some((c) => c.name === config.cookieName);
          return found
            ? { success: true, details: `Cookie "${config.cookieName}" found` }
            : { success: false, details: `Cookie "${config.cookieName}" not found` };
        }
        case 'localStorage': {
          const { data } = await this.client.get_localStorage();
          const found = config.key! in data;
          return found
            ? { success: true, details: `localStorage key "${config.key}" found` }
            : { success: false, details: `localStorage key "${config.key}" not found` };
        }
        case 'element': {
          const result = await this.client.executeScript(
            `!!document.querySelector('${config.selector}')`,
          );
          const visible = !!result.result;
          return visible
            ? { success: true, details: `Element "${config.selector}" found` }
            : { success: false, details: `Element "${config.selector}" not found` };
        }
        default:
          return { success: false, error: `Unknown verification method` };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Verification error',
      };
    }
  }
}
