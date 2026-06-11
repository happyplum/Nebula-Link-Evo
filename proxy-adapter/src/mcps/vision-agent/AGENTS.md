# Vision Agent

## Overview

内置视觉分析模块，作为 `VisionAgentProvider`（ToolProvider 接口）在进程内运行，为 Chat 和 MCP Server 提供视觉工具。

## Architecture

```
config.json → resolver → ResolvedConfig
                              ↓
server.ts → buildVisionAgentConfig() → VisionConfigOverride
                              ↓
VisionAgentProvider → loadVisionConfig(configOverride?) → VisionConfig (zod validated)
                              ↓
VisionAnalyzer (Vercel AI SDK, @ai-sdk/openai-compatible)
                              ↓
createVisionAgentTools() → 4 GatewayTools (vision-agent.*)
```

## Tools

| Tool | Description |
|------|-------------|
| `vision-agent.analyze` | 获取页面快照 + 带 nebula-id 标注的截图，返回元素摘要 |
| `vision-agent.find_element` | 自然语言描述查找 DOM 元素 |
| `vision-agent.get_element_info` | 按 nebula_id 获取元素完整信息 |
| `vision-agent.screenshot` | 截图 + 红色 nebula-id 标注或原始 PNG |

## Files

| File | Purpose |
|------|---------|
| `config.ts` | Zod schema + `loadVisionConfig()` + `VisionConfigOverride` 接口 |
| `vision-analyzer.ts` | Vercel AI SDK 调用视觉模型的核心分析器 |
| `tools/index.ts` | 工具注册，创建 4 个 GatewayTool |
| `snapshot-cache.ts` | 快照缓存管理 |
| `prompts/` | 元素查找等 prompt 模板 |
| `types.ts` | 模块内共享类型 |

## Configuration

Vision agent 配置通过 `config.json` → resolver → `buildVisionAgentConfig()` 注入，不需要设置独立环境变量：

- `defaults.vision`: 格式 `"provider/model"` (如 `"nvidia/qwen/qwen3.5-122b-a10b"`)
- 对应 provider 的 `baseUrl`、`apiKey` 由 resolver 解析
- `settings.maxTokens`、`temperature`、`timeout`、`maxRetries` 从全局 settings 传入

如果 `defaults.vision` 未配置或 provider 不可用，VisionAgentProvider 降级为 0 工具，不阻断 Proxy Adapter 启动。

## Degradation Behavior

- `buildVisionAgentConfig()` 返回 `undefined` → `loadVisionConfig(undefined)` → 尝试 env fallback → zod 验证失败 → catch → degraded (0 tools, no crash)
- Provider `enabled: false` → 跳过
- Provider apiKey 未解析 → 跳过

## Anti-Patterns

- 不要在此模块内直接读取 `process.env` — 配置应通过 `VisionConfigOverride` 传入
- 不要绕过 `loadVisionConfig()` 的 zod 验证直接构造 VisionConfig
- 不要重新引入外部 stdio MCP server 架构
