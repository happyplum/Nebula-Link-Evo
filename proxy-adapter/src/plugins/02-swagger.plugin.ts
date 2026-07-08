import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

/**
 * Swagger/OpenAPI 文档插件
 * 在生产环境中应该禁用（通过环境变量控制）
 */
export default fp(
  async (fastify) => {
    const isProduction = process.env.NODE_ENV === 'production';
    const enableSwagger = process.env.ENABLE_SWAGGER === 'true' || !isProduction;

    if (!enableSwagger) {
      fastify.log.info('📚 Swagger disabled (production mode)');
      return;
    }

    await fastify.register(swagger, {
      openapi: {
        info: {
          title: 'Proxy Adapter API',
          description: `# Nebula-Link Evo - Proxy Adapter API

## Overview
Browser MCP gateway that exposes Playwright browser-control tools via MCP StreamableHTTP, plus debug streams and configuration endpoints.

## Features
- **Browser Automation**: Execute browser actions (click, type, scroll, navigate) via MCP tools
- **Browser Screenshot & DOM Snapshot**: Capture annotated screenshots and simplified DOM for page perception
- **MCP Extensibility**: browser-control tools registered locally; external MCP servers supported via stdio/HTTP
- **Debug Dashboard**: Real-time task execution monitoring

## Architecture
\`\`\`
[MCP Client]
    │
    ▼
 [Proxy Adapter :3000] ──→ [Playwright] ──→ Chromium
    │
    ├──→ browser-control.* tools (screenshot, DOM, action)
    └──→ /debug/api/* (MJPEG, DOM snapshot)
\`\`\`

## Usage Examples

### Execute Browser Action via MCP
\`\`\`bash
curl -X POST http://localhost:3000/mcp \\
  -H "Content-Type: application/json" \\
  -d '{"method": "tools/call", "params": {"name": "browser-control.screenshot"}}'
\`\`\`

## Configuration
- **Decision/Vision providers**: resolved from config/config.json (consumed by ai-chat-service, not by proxy-adapter)
- **ENABLE_SWAGGER**: Enable Swagger UI (default: true in dev, false in production)

## Error Handling
All endpoints return consistent error format:
\`\`\`json
{
  "success": false,
  "error": "Detailed error message"
}
\`\`\`

## Runtime Notes
\`\`\`env
ENABLE_SWAGGER=true
NODE_ENV=development
\`\`\`
`,
          version: '2.0.0',
          contact: { name: 'API Support', email: 'support@example.com' },
          license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
        },
        servers: [
          { url: 'http://localhost:3000', description: 'Local development server' },
          { url: 'https://api.example.com', description: 'Production server' },
        ],
        tags: [
          { name: 'Health', description: 'Health check endpoints' },
          { name: 'Config', description: 'Configuration management' },
          { name: 'Task', description: 'Task execution' },
          { name: 'Debug', description: 'Debug and monitoring' },
        ],
        externalDocs: {
          description: 'Playwright Documentation',
          url: 'https://playwright.dev/',
        },
      },
    });

    await fastify.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
        tryItOutEnabled: true,
        filter: true,
        displayRequestDuration: true,
        validatorUrl: null,
        persistAuthorization: true,
      },
    });

    fastify.log.info('📚 Swagger UI available at http://localhost:3000/docs');
  },
  {
    name: 'swagger',
    fastify: '5.x',
  }
);
