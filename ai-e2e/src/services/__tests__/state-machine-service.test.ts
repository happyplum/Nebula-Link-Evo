import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../database/db.js';
import { StateMachineService } from '../state-machine-service.js';
import { ServiceError } from '../service-error.js';
import type { ProjectStatus } from '../../types/project.js';

describe('StateMachineService', () => {
  let dbManager: DatabaseManager;
  let service: StateMachineService;
  let projectId: string;

  beforeEach(() => {
    DatabaseManager.resetInstance();
    dbManager = DatabaseManager.getInstance();
    dbManager.init();
    service = new StateMachineService(dbManager);
    const project = dbManager.getProjectRepo().create({ name: 'Test Project' });
    projectId = project.id;
  });

  afterEach(() => {
    DatabaseManager.resetInstance();
  });

  /**
   * Advance project to a target status by walking the forward chain.
   * Creates all required deliverables along the way so the state is consistent.
   */
  function advanceTo(targetStatus: ProjectStatus): void {
    const steps: ProjectStatus[] = [
      'draft', 'configuring', 'analyzing', 'analyzed', 'exploring',
      'explored', 'generating', 'ready', 'running', 'completed',
    ];
    const targetIdx = steps.indexOf(targetStatus);

    // Pre-populate deliverables required at each mode boundary
    if (targetIdx >= steps.indexOf('analyzing')) {
      dbManager.getProjectRepo().update(projectId, { target_base_url: 'https://example.com' });
    }
    if (targetIdx >= steps.indexOf('exploring')) {
      if (dbManager.getBusinessModuleRepo().findByProjectId(projectId).length === 0) {
        dbManager.getBusinessModuleRepo().create({ project_id: projectId, name: 'L1 Module' });
      }
    }
    if (targetIdx >= steps.indexOf('explored')) {
      if (dbManager.getURLModuleBindingRepo().findByProjectId(projectId).length === 0) {
        const url = dbManager.getURLRepo().create({ project_id: projectId, url: 'https://example.com/page' });
        const bm = dbManager.getBusinessModuleRepo().findByProjectId(projectId)[0];
        const fm = dbManager.getFunctionalModuleRepo().findByBusinessModuleId(bm.id)[0]
          ?? dbManager.getFunctionalModuleRepo().create({ business_module_id: bm.id, name: 'L2 Module' });
        dbManager.getURLModuleBindingRepo().create({ url_id: url.id, functional_module_id: fm.id });
      }
    }
    if (targetIdx >= steps.indexOf('ready')) {
      const bm = dbManager.getBusinessModuleRepo().findByProjectId(projectId)[0];
      const fm = dbManager.getFunctionalModuleRepo().findByBusinessModuleId(bm.id)[0];
      if (dbManager.getTestScenarioRepo().findByFunctionalModuleId(fm.id).length === 0) {
        const ts = dbManager.getTestScenarioRepo().create({ functional_module_id: fm.id, name: 'Scenario' });
        dbManager.getScriptRepo().create({ test_scenario_id: ts.id, content: 'script content' });
      }
    }

    for (let i = 0; i < targetIdx; i++) {
      dbManager.getProjectRepo().updateStatus(projectId, steps[i + 1]);
    }
  }

  // ===================== canTransition =====================

  describe('canTransition', () => {
    it('allows valid forward transition without deliverable checks', () => {
      expect(service.canTransition(projectId, 'configuring')).toBe(true);
    });

    it('rejects skipping statuses', () => {
      expect(service.canTransition(projectId, 'analyzing')).toBe(false);
      expect(service.canTransition(projectId, 'completed')).toBe(false);
    });

    it('rejects mode boundary when base_url is missing', () => {
      dbManager.getProjectRepo().updateStatus(projectId, 'configuring');
      expect(service.canTransition(projectId, 'analyzing')).toBe(false);
    });

    it('allows mode boundary when base_url is set', () => {
      dbManager.getProjectRepo().update(projectId, { target_base_url: 'https://example.com' });
      dbManager.getProjectRepo().updateStatus(projectId, 'configuring');
      expect(service.canTransition(projectId, 'analyzing')).toBe(true);
    });

    it('rejects exploration without business modules', () => {
      dbManager.getProjectRepo().update(projectId, { target_base_url: 'https://example.com' });
      dbManager.getProjectRepo().updateStatus(projectId, 'configuring');
      dbManager.getProjectRepo().updateStatus(projectId, 'analyzing');
      dbManager.getProjectRepo().updateStatus(projectId, 'analyzed');
      expect(service.canTransition(projectId, 'exploring')).toBe(false);
    });

    it('allows exploration with business modules', () => {
      advanceTo('analyzed');
      dbManager.getBusinessModuleRepo().create({ project_id: projectId, name: 'Module' });
      expect(service.canTransition(projectId, 'exploring')).toBe(true);
    });

    it('allows backward (rollback) transition without deliverable checks', () => {
      dbManager.getProjectRepo().updateStatus(projectId, 'configuring');
      expect(service.canTransition(projectId, 'draft')).toBe(true);
    });

    it('allows within-mode forward transition without deliverable checks', () => {
      dbManager.getProjectRepo().update(projectId, { target_base_url: 'https://example.com' });
      dbManager.getProjectRepo().updateStatus(projectId, 'configuring');
      dbManager.getProjectRepo().updateStatus(projectId, 'analyzing');
      expect(service.canTransition(projectId, 'analyzed')).toBe(true);
    });

    it('throws for non-existent project', () => {
      expect(() => service.canTransition('nonexistent', 'configuring')).toThrow('not found');
    });
  });

  // ===================== transition =====================

  describe('transition', () => {
    it('updates project status', () => {
      const updated = service.transition(projectId, 'configuring');
      expect(updated.status).toBe('configuring');
    });

    it('persists the status change in database', () => {
      service.transition(projectId, 'configuring');
      const reloaded = dbManager.getProjectRepo().findById(projectId);
      expect(reloaded?.status).toBe('configuring');
    });

    it('throws for invalid transition', () => {
      expect(() => service.transition(projectId, 'analyzed')).toThrow('Cannot transition');
    });

    it('throws when deliverables are not met', () => {
      dbManager.getProjectRepo().updateStatus(projectId, 'configuring');
      expect(() => service.transition(projectId, 'analyzing')).toThrow(ServiceError);
    });

    it('allows full forward chain when deliverables are met', () => {
      service.transition(projectId, 'configuring');
      dbManager.getProjectRepo().update(projectId, { target_base_url: 'https://example.com' });

      service.transition(projectId, 'analyzing');
      expect(dbManager.getProjectRepo().findById(projectId)?.status).toBe('analyzing');

      service.transition(projectId, 'analyzed');
      expect(dbManager.getProjectRepo().findById(projectId)?.status).toBe('analyzed');
    });

    it('throws for non-existent project', () => {
      expect(() => service.transition('nonexistent', 'configuring')).toThrow('not found');
    });
  });

  // ===================== getAvailableTransitions =====================

  describe('getAvailableTransitions', () => {
    it('returns [configuring] from draft', () => {
      expect(service.getAvailableTransitions(projectId)).toEqual(['configuring']);
    });

    it('excludes forward boundary when deliverables missing', () => {
      dbManager.getProjectRepo().updateStatus(projectId, 'configuring');
      // No base_url set → analyzing not available, only rollback to draft
      expect(service.getAvailableTransitions(projectId)).toEqual(['draft']);
    });

    it('includes forward boundary when deliverables met', () => {
      dbManager.getProjectRepo().update(projectId, { target_base_url: 'https://example.com' });
      dbManager.getProjectRepo().updateStatus(projectId, 'configuring');
      const transitions = service.getAvailableTransitions(projectId);
      expect(transitions).toContain('analyzing');
      expect(transitions).toContain('draft');
    });

    it('returns backward transitions from completed', () => {
      advanceTo('completed');
      const transitions = service.getAvailableTransitions(projectId);
      expect(transitions).toEqual(expect.arrayContaining(['running', 'ready']));
    });

    it('returns empty for isolated status with no valid transitions (edge)', () => {
      // completed has backward transitions, so not truly empty.
      // Verify all VALID_TRANSITIONS entries are accounted for.
      advanceTo('running');
      const transitions = service.getAvailableTransitions(projectId);
      expect(transitions).toContain('completed');
      expect(transitions).toContain('ready');
    });

    it('throws for non-existent project', () => {
      expect(() => service.getAvailableTransitions('nonexistent')).toThrow('not found');
    });
  });

  // ===================== getCurrentMode =====================

  describe('getCurrentMode', () => {
    it.each([
      ['draft', 'config'],
      ['configuring', 'config'],
      ['analyzing', 'analysis'],
      ['analyzed', 'analysis'],
      ['exploring', 'exploration'],
      ['explored', 'exploration'],
      ['generating', 'generation'],
      ['ready', 'generation'],
      ['running', 'execution'],
      ['completed', 'execution'],
    ] as const)('returns %s mode for %s status', (status, expectedMode) => {
      advanceTo(status);
      expect(service.getCurrentMode(projectId)).toBe(expectedMode);
    });

    it('throws for non-existent project', () => {
      expect(() => service.getCurrentMode('nonexistent')).toThrow('not found');
    });
  });

  // ===================== getModeRequirements =====================

  describe('getModeRequirements', () => {
    it('returns config requirements (no requires field)', () => {
      const req = service.getModeRequirements('config');
      expect(req.requiredStatuses).toContain('draft');
    });

    it('returns analysis requirements with target_base_url', () => {
      const req = service.getModeRequirements('analysis');
      expect(req.requiredStatuses).toContain('configuring');
      if ('requires' in req) {
        expect(req.requires).toContain('target_base_url');
      }
    });

    it('returns exploration requirements with business_modules', () => {
      const req = service.getModeRequirements('exploration');
      expect(req.requiredStatuses).toContain('analyzed');
      if ('requires' in req) {
        expect(req.requires).toContain('business_modules');
      }
    });

    it('returns generation requirements with url_bindings', () => {
      const req = service.getModeRequirements('generation');
      expect(req.requiredStatuses).toContain('explored');
      if ('requires' in req) {
        expect(req.requires).toContain('url_bindings');
      }
    });

    it('returns execution requirements with scripts', () => {
      const req = service.getModeRequirements('execution');
      expect(req.requiredStatuses).toContain('ready');
      if ('requires' in req) {
        expect(req.requires).toContain('scripts');
      }
    });
  });

  // ===================== checkDeliverables =====================

  describe('checkDeliverables', () => {
    it('returns met for non-boundary forward transition', () => {
      dbManager.getProjectRepo().updateStatus(projectId, 'configuring');
      dbManager.getProjectRepo().updateStatus(projectId, 'analyzing');
      expect(service.checkDeliverables(projectId, 'analyzed')).toEqual({ met: true, missing: [] });
    });

    it('returns met for backward transition (no deliverable check)', () => {
      dbManager.getProjectRepo().updateStatus(projectId, 'configuring');
      expect(service.checkDeliverables(projectId, 'draft')).toEqual({ met: true, missing: [] });
    });

    it('detects missing target_base_url for analysis mode entry', () => {
      dbManager.getProjectRepo().updateStatus(projectId, 'configuring');
      const result = service.checkDeliverables(projectId, 'analyzing');
      expect(result.met).toBe(false);
      expect(result.missing).toContain('target_base_url');
    });

    it('passes when target_base_url is set', () => {
      dbManager.getProjectRepo().update(projectId, { target_base_url: 'https://example.com' });
      dbManager.getProjectRepo().updateStatus(projectId, 'configuring');
      expect(service.checkDeliverables(projectId, 'analyzing')).toEqual({ met: true, missing: [] });
    });

    it('detects missing business_modules for exploration mode entry', () => {
      advanceTo('analyzed');
      const result = service.checkDeliverables(projectId, 'exploring');
      expect(result.met).toBe(false);
      expect(result.missing).toContain('business_modules');
    });

    it('passes when business modules exist', () => {
      advanceTo('analyzed');
      dbManager.getBusinessModuleRepo().create({ project_id: projectId, name: 'BM' });
      expect(service.checkDeliverables(projectId, 'exploring')).toEqual({ met: true, missing: [] });
    });

    it('detects missing url_bindings for generation mode entry', () => {
      // Reach explored without creating URL bindings
      advanceTo('analyzed');
      dbManager.getBusinessModuleRepo().create({ project_id: projectId, name: 'BM' });
      const bm = dbManager.getBusinessModuleRepo().findByProjectId(projectId)[0];
      dbManager.getFunctionalModuleRepo().create({ business_module_id: bm.id, name: 'Unbound FM' });
      dbManager.getProjectRepo().updateStatus(projectId, 'exploring');
      dbManager.getProjectRepo().updateStatus(projectId, 'explored');
      const result = service.checkDeliverables(projectId, 'generating');
      expect(result.met).toBe(false);
      expect(result.missing).toEqual([
        expect.objectContaining({ moduleName: 'Unbound FM' }),
      ]);
    });

    it('passes when url_bindings exist', () => {
      advanceTo('explored');
      expect(service.checkDeliverables(projectId, 'generating')).toEqual({ met: true, missing: [] });
    });

    it('fails generating transition when only one of two functional modules is bound', () => {
      advanceTo('analyzed');
      const bm = dbManager.getBusinessModuleRepo().create({ project_id: projectId, name: 'BM' });
      const boundFm = dbManager.getFunctionalModuleRepo().create({ business_module_id: bm.id, name: 'Bound FM' });
      const unboundFm = dbManager.getFunctionalModuleRepo().create({ business_module_id: bm.id, name: 'Unbound FM' });
      const url = dbManager.getURLRepo().create({ project_id: projectId, url: 'https://example.com/page' });
      dbManager.getURLModuleBindingRepo().create({ url_id: url.id, functional_module_id: boundFm.id });
      dbManager.getProjectRepo().updateStatus(projectId, 'exploring');
      dbManager.getProjectRepo().updateStatus(projectId, 'explored');

      const result = service.checkDeliverables(projectId, 'generating');

      expect(result).toEqual({
        met: false,
        missing: [{ moduleId: unboundFm.id, moduleName: 'Unbound FM' }],
      });
    });

    it('allows generating transition when both functional modules are bound', () => {
      advanceTo('analyzed');
      const bm = dbManager.getBusinessModuleRepo().create({ project_id: projectId, name: 'BM' });
      const fmOne = dbManager.getFunctionalModuleRepo().create({ business_module_id: bm.id, name: 'FM One' });
      const fmTwo = dbManager.getFunctionalModuleRepo().create({ business_module_id: bm.id, name: 'FM Two' });
      const url = dbManager.getURLRepo().create({ project_id: projectId, url: 'https://example.com/page' });
      dbManager.getURLModuleBindingRepo().create({ url_id: url.id, functional_module_id: fmOne.id });
      dbManager.getURLModuleBindingRepo().create({ url_id: url.id, functional_module_id: fmTwo.id });
      dbManager.getProjectRepo().updateStatus(projectId, 'exploring');
      dbManager.getProjectRepo().updateStatus(projectId, 'explored');

      expect(service.checkDeliverables(projectId, 'generating')).toEqual({ met: true, missing: [] });
    });

    it('treats zero functional modules as vacuously ready for generating transition', () => {
      advanceTo('analyzed');
      dbManager.getBusinessModuleRepo().create({ project_id: projectId, name: 'BM' });
      dbManager.getProjectRepo().updateStatus(projectId, 'exploring');
      dbManager.getProjectRepo().updateStatus(projectId, 'explored');

      expect(service.checkDeliverables(projectId, 'generating')).toEqual({ met: true, missing: [] });
    });

    it('treats a functional module with only rejected bindings as unbound', () => {
      advanceTo('analyzed');
      const bm = dbManager.getBusinessModuleRepo().create({ project_id: projectId, name: 'BM' });
      const fm = dbManager.getFunctionalModuleRepo().create({ business_module_id: bm.id, name: 'Rejected FM' });
      const url = dbManager.getURLRepo().create({ project_id: projectId, url: 'https://example.com/page' });
      dbManager.getURLModuleBindingRepo().create({
        url_id: url.id,
        functional_module_id: fm.id,
        status: 'rejected',
      });
      dbManager.getProjectRepo().updateStatus(projectId, 'exploring');
      dbManager.getProjectRepo().updateStatus(projectId, 'explored');

      expect(service.checkDeliverables(projectId, 'generating')).toEqual({
        met: false,
        missing: [{ moduleId: fm.id, moduleName: 'Rejected FM' }],
      });
    });

    it('throws ServiceError.validation with details when generating gate fails', () => {
      advanceTo('analyzed');
      const bm = dbManager.getBusinessModuleRepo().create({ project_id: projectId, name: 'BM' });
      dbManager.getFunctionalModuleRepo().create({ business_module_id: bm.id, name: 'Blocked FM' });
      dbManager.getProjectRepo().updateStatus(projectId, 'exploring');
      dbManager.getProjectRepo().updateStatus(projectId, 'explored');

      try {
        service.transition(projectId, 'generating');
        throw new Error('Expected transition to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceError);
        expect(error).toMatchObject({
          message: `Cannot transition project '${projectId}' from 'explored' to 'generating'`,
          statusCode: 400,
          code: 'VALIDATION_ERROR',
        });
        expect((error as ServiceError).details).toEqual([
          expect.stringMatching(/^functional_modules_missing_url_binding:[^:]+:Blocked FM$/),
        ]);
      }
    });

    it('detects missing scripts for execution mode entry', () => {
      // Reach ready without creating scripts
      advanceTo('explored');
      dbManager.getProjectRepo().updateStatus(projectId, 'generating');
      dbManager.getProjectRepo().updateStatus(projectId, 'ready');
      const result = service.checkDeliverables(projectId, 'running');
      expect(result.met).toBe(false);
      expect(result.missing).toContain('scripts');
    });

    it('passes when scripts exist', () => {
      advanceTo('ready');
      expect(service.checkDeliverables(projectId, 'running')).toEqual({ met: true, missing: [] });
    });

    it('throws for non-existent project', () => {
      expect(() => service.checkDeliverables('nonexistent', 'configuring')).toThrow('not found');
    });
  });

  // ===================== rollback =====================

  describe('rollback', () => {
    it('rolls back configuring → draft', () => {
      dbManager.getProjectRepo().updateStatus(projectId, 'configuring');
      const updated = service.rollback(projectId);
      expect(updated.status).toBe('draft');
    });

    it('rolls back analyzing → configuring', () => {
      advanceTo('analyzing');
      expect(service.rollback(projectId).status).toBe('configuring');
    });

    it('rolls back analyzed → analyzing', () => {
      advanceTo('analyzed');
      expect(service.rollback(projectId).status).toBe('analyzing');
    });

    it('rolls back completed → running', () => {
      advanceTo('completed');
      expect(service.rollback(projectId).status).toBe('running');
    });

    it('throws for draft (no rollback target)', () => {
      expect(() => service.rollback(projectId)).toThrow('Cannot rollback');
    });

    it('allows chaining multiple rollbacks', () => {
      advanceTo('explored');
      service.rollback(projectId); // explored → exploring
      expect(dbManager.getProjectRepo().findById(projectId)?.status).toBe('exploring');
      service.rollback(projectId); // exploring → analyzed
      expect(dbManager.getProjectRepo().findById(projectId)?.status).toBe('analyzed');
      service.rollback(projectId); // analyzed → analyzing
      expect(dbManager.getProjectRepo().findById(projectId)?.status).toBe('analyzing');
    });

    it('persists rollback in database', () => {
      advanceTo('configuring');
      service.rollback(projectId);
      const reloaded = dbManager.getProjectRepo().findById(projectId);
      expect(reloaded?.status).toBe('draft');
    });

    it('throws for non-existent project', () => {
      expect(() => service.rollback('nonexistent')).toThrow('not found');
    });
  });
});
