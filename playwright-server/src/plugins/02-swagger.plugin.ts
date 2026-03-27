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
          title: 'Playwright Server API',
          description: `# Nebula-Link Evo - Playwright Server API

## Overview
HTTP API service for controlling Playwright browser instances. Provides browser management, page navigation, element interaction, and DOM manipulation capabilities.

## Features
- **Browser Management**: Open, navigate, close browser instances
- **Page Interaction**: Click, type, scroll, and other browser actions
- **DOM Extraction**: Get simplified DOM tree of current page
- **Screenshot**: Capture full-page or viewport screenshots
- **TypeScript Native**: Fully typed API with Fastify 5.x
- **Hot Reload**: Development mode with automatic restart on changes

## Architecture
\`\`\`
[User Request]
    │
    ▼
[Playwright Server :3001] ──→ Chromium Browser
    │
    ├──→ Navigation
    ├──→ Element Actions (click, type, scroll)
    ├──→ DOM Extraction
    └──→ Screenshot Capture
\`\`\`

## Usage Examples

### Open Browser
\`\`\`bash
curl -X POST http://localhost:3001/browser/open \\
  -H "Content-Type: application/json" \\
  -d '{"headless": false, "viewport": {"width": 1920, "height": 1080}}'
\`\`\`

### Navigate to Page
\`\`\`bash
curl -X POST http://localhost:3001/browser/navigate \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com", "waitUntil": "networkidle"}'
\`\`\`

### Get Simplified DOM
\`\`\`bash
curl http://localhost:3001/dom/simplified
\`\`\`

### Take Screenshot
\`\`\`bash
curl -X POST http://localhost:3001/browser/screenshot \\
  -H "Content-Type: application/json" \\
  -d '{"fullPage": false, "type": "png"}'
\`\`\`

### Click Element
\`\`\`bash
curl -X POST http://localhost:3001/action/click \\
  -H "Content-Type: application/json" \\
  -d '{"x": 500, "y": 300}'
\`\`\`

### Type Text
\`\`\`bash
curl -X POST http://localhost:3001/action/type \\
  -H "Content-Type: application/json" \\
  -d '{"selector": "#search-input", "text": "Hello World", "options": {"delay": 50}}'
\`\`\`

## API Endpoints

### Browser Management
- \`POST /browser/open\`: Open browser instance
- \`POST /browser/navigate\`: Navigate to URL
- \`POST /browser/screenshot\`: Capture screenshot
- \`POST /browser/close\`: Close browser
- \`GET /browser/status\`: Get browser status

### Page Actions
- \`POST /action/click\`: Click by coordinates
- \`POST /action/click-by-selector\`: Click by CSS selector
- \`POST /action/type\`: Type text into element
- \`POST /action/scroll\`: Scroll page

### DOM Operations
- \`GET /dom/simplified\`: Get simplified DOM tree

## Response Format
All endpoints return consistent response format:
\`\`\`json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {}
}
\`\`\`

### Browser Status Example
\`\`\`json
{
  "isOpen": true,
  "currentUrl": "https://example.com",
  "title": "Example Domain",
  "viewport": {"width": 1920, "height": 1080}
}
\`\`\`

### DOM Elements Example
\`\`\`json
{
  "success": true,
  "url": "https://example.com",
  "title": "Example Domain",
  "elements": [
    {
      "tag": "button",
      "id": "submit",
      "class": "btn btn-primary",
      "text": "Submit",
      "bbox": {"x": 100, "y": 200, "width": 120, "height": 40},
      "isVisible": true,
      "isInteractable": true
    }
  ],
  "viewport": {"width": 1920, "height": 1080}
}
\`\`\`

## Configuration
- **BROWSER_HEADLESS**: Run browser in headless mode (default: false)
- **BROWSER_VIEWPORT_WIDTH**: Default viewport width (default: 1920)
- **BROWSER_VIEWPORT_HEIGHT**: Default viewport height (default: 1080)
- **ENABLE_SWAGGER**: Enable Swagger UI (default: true in dev, false in production)

## Browser Options
### Navigation Options
- \`waitUntil\`: Loading strategy (networkidle, domcontentloaded, load)
- \`timeout\`: Maximum wait time in milliseconds

### Screenshot Options
- \`fullPage\`: Capture full page or viewport only
- \`type\`: Output format (png, jpeg)

### Element Options
- \`selector\`: CSS selector for element targeting
- \`options.button\`: Button type (left, right, middle)
- \`options.clickCount\`: Number of clicks (default: 1)
- \`options.delay\`: Delay between actions in milliseconds

## Error Handling
All endpoints return consistent error format:
\`\`\`json
{
  "success": false,
  "error": "Detailed error message"
}
\`\`\`

### Common Errors
- \`Browser not open\`: Call \`POST /browser/open\` first
- \`Element not found\`: Check selector or coordinates
- \`Navigation timeout\`: Increase timeout or check URL accessibility
- \`Viewport not set\`: Set viewport when opening browser

## Environment Variables
\`\`\`env
ENABLE_SWAGGER=true
NODE_ENV=development
BROWSER_HEADLESS=false
BROWSER_VIEWPORT_WIDTH=1920
BROWSER_VIEWPORT_HEIGHT=1080
PLAYWRIGHT_PORT=3001
\`\`\`

## Playwright Configuration
- **Chromium Browser**: Headless mode support
- **Viewport**: Configurable dimensions
- **Wait Strategies**: networkidle, domcontentloaded, load
- **Screenshot Formats**: PNG, JPEG
- **CSS Selectors**: Full CSS selector support

## Integration with Proxy Adapter
The Playwright Server is integrated with the Proxy Adapter service for complete web automation workflows. Use the Proxy Adapter to orchestrate tasks with AI-powered decision making.

## Development
Run in development mode with hot reload:
\`\`\`bash
cd playwright-server
pnpm dev
\`\`\`

Production mode:
\`\`\`bash
pnpm build
pnpm start
\`\`\`
`,
          version: '1.0.0',
          contact: { name: 'API Support', email: 'support@example.com' },
          license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
        },
        servers: [
          { url: 'http://localhost:3001', description: 'Local development server' },
          { url: 'https://playwright.example.com', description: 'Production server' },
        ],
        tags: [
          { name: 'Health', description: 'Health check endpoints' },
          { name: 'Browser', description: 'Browser lifecycle management' },
          { name: 'Action', description: 'Page interaction actions' },
          { name: 'DOM', description: 'DOM tree operations' },
        ],
        externalDocs: {
          description: 'Playwright Documentation',
          url: 'https://playwright.dev/docs/api/class-browser',
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

    fastify.log.info('📚 Swagger UI available at http://localhost:3001/docs');
  },
  {
    name: 'swagger',
    fastify: '5.x',
  }
);
