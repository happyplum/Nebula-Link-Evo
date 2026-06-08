/**
 * Exploration Routes (Mode 2)
 *
 * API routes for web exploration: start/stop exploration sessions,
 * manage discovered URLs, and handle URL↔functional-module bindings.
 */

import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type, Static } from '@sinclair/typebox';
import fp from '../plugins/fastify-plugin.js';
import { DatabaseManager } from '../../database/db.js';
import { ExplorerService } from '../../services/explorer-service.js';
import { ServiceError } from '../../services/service-error.js';
import type { ProxyAdapterClient } from '../../infrastructure/proxy-adapter-client.js';
import type { PromptTemplateManager } from '../../ai/prompt-manager.js';
import type { BindingStatus } from '../../types/url.js';

// ---------- Options ----------

export interface ExplorationRouteOptions {
  proxyClient?: ProxyAdapterClient | null;
  promptManager?: PromptTemplateManager;
}

// ---------- Schemas ----------

const ExplorationOptionsSchema = Type.Object({
  maxDepth: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })),
  timeoutMs: Type.Optional(Type.Number({ minimum: 1000, maximum: 3600000 })),
  maxPages: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })),
  seedUrls: Type.Optional(Type.Array(Type.String())),
});

const ExplorationSessionResponseSchema = Type.Object({
  id: Type.String(),
  project_id: Type.String(),
  started_at: Type.String(),
  completed_at: Type.Optional(Type.String()),
  pages_visited_json: Type.Optional(Type.String()),
  urls_discovered_json: Type.Optional(Type.String()),
  strategy_used: Type.Optional(Type.String()),
  token_count: Type.Optional(Type.Number()),
  created_at: Type.String(),
});

const URLRecordSchema = Type.Object({
  id: Type.String(),
  project_id: Type.String(),
  url: Type.String(),
  title: Type.Optional(Type.String()),
  created_at: Type.String(),
});

const BindingSchema = Type.Object({
  id: Type.String(),
  url_id: Type.String(),
  module_id: Type.String(),
  confidence: Type.Optional(Type.Number()),
  status: Type.String(),
  created_at: Type.String(),
  url: Type.Optional(Type.Object({
    id: Type.String(),
    url: Type.String(),
    title: Type.Optional(Type.String()),
    status: Type.String(),
    created_at: Type.String(),
  })),
  module: Type.Optional(Type.Object({
    id: Type.String(),
    name: Type.String(),
  })),
});

const AddURLRequestSchema = Type.Object({
  url: Type.String(),
  title: Type.Optional(Type.String()),
});

const UpdateURLRequestSchema = Type.Object({
  page_snapshot_json: Type.String(),
});

const UrlIdParamSchema = Type.Object({
  id: Type.String(),
  urlId: Type.String(),
});

const CreateBindingRequestSchema = Type.Object({
  url_id: Type.String(),
  functional_module_id: Type.String(),
});

const UpdateBindingRequestSchema = Type.Object({
  action: Type.Union([Type.Literal('confirm'), Type.Literal('reject')]),
});

const ProjectIdParamSchema = Type.Object({
  id: Type.String(),
});

const BindingIdParamSchema = Type.Object({
  id: Type.String(),
  bindingId: Type.String(),
});

// ---------- Inferred types ----------

type ProjectIdParam = Static<typeof ProjectIdParamSchema>;
type BindingIdParam = Static<typeof BindingIdParamSchema>;
type ExplorationOptions = Static<typeof ExplorationOptionsSchema>;
type AddURLRequest = Static<typeof AddURLRequestSchema>;
type CreateBindingRequest = Static<typeof CreateBindingRequestSchema>;
type UpdateBindingRequest = Static<typeof UpdateBindingRequestSchema>;

// ---------- Route Plugin ----------

