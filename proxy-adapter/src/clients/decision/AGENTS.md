# Decision Clients

## Overview
AI decision clients that analyze browser state and determine next actions. Factory pattern with multi-provider support.

## Where To Look
| File | Purpose |
|------|---------|
| `index.ts` | DecisionClientFactoryImpl — provider selection |
| `base-impl.ts` | Base class with shared logic |
| `kimi.ts` | Moonshot AI (Chinese context) |
| `glm.ts` | Zhipu GLM-4 (multimodal) |
| `nvidia.ts` | NVIDIA NIM |
| `stream.ts` | Streaming response utilities |

## Core Methods
- `analyzeBrowserState()` — screenshot + DOM analysis
- `decideNextAction()` — determine next interaction
- `detectUIElements()` — identify interactive elements
- `detectWithFallback()` — 3-retry fallback mechanism
- `parseActionResponse()` — AI response → action parsing

## Modes
- **Unified**: Single model handles vision + decision.
- **Separated**: Dedicated vision client + decision client.

## Anti-Patterns
- No hardcoded API keys.
- No direct HTTP calls — use base class axios instances.
- No missing error handling.
- No untyped responses — Zod validate everything.
