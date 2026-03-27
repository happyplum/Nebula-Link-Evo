# Vision Clients Guidelines

## OVERVIEW
AI vision clients for browser screenshot analysis. Factory pattern with multi-provider support for UI element detection.

## STRUCTURE
```
vision/
├── index.ts       # VisionClientFactoryImpl (entry point)
├── base.ts        # VisionClient interface
├── glm.ts         # GLM (Zhipu) vision provider
├── openai.ts      # OpenAI GPT-4 Vision
├── anthropic.ts   # Claude Vision
└── nvidia.ts      # NVIDIA NIM vision models
```

## FACTORY API
```typescript
interface VisionClientFactory {
  create(config, provider: string, model: string): VisionClient | null;
  createDefault(config): VisionClient | null;
  getAvailableProviders(config): string[];
  getAvailableModels(config, provider: string): string[];
}
```

## VISION PROVIDERS

| Provider | Client Class | File | Model | Best For |
|----------|-------------|------|-------|----------|
| **glm** | `GLMVisionClient` | `glm.ts` | GLM-4V | Chinese context, cost-effective |
| **openai** | `OpenAIVisionClient` | `openai.ts` | GPT-4 Vision | High accuracy, English |
| **anthropic** | `AnthropicVisionClient` | `anthropic.ts` | Claude 3.5 | Detailed analysis |
| **nvidia** | `NVIDIAPluginClient` | `nvidia.ts` | NIM models | Low latency, self-hosted |

## CLIENT INTERFACE
```typescript
abstract class VisionClient {
  abstract detectUIElements(
    screenshot: string,
    viewport: ViewportInfo,
    instruction?: string
  ): Promise<DetectedElement[]>;
  
  abstract analyzeImage(
    screenshot: string,
    prompt: string
  ): Promise<string>;
}
```

## USAGE PATTERN
```typescript
const factory = new VisionClientFactoryImpl();
const vision = factory.create(config, 'openai', 'gpt-4-vision');

const elements = await vision.detectUIElements(
  screenshotBase64,
  viewportInfo,
  'Find the submit button'
);
```

## DETECTION WORKFLOW

1. **Screenshot capture**: Base64-encoded image
2. **AI analysis**: Send to vision model with prompt
3. **Response parsing**: Extract coordinates/labels
4. **Marker injection** (optional): Overlay detection markers
5. **Return elements**: Array of detected UI elements

## ADDING NEW PROVIDER

1. **Create client file**: `vision/<provider>.ts`
2. **Extend base class**: `extends VisionClient`
3. **Implement methods**:
   - `detectUIElements()`
   - `analyzeImage()`
4. **Update factory**: Add case in `index.ts` switch
5. **Add config schema**: Update `config/schema.ts`
6. **Test**: `pnpm test`

## IMAGE FORMATS
- **Input**: Base64 PNG/JPEG
- **Compression**: gzip for marker overlays
- **Resolution**: Match viewport dimensions
- **Markers**: Red numbered overlays (optional)

## KEY PATTERNS
- **Factory pattern**: Dynamic provider selection
- **Unified interface**: All providers implement same API
- **Fallback chain**: Retry with alternative providers
- **Caching**: Cache detection results (optional)
- **Config-driven**: Provider/model from configuration

## ANTI-PATTERNS
- ❌ No hardcoded model names — use config
- ❌ No direct image manipulation — use Playwright
- ❌ No blocking operations — async throughout
- ❌ No missing retry logic — implement fallback
- ❌ No unvalidated responses — parse with Zod

## PERFORMANCE
- **Latency**: 500ms-2s depending on model
- **Concurrency**: Limit parallel vision requests
- **Caching**: Cache repeated detections
- **Fallback**: 3-retry max before failure

## TESTING
- Mock vision API responses
- Test detection accuracy with sample images
- Verify factory creation logic
- Test fallback behavior

## DEPENDENCIES
- `base.ts`: Vision client interface
- `../../config/schema.ts`: Configuration
- `axios`: HTTP client
- `zod`: Response validation

See parent `clients/AGENTS.md` for factory hierarchy.
