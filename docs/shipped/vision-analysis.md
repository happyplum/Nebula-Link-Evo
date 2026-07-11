# vision-analysis `ai-chat-service :3001`

ai-chat-service 内部视觉分析能力。通过 `VisionAnalyzer` 调用 AI 视觉模型识别 DOM 元素，以 `vision.find_element` 工具对 Chat 暴露。不通过 MCP Server 暴露。

- [shipped] Vision 分析引擎：`ai-chat-service/src/vision/`（vision-analyzer / prompts / types / index）。构造函数接收 `LanguageModelV3` + `VisionConfig`；提供 `findElement()` 方法。
- [shipped] 视觉元素查找工具 `vision.find_element`：`ai-chat-service/src/tools/providers/vision-tool-provider.ts`。`exposeTo: ['chat']`，不通过 MCP 暴露。
- [shipped] 工具本地缓存最近 5 个 DOM snapshot，`snapshot_id` 命中时复用缓存。
- [shipped] Vision 配置：`ai-chat-service` 的 `config.json` 的 `defaults.vision.{provider,model}`，由 resolver 自动解析 `apiKey`/`baseUrl`。
- [shipped] 配置缺失或初始化失败时降级为不可用工具，不阻断服务启动。
- [shipped] 消费的标注截图格式：`annotated_screenshot_base64` 为 gzip-compressed JPEG bytes 的 base64 字符串；调用视觉模型前必须先解压为 raw JPEG base64。
- [shipped] Vision model 列迁移：`ai-chat-service/src/conversation/migrations/007-add-vision-model-columns/`。
- [shipped] 验收面：`vision-tool-provider.test.ts`（覆盖调用与错误映射）、`007-add-vision-model-columns.test.ts`、`session-vision-config.test.ts`。
