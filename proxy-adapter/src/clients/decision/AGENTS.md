# Decision Clients Guidelines

## OVERVIEW
AI decision-making clients that analyze browser state and determine next actions. Factory pattern with multiple provider support.

## STRUCTURE
```
decision/
├── index.ts           # DecisionClientFactoryImpl (entry point)
├── base-impl.ts       # Base class with shared logic (15.6k lines)
├── base.ts            # VisionClient interface
├── kimi.ts            # Kimi AI provider
├── glm.ts             # GLM (Zhipu) provider
├── nvidia.ts          # NVIDIA NIM provider
└── stream.ts          # Streaming response utilities
```

## FACTORY API
```typescript
interface DecisionClientFactory {
  create(config, provider: string, model: string): DecisionClient | null;
  createDefault(config): DecisionClient | null;
  getAvailableProviders(config): string[];
  getAvailableModels(config, provider: string): string[];
}
```

## DECISION PROVIDERS

| Provider | Client Class | File | Key Features |
|----------|-------------|------|--------------|
| **kimi** | `KimiDecisionClient` | `kimi.ts` | Moonshot AI, Chinese context |
| **glm** | `GLMDecisionClient` | `glm.ts` | Zhipu GLM-4, multimodal |
| **nvidia** | `NVIDIADecisionClient` | `nvidia.ts` | NVIDIA NIM models |
| **openai** | `OpenAIDecisionClient` | (via factory) | GPT-4 Vision |
| **anthropic** | `AnthropicDecisionClient` | (via factory) | Claude Vision |

## BASE IMPLEMENTATION (`base-impl.ts`)

**Core Methods**:
- `analyzeBrowserState()`: Analyze screenshot + DOM
- `decideNextAction()`: Determine next interaction
- `detectUIElements()`: Identify interactive elements
- `detectWithFallback()`: 3-retry fallback mechanism
- `parseActionResponse()`: Parse AI response to actions

**Unified Mode**: Single model handles both vision + decision tasks.

**Separation Mode**: Dedicated vision client + decision client.

## CLIENT LIFECYCLE
```typescript
const factory = new DecisionClientFactoryImpl();
const client = factory.create(config, 'glm', 'glm-4');

// Use client
const action = await client.decideNextAction(context);

// Cleanup (if needed)
await client.close();
```

## ADDING NEW PROVIDER

1. **Create client file**: `decision/<provider>.ts`
2. **Extend base class**: `extends BaseDecisionClient`
3. **Implement methods**:
   - `analyzeBrowserState()`
   - `decideNextAction()`
4. **Update factory**: Add case in `index.ts` switch
5. **Add config schema**: Update `config/schema.ts`
6. **Test**: `pnpm test`

## KEY PATTERNS
- **Factory pattern**: Runtime provider selection
- **Fallback strategy**: 3-retry with degradation
- **MCP tool calling**: Pass tools to AI for function invocation
- **Streaming support**: Incremental response processing
- **Config-driven**: Provider/model from configuration

## ANTI-PATTERNS
- ❌ No hardcoded API keys — use config
- ❌ No direct HTTP calls — use axios instances
- ❌ No blocking sync operations — async throughout
- ❌ No missing error handling — wrap all AI calls
- ❌ No untyped responses — use Zod validation

## TESTING
- Mock AI responses (no real API calls)
- Test factory creation logic
- Verify fallback behavior
- Validate action parsing

## DEPENDENCIES
- `../types.ts`: Base interfaces
- `../../config/schema.ts`: Configuration
- `axios`: HTTP client
- `zod`: Runtime validation

See parent `clients/AGENTS.md` for factory hierarchy.
