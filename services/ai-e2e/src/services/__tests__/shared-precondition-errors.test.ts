import { describe, expect, it } from 'vitest';
import { SemanticProjectService } from '../semantic-project-service.js';
import { BusinessVersionService } from '../business-version-service.js';
import { SemanticRunService } from '../semantic-run-service.js';
import { SemanticAuthoringService } from '../semantic-authoring-service.js';
import { DomainError } from '../service-error.js';
import { requireSha256 } from '../../database/repositories/semantic-repository-utils.js';

describe('shared precondition error mapping with repository stubs', () => {
  const reject = () => requireSha256('invalid', 'fixtureDigest');

  it('keeps Run and Authoring shared validation refusals typed for the API boundary', () => {
    const run = new SemanticRunService({ startTodo: reject } as never);
    const authoring = new SemanticAuthoringService(
      {} as never,
      { createRevision: reject } as never,
      {} as never,
      {} as never
    );
    for (const operation of [
      () => run.startTodo({} as never),
      () => authoring.createRevision({} as never),
    ]) {
      expect(operation).toThrowError(
        expect.objectContaining({ kind: 'validation_error', code: 'validation_error' })
      );
      expect(operation).toThrowError(DomainError);
    }
  });

  it('keeps existing Project and BusinessVersion mapper semantics without claiming wire reachability', () => {
    const project = new SemanticProjectService({ createWorkspace: reject } as never);
    const version = new BusinessVersionService({ create: reject } as never);
    expect(() => project.createWorkspace({} as never)).toThrowError(
      expect.objectContaining({ statusCode: 500, code: 'INTERNAL_ERROR' })
    );
    expect(() => version.create({} as never)).toThrowError(
      expect.objectContaining({ statusCode: 500, code: 'INTERNAL_ERROR' })
    );
  });
});
