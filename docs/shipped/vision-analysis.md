# vision-analysis `ai-chat-service :3001`

ai-chat-service 内部视觉分析能力。通过 `VisionAnalyzer` 调用 AI 视觉模型识别 DOM 元素，以 `vision.find_element` 工具对 Chat 暴露。不通过 MCP Server 暴露。

- [shipped] Vision 分析引擎：`ai-chat-service/src/vision/`（vision-analyzer / prompts / types / index）。构造函数接收 `LanguageModelV3` + `VisionConfig`；提供 `findElement()` 方法。
- [shipped] 视觉元素查找工具 `vision.find_element`：`ai-chat-service/src/tools/providers/vision-tool-provider.ts`。`exposeTo: ['chat']`，不通过 MCP 暴露。
- [shipped] 当前视觉输出边界是目标元素定位：返回 `snapshot_id`、`nebula_id`、置信度、推理说明及元素摘要，供分析/决策模型选择下一步浏览器动作；真实 `Page` / `Locator` / `ElementHandle` 只存在于 proxy-adapter 进程内，不跨服务传递。
- [designed] 主代理与子代理均可调用视觉模型；每次调用只完成一个具有完整输入的分析任务。视觉模型不持有流程状态、不连续执行、不调度脚本、不操作浏览器。
- [designed] 在元素查找之外提供结构化页面功能、视觉区域与 DOM 状态摘要，以支持无视觉能力的分析模型理解完整页面；当前无独立接口。
- [designed] 目标工具名与 Schema 已固定为 `vision.analyze_page` 和 `vision.resolve_target`：每次只读取一个不可变 snapshot，前者输出页面/区域/dialog/form/table/异常状态，后者输出有序 locator candidates 与约束。视觉模型不能操作浏览器，`proxy-adapter` 必须在当前 DOM 重新解析。详见 `ai-e2e/docs/ai-model-skill-contract.md`。
- [shipped] 工具本地缓存最近 5 个 DOM snapshot，`snapshot_id` 命中时复用缓存。
- [shipped] Vision 配置：`ai-chat-service` 的 `config.json` 的 `defaults.vision.{provider,model}`，由 resolver 自动解析 `apiKey`/`baseUrl`。
- [shipped] 配置缺失或初始化失败时降级为不可用工具，不阻断服务启动。
- [shipped] 消费的标注截图格式：`annotated_screenshot_base64` 为 gzip-compressed JPEG bytes 的 base64 字符串；调用视觉模型前必须先解压为 raw JPEG base64。
- [shipped] Vision model 列迁移：`ai-chat-service/src/conversation/migrations/007-add-vision-model-columns.ts`。
- [shipped] 验收面：`vision-tool-provider.test.ts`（覆盖调用与错误映射）、`007-add-vision-model-columns.test.ts`、`session-vision-config.test.ts`。
