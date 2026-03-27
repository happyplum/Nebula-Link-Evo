# Task Executor Guidelines

## OVERVIEW
Core automation engine (974 lines). Orchestrates AI decision-making, browser actions, and task lifecycle.

## WHERE TO LOOK
| Component | File | Purpose |
|-----------|------|---------|
| Main engine | `task-executor.ts` | Task parsing, AI loop, action execution |
| Browser client | `browser-client.ts` | HTTP calls to Playwright Server |
| Types | `types.ts` | TaskRequest, Action, TaskResponse interfaces |

## CORE FLOW
```
1. Receive TaskRequest (url, instruction, context)
2. Open browser via BrowserClient
3. Navigate to URL
4. Loop (maxSteps):
   - Screenshot + DOM extraction
   - AI analysis (vision + decision)
   - Parse action (click/type/scroll/finish)
   - Execute action via Playwright Server
   - Check completion
5. Return TaskResponse
```

## KEY PATTERNS
- **Step loop**: Configurable maxSteps (default: 10)
- **AI decision**: Vision client → detect elements → Decision client → choose action
- **Action types**: `click`, `type`, `scroll`, `wait`, `navigate`, `finish`, `mcp_call`
- **Error handling**: Custom error classes in `errors/` directory
- **MCP tools**: Pass to decision client for tool-calling

## ANTI-PATTERNS
- ❌ No direct browser manipulation — use BrowserClient
- ❌ No hardcoded AI logic — delegate to client factories
- ❌ No blocking operations — async/await throughout
- ❌ No state management outside ConversationManager

## DEPENDENCIES
- `BrowserClient`: Playwright Server communication
- `ClientFactory`: AI provider instantiation
- `ConversationManager`: Session state persistence
- `MCP SDK client`: Tool calling integration

See parent `src/AGENTS.md` for conventions.
