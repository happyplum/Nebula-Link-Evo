# AI Clients Guidelines

## 1. Where to Look
| Domain | Path |
| :--- | :--- |
| ClientFactory (entry) | `index.ts` |
| Decision Factory | `decision/index.ts` |
| Decision Clients | `decision/kimi.ts`, `decision/glm.ts`, `decision/nvidia.ts` |
| Vision Factory | `vision/index.ts` |
| Vision Clients | `vision/glm.ts`, `vision/openai.ts`, `vision/anthropic.ts`, `vision/nvidia.ts` |
| Base Interfaces | `types.ts` |
| Vision Base Class | `vision/base.ts` |
| MCP Client | `mcp/sdk-client.ts` |

## 2. Factory Hierarchy
```
ClientFactory (index.ts)
├── VisionClientFactoryImpl (vision/index.ts)
│   └── GLM, OpenAI, Anthropic, NVIDIA
└── DecisionClientFactoryImpl (decision/index.ts)
    └── Kimi, GLM, NVIDIA, OpenAI, Anthropic
```

## 3. ClientFactory API
| Method | Purpose |
| :--- | :--- |
| `createVisionClient(provider?, model?)` | Create vision client |
| `createDecisionClient(provider?, model?)` | Create decision client |
| `detectUI(screenshot, viewport, instruction?)` | Detect UI elements |
| `decideAction(context, mcpTools?)` | Get next action |
| `detectWithFallback(...)` | Retry with fallback |
| `isUnifiedMode()` | Check if using unified model |

## 4. Decision Providers
| Provider | Client Class | File |
| :--- | :--- | :--- |
| kimi | `KimiDecisionClient` | `decision/kimi.ts` |
| glm | `GLMDecisionClient` | `decision/glm.ts` |
| nvidia | `NVIDIADecisionClient` | `decision/nvidia.ts` |

## 5. Vision Providers
| Provider | Client Class | File |
| :--- | :--- | :--- |
| glm | `GLMVisionClient` | `vision/glm.ts` |
| openai | `OpenAIVisionClient` | `vision/openai.ts` |
| anthropic | `AnthropicVisionClient` | `vision/anthropic.ts` |
| nvidia | `NVIDIAPluginClient` | `vision/nvidia.ts` |

## 6. Adding New Provider
1. Create client in `decision/` or `vision/`
2. Import and add case in factory's `create()` switch
3. Add config schema in `config/schema.ts`
4. Test with `pnpm test`

## 7. Key Patterns
- **Factory method**: Runtime provider selection via config
- **Fallback**: `detectWithFallback()` retries 3 times
- **MCP Tools**: Pass to `decideAction()` for tool-calling
- **Unified mode**: Decision client handles vision + decision

See parent AGENTS.md for conventions.
