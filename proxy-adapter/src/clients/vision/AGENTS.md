# Vision Clients

## Overview
AI vision clients for browser screenshot analysis. Factory pattern with multi-provider support for UI element detection.

## Where To Look
| File | Purpose |
|------|---------|
| `index.ts` | VisionClientFactoryImpl |
| `base.ts` | VisionClient interface |
| `glm.ts` | Zhipu GLM-4V (Chinese context, cost-effective) |
| `openai.ts` | GPT-4 Vision (high accuracy) |
| `anthropic.ts` | Claude 3.5 (detailed analysis) |
| `nvidia.ts` | NVIDIA NIM (low latency, self-hosted) |

## Interface
```typescript
abstract class VisionClient {
  abstract detectUIElements(screenshot, viewport, instruction?): Promise<DetectedElement[]>;
  abstract analyzeImage(screenshot, prompt): Promise<string>;
}
```

## Detection Workflow
Screenshot capture → AI analysis → response parsing → optional marker injection → detected elements

## Anti-Patterns
- No hardcoded model names — use config.
- No direct image manipulation — use Playwright.
- No blocking operations — async throughout.
- No missing retry logic — implement fallback.
