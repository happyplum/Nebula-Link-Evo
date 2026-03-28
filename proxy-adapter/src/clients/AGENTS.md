# AI Clients

## Overview
AI provider factories and implementations. Decision (action planning), vision (screenshot analysis), Vercel AI SDK (streaming chat), and MCP (tool calling).

## Where To Look
| Area | Path | Notes |
|------|------|-------|
| ClientFactory | `index.ts` | Main entry — `createVisionClient()`, `createDecisionClient()` |
| Decision factory | `decision/index.ts` | DecisionClientFactoryImpl |
| Decision clients | `decision/kimi.ts`, `decision/glm.ts`, `decision/nvidia.ts` | Per-provider implementations |
| Decision base | `decision/base-impl.ts` | Shared logic for all decision clients |
| Vision factory | `vision/index.ts` | VisionClientFactoryImpl |
| Vision clients | `vision/glm.ts`, `vision/openai.ts`, `vision/anthropic.ts`, `vision/nvidia.ts` | Per-provider implementations |
| Vision base | `vision/base.ts` | VisionClient interface |
| Vercel AI SDK | `vercel-ai/` | Provider, streaming, core-tools, skills-tool |
| MCP client | `mcp/sdk-client.ts` | Model Context Protocol integration |
| Types | `types.ts` | Base interfaces |
| Compression | `compression.ts` | AI context compression client |

## Factory Hierarchy
```
ClientFactory (index.ts)
├── VisionClientFactoryImpl (vision/)
│   └── GLM, OpenAI, Anthropic, NVIDIA
└── DecisionClientFactoryImpl (decision/)
    └── Kimi, GLM, NVIDIA, OpenAI, Anthropic
```

## Key API
| Method | Purpose |
|--------|---------|
| `createVisionClient(provider?, model?)` | Create vision client |
| `createDecisionClient(provider?, model?)` | Create decision client |
| `detectUI(screenshot, viewport, instruction?)` | Detect UI elements |
| `decideAction(context, mcpTools?)` | Get next action |
| `detectWithFallback(...)` | 3-retry fallback |
| `isUnifiedMode()` | Single model handles vision + decision |

## Adding a New Provider
1. Create client in `decision/` or `vision/`
2. Add case in factory's `create()` switch
3. Add config schema in `config/schema.ts`
4. `pnpm test`

## Anti-Patterns
- No hardcoded API keys — use config.
- No direct HTTP calls — use axios instances from base.
- No missing error handling — wrap all AI calls.
- No untyped responses — use Zod validation.

## Child AGENTS
- `decision/AGENTS.md`
- `vision/AGENTS.md`