const explorationRoutes: FastifyPluginAsyncTypebox<ExplorationRouteOptions> = async (fastify, options) => {
  const { proxyClient = null, promptManager: promptManagerOpt } = options;

  function requireProxyClient(): ProxyAdapterClient {
    if (!proxyClient) {
      throw ServiceError.unavailable('AI service not configured (PROXY_ADAPTER_URL is empty)');
    }
    return proxyClient;
  }

  function requirePromptManager(): PromptTemplateManager {
    if (!promptManagerOpt) {
      throw ServiceError.internal('Prompt manager not configured');
    }
    return promptManagerOpt;
  }

  /**
   * Create an ExplorerService for the given request.
   */
  function getExplorerService(): ExplorerService {
    const client = requireProxyClient();
    const manager = requirePromptManager();
    const db = DatabaseManager.getInstance();
    return new ExplorerService(db, client, manager);
  }

  // GET /status — get exploration status
  fastify.get('/status', {
    schema: {
      description: 'Get current exploration status',
      tags: ['Exploration'],
      params: ProjectIdParamSchema,
    },
  }, async (request) => {
    const { id: projectId } = request.params as ProjectIdParam;
    const db = DatabaseManager.getInstance();
    const urls = db.getURLRepo().findByProjectId(projectId);
    // URLRecord 没有 status 字段；所有在 DB 中的 URL 都已被发现/探索，
    // 所以 pages_visited 直接等于 urls_found。
    return {
      status: 'idle',
      pages_visited: urls.length,
      urls_found: urls.length,
    };
  });

  // POST /start — trigger web exploration
  fastify.post('/start', {
    schema: {
      description: 'Start web exploration for a project',
      tags: ['Exploration'],
      params: ProjectIdParamSchema,
      body: Type.Optional(ExplorationOptionsSchema),
      response: {
        200: ExplorationSessionResponseSchema,
      },
    },
  }, async (request, reply) => {
    const { id: projectId } = request.params as ProjectIdParam;
    const options = request.body as ExplorationOptions | undefined;

    const service = getExplorerService();
    const session = await service.startExploration(projectId, options);

    // Emit SSE events after exploration completes
    const db = DatabaseManager.getInstance();
    const urls = db.getURLRepo().findByProjectId(projectId);
    const bindings = db.getURLModuleBindingRepo().findByProjectId(projectId);

    fastify.sseEmitter.emit({
      type: 'exploration.progress',
      data: {
        sessionId: session.id,
        pagesVisited: urls.length,
        urlsFound: urls.length,
      },
    });

    fastify.sseEmitter.emit({
      type: 'exploration.complete',
      data: {
        sessionId: session.id,
        totalUrls: urls.length,
        totalBindings: bindings.length,
      },
    });

    return reply.send(session);
  });

  // POST /stop — abort active exploration
  fastify.post('/stop', {
    schema: {
      description: 'Stop the active exploration for a project',
      tags: ['Exploration'],
      params: ProjectIdParamSchema,
    },
  }, async (request, reply) => {
    const { id: projectId } = request.params as ProjectIdParam;
    const service = getExplorerService();
    service.stopExploration(projectId);
    return reply.send({ stopped: true });
  });

  // GET /urls — get discovered URLs
  fastify.get('/urls', {
    schema: {
      description: 'Get all discovered URLs for a project',
      tags: ['Exploration'],
      params: ProjectIdParamSchema,
      response: {
        200: Type.Array(URLRecordSchema),
      },
    },
  }, async (request) => {
    const { id: projectId } = request.params as ProjectIdParam;
    const service = getExplorerService();
    return service.getDiscoveredURLs(projectId);
  });

  // GET /bindings — get URL↔module bindings
  fastify.get('/bindings', {
    schema: {
      description: 'Get all URL↔module bindings for a project',
      tags: ['Exploration'],
      params: ProjectIdParamSchema,
      response: {
        200: Type.Array(BindingSchema),
      },
    },
  }, async (request) => {
    const { id: projectId } = request.params as ProjectIdParam;
    const db = DatabaseManager.getInstance();
    const bindings = db.getURLModuleBindingRepo().findByProjectId(projectId);

    // Enrich with url and module data, map field names for frontend
    return bindings.map(b => {
      const url = db.getURLRepo().findById(b.url_id);
      const fm = db.getFunctionalModuleRepo().findById(b.functional_module_id);

      // Map status: ai_proposed → proposed, human_confirmed → confirmed, rejected → rejected
      let mappedStatus = b.status;
      if (b.status === 'ai_proposed') mappedStatus = 'proposed';
      else if (b.status === 'human_confirmed') mappedStatus = 'confirmed';

      return {
        id: b.id,
        url_id: b.url_id,
        module_id: b.functional_module_id,
        confidence: b.confidence_score,
        status: mappedStatus,
        created_at: b.created_at,
        url: url ? { id: url.id, url: url.url, title: url.title ?? undefined, status: 'explored' as const, created_at: url.created_at } : undefined,
        module: fm ? { id: fm.id, name: fm.name } : undefined,
      };
    });
  });

  // PUT /bindings/:bindingId — confirm or reject a binding
  fastify.put('/bindings/:bindingId', {
    schema: {
      description: 'Confirm or reject a URL↔module binding',
      tags: ['Exploration'],
      params: BindingIdParamSchema,
      body: UpdateBindingRequestSchema,
      response: {
        200: BindingSchema,
      },
    },
  }, async (request) => {
    const { bindingId } = request.params as BindingIdParam;
    const { action } = request.body as UpdateBindingRequest;
    const service = getExplorerService();

    if (action === 'confirm') {
      return service.confirmBinding(bindingId);
    }
    return service.rejectBinding(bindingId);
  });

  // PUT /urls/:urlId — update a URL's page snapshot
  fastify.put('/urls/:urlId', {
    schema: {
      description: 'Update a URL record (e.g. page snapshot)',
      tags: ['Exploration'],
      params: UrlIdParamSchema,
      body: UpdateURLRequestSchema,
      response: {
        200: URLRecordSchema,
      },
    },
  }, async (request) => {
    const { urlId } = request.params as Static<typeof UrlIdParamSchema>;
    const { page_snapshot_json } = request.body as Static<typeof UpdateURLRequestSchema>;
    const db = DatabaseManager.getInstance();

    const existing = db.getURLRepo().findById(urlId);
    if (!existing) {
      throw ServiceError.notFound(`URL not found: ${urlId}`);
    }

    const updated = db.getURLRepo().updateSnapshot(urlId, page_snapshot_json);
    return updated;
  });

  // POST /urls — manually add a URL
  fastify.post('/urls', {
    schema: {
      description: 'Manually add a discovered URL',
      tags: ['Exploration'],
      params: ProjectIdParamSchema,
      body: AddURLRequestSchema,
      response: {
        201: URLRecordSchema,
      },
    },
  }, async (request, reply) => {
    const { id: projectId } = request.params as ProjectIdParam;
    const { url, title } = request.body as AddURLRequest;
    const db = DatabaseManager.getInstance();
    const record = db.getURLRepo().create({
      project_id: projectId,
      url,
      title: title ?? undefined,
      discovered_method: 'manual',
    });

    fastify.sseEmitter.emit({
      type: 'exploration.url_found',
      data: {
        url: {
          id: record.id,
          project_id: record.project_id,
          url: record.url,
          path: new URL(record.url).pathname,
          title: record.title ?? undefined,
          created_at: record.created_at,
        },
      },
    });

    return reply.status(201).send(record);
  });

  // POST /bind — manually create a binding
  fastify.post('/bind', {
    schema: {
      description: 'Manually create a URL↔module binding',
      tags: ['Exploration'],
      params: ProjectIdParamSchema,
      body: CreateBindingRequestSchema,
      response: {
        201: BindingSchema,
      },
    },
  }, async (request, reply) => {
    const { url_id, functional_module_id } = request.body as CreateBindingRequest;
    const db = DatabaseManager.getInstance();

    const urlRecord = db.getURLRepo().findById(url_id);
    if (!urlRecord) {
      throw ServiceError.notFound(`URL not found: ${url_id}`);
    }

    const fm = db.getFunctionalModuleRepo().findById(functional_module_id);
    if (!fm) {
      throw ServiceError.notFound(`Functional module not found: ${functional_module_id}`);
    }

    const binding = db.getURLModuleBindingRepo().create({
      url_id,
      functional_module_id,
      status: 'human_confirmed',
    });

    fastify.sseEmitter.emit({
      type: 'exploration.binding_proposed',
      data: {
        binding: {
          id: binding.id,
          url_id: binding.url_id,
          functional_module_id: binding.functional_module_id,
          status: binding.status as BindingStatus,
          confidence: binding.confidence_score ?? undefined,
          created_at: binding.created_at,
          updated_at: binding.created_at,
        },
      },
    });

    return reply.status(201).send(binding);
  });

  // DELETE /bindings/:bindingId — delete a binding
  fastify.delete('/bindings/:bindingId', {
    schema: {
      description: 'Delete a URL↔module binding',
      tags: ['Exploration'],
      params: BindingIdParamSchema,
      response: {
        204: Type.Null(),
      },
    },
  }, async (request, reply) => {
    const { bindingId } = request.params as BindingIdParam;
    const db = DatabaseManager.getInstance();

    const existing = db.getURLModuleBindingRepo().findById(bindingId);
    if (!existing) {
      throw ServiceError.notFound(`Binding not found: ${bindingId}`);
    }

    db.getURLModuleBindingRepo().delete(bindingId);
    return reply.status(204).send();
  });
};

export default fp(explorationRoutes, { fastify: '5.x', name: 'exploration-routes', encapsulate: true });
