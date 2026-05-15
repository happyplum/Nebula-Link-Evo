/**
 * Diagnosis Report Routes
 *
 * Routes for project-level diagnosis report with JSON/HTML export.
 * - GET /report — returns ProjectDiagnosisReport JSON (default)
 * - GET /report?format=json — downloadable JSON
 * - GET /report?format=html — HTML page with escaped content
 */
import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import fp from '../plugins/fastify-plugin.js';
import { DatabaseManager } from '../../database/db.js';
import { ServiceError } from '../../services/service-error.js';
import { generateReportHtml } from '../../utils/report-html.js';
import type { AIDiagnosisService } from '../../services/ai-diagnosis-service.js';

interface DiagnosisReportRouteOptions {
  diagnosisService?: AIDiagnosisService;
}

const VALID_FORMATS = new Set(['json', 'html']);

const routes: FastifyPluginAsyncTypebox<DiagnosisReportRouteOptions> = async (fastify, options) => {
  const diagnosisServiceOverride = options.diagnosisService;

  function getDiagnosisService(): AIDiagnosisService {
    if (diagnosisServiceOverride) return diagnosisServiceOverride;
    throw ServiceError.internal('Diagnosis service not configured');
  }

  function requireProject(projectId: string) {
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().findById(projectId);
    if (!project) {
      throw ServiceError.notFound(`Project '${projectId}' not found`);
    }
    return project;
  }

  // GET /report — project diagnosis report (JSON default, HTML/JSON export)
  fastify.get(
    '/report',
    async (request, reply) => {
      const { id: projectId } = request.params as { id: string };
      requireProject(projectId);

      const format = (request.query as { format?: string }).format ?? 'json';

      if (format !== 'json' && format !== 'html') {
        throw ServiceError.validation(
          `Invalid format '${format}'. Supported: json, html`,
        );
      }

      const report = getDiagnosisService().getProjectDiagnosisReport(projectId);

      if (format === 'html') {
        const html = generateReportHtml(report);
        return reply
          .status(200)
          .header('content-type', 'text/html; charset=utf-8')
          .send(html);
      }

      // JSON format — downloadable if explicitly requested via query
      if ((request.query as { format?: string }).format === 'json') {
        return reply
          .status(200)
          .header('content-type', 'application/json')
          .header('content-disposition', `attachment; filename="diagnosis-report.json"`)
          .send(report);
      }

      // Default JSON inline
      return reply.status(200).send(report);
    },
  );
};

export default fp(routes, { fastify: '5.x', name: 'diagnosis-report-routes', encapsulate: true });
