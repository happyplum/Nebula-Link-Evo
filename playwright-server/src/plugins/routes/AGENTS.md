# Route Handlers Guidelines

## OVERVIEW
Fastify route handlers for browser control. Maps HTTP requests to BrowserManager actions.

## STRUCTURE
```
playwright-server/src/plugins/routes/
├── browser.ts        # Browser lifecycle endpoints
├── action.ts         # Page action endpoints (click, type, scroll)
├── dom.ts            # DOM query endpoints
├── cdp.ts            # CDP WebSocket passthrough
├── stream.ts         # Screencast WebSocket streaming
└── health.ts         # Health check endpoint
```

## ROUTE REFERENCE
| Prefix | File | Methods | Purpose |
|--------|------|---------|---------|
| `/browser/*` | `browser.ts` | POST | Open, close, navigate, screenshot, status |
| `/action/*` | `action.ts` | POST | Click, type, scroll commands |
| `/dom/*` | `dom.ts` | GET | Simplified DOM tree, element state |
| `/cdp` | `cdp.ts` | WS | Chrome DevTools Protocol tunnel |
| `/stream/*` | `stream.ts` | WS | Real-time screencast streaming |
| `/health` | `health.ts` | GET | Service health check |

## REQUEST/RESPONSE PATTERNS
```typescript
// Example: POST /action/click
interface ClickRequest {
  x: number;
  y: number;
}

interface ClickResponse {
  success: boolean;
  message: string;
}
```

## CONVENTIONS
- **Fastify plugins**: Encapsulated route handlers
- **JSON Schema validation**: TypeBox schemas for request validation
- **Error handling**: Defer to global error handler plugin
- **Async handlers**: All route handlers are async

## DEPENDENCIES
- BrowserManager: Browser actions delegation
- TypeBox: Request/response type definitions
- Fastify: Route registration and validation

## ANTI-PATTERNS
- ❌ No direct Playwright calls — use BrowserManager
- ❌ No business logic in routes — delegate to services
- ❌ No synchronous blocking — async throughout
- ❌ No manual error responses — throw errors, let handler manage

See parent `src/AGENTS.md` for conventions.
