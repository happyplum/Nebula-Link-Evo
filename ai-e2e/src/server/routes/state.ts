/**
 * State Routes
 *
 * Routes for project state management: current status,
 * mode transitions, and rollback.
 */
import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import fp from '../plugins/fastify-plugin.js';
import { DatabaseManager } from '../../database/db.js';
import { ServiceError } from '../../services/service-error.js';
import type { StateMachineService } from '../../services/state-machine-service.js';
import type { ProjectStatus } from '../../types/project.js';

interface StateRouteOptions {
  stateMachine?: StateMachineService;
}

const routes: FastifyPluginAsyncTypebox<StateRouteOptions> = async (fastify, options) => {
  const stateMachineOverride = options.stateMachine;

  function getStateMachine(): StateMachineService {
    if (stateMachineOverride) return stateMachineOverride;
    throw ServiceError.internal('State machine service not configured');
  }

  function requireProject(projectId: string) {
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().findById(projectId);
    if (!project) {
      throw ServiceError.notFound(`Project '${projectId}' not found`);
    }
    return project;
  }

  // GET / — current status + available transitions
  fastify.get(
    '/',
    {
      schema: {
        description: 'Get current project status and available transitions',
        tags: ['State'],
        response: {
          200: Type.Object({
            status: Type.String(),
            mode: Type.String(),
            availableTransitions: Type.Array(Type.String()),
          }),
        },
      },
    },
    async (request, reply) => {
      const { id: projectId } = request.params as { id: string };
      const project = requireProject(projectId);

      const stateMachine = getStateMachine();
      const mode = stateMachine.getCurrentMode(projectId);
      const availableTransitions = stateMachine.getAvailableTransitions(projectId);

      return reply.status(200).send({
        status: project.status,
        mode,
        availableTransitions,
      });
    },
  );

  // POST /transition — request mode transition
  fastify.post(
    '/transition',
    {
      schema: {
        description: 'Transition project to a new status',
        tags: ['State'],
        body: Type.Object({
          targetStatus: Type.String({ description: 'Target project status' }),
        }),
        response: {
          200: Type.Object({
            id: Type.String(),
            status: Type.String(),
            name: Type.String(),
          }),
          400: Type.Object({
            error: Type.Object({
              code: Type.String(),
              message: Type.String(),
              details: Type.Array(Type.String()),
            }),
          }),
          500: Type.Object({
            error: Type.Object({
              code: Type.String(),
              message: Type.String(),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      const { id: projectId } = request.params as { id: string };
      const project = requireProject(projectId);

      const { targetStatus } = request.body as { targetStatus: string };
      const stateMachine = getStateMachine();

      try {
        const updated = stateMachine.transition(projectId, targetStatus as ProjectStatus);

        fastify.sseEmitter.emit({
          type: 'project.status_changed',
          data: {
            projectId,
            oldStatus: project.status as ProjectStatus,
            newStatus: updated.status as ProjectStatus,
          },
        });

        return reply.status(200).send({
          id: updated.id,
          status: updated.status,
          name: updated.name,
        });
      } catch (error) {
        if (error instanceof ServiceError && error.statusCode === 400) {
          return reply.code(400).send({
            error: {
              code: 'DELIVERABLES_NOT_MET',
              message: error.message,
              details: error.details,
            },
          });
        }
        if (error instanceof ServiceError) {
          throw error;
        }
        return reply.code(500).send({
          error: {
            code: 'INTERNAL_ERROR',
            message: (error as Error).message,
          },
        });
      }
    },
  );

  // POST /rollback — rollback to previous mode
  fastify.post(
    '/rollback',
    {
      schema: {
        description: 'Roll back project to its previous status',
        tags: ['State'],
        response: {
          200: Type.Object({
            id: Type.String(),
            status: Type.String(),
            name: Type.String(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { id: projectId } = request.params as { id: string };
      requireProject(projectId);
      const project = requireProject(projectId);

      const stateMachine = getStateMachine();
      const rolledBack = stateMachine.rollback(projectId);

      fastify.sseEmitter.emit({
        type: 'project.status_changed',
        data: {
          projectId,
          oldStatus: project.status as ProjectStatus,
          newStatus: rolledBack.status as ProjectStatus,
        },
      });

      return reply.status(200).send({
        id: rolledBack.id,
        status: rolledBack.status,
        name: rolledBack.name,
      });
    },
  );
};

export default fp(routes, { fastify: '5.x', name: 'state-routes', encapsulate: true });
