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
Web automation and AI integration service that orchestrates browser automation tasks using a decision model plus MCP servers.

## Features
- **Web Automation**: Execute complex multi-step browser tasks with natural language instructions
- **Decision Model Orchestration**: Uses a unified decision model for planning and tool selection
- **MCP Extensibility**: Vision analysis via MCP servers; browser-control tools registered locally
- **Browser Screenshot Support**: Retains screenshot/snapshot browser tools without embedding vision provider logic
- **Debug Dashboard**: Real-time task execution monitoring

## Architecture
\`\`\`
[User Request]
    │
    ▼
 [Proxy Adapter :3000] ──→ [Decision Model Provider]
    │
    ├──→ [vision-server MCP]
    └──→ [Playwright Server :3001] ──→ Chromium
\`\`\`

## Usage Examples

### Execute Simple Task
\`\`\`bash
curl -X POST http://localhost:3000/task \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com", "instruction": "点击登录按钮"}'
\`\`\`

### Execute Multi-Step Task
\`\`\`bash
curl -X POST http://localhost:3000/task \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://example.com",
    "instruction": "填写表单并提交",
    "context": {
      "maxSteps": 20
    }
  }'
\`\`\`

## Response Format
Successful task execution returns:
- \`success\`: boolean - overall task status
- \`url\`: string - final page URL
- \`actions\`: array - list of executed actions
  - \`action.type\`: click, type, scroll, finish
  - \`action.params\`: specific action parameters
  - \`action.reasoning\`: AI reasoning for the action
- \`result\`: string - task completion message

### Action Example
\`\`\`json
{
  "action": {
    "type": "click",
    "params": {"x": 500, "y": 300},
    "reasoning": "点击登录按钮"
  },
  "success": true,
  "message": "Clicked at (500, 300)"
}
\`\`\`

## Configuration
- **Decision provider config**: resolved from config/config.json
- **vision-server MCP env**: injected at runtime from defaults.vision + matching provider config
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
GLM_API_KEY=your_provider_key_here
NVIDIA_API_KEY=your_provider_key_here
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
