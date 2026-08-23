# vision-analysis `ai-chat-service :3001`

ai-chat-service 内部 Vision v2 能力。生产工具只注册 `vision.analyze_page` 与 `vision.resolve_target`，不通过 MCP Server 暴露，也不接受调用方 raw screenshot/base64。

- [shipped] `VisionSnapshotBindingV1` 位于 `shared/types/vision-snapshot.ts`；固定 proxy session/Tab/operation/request hash/lease sequence/snapshot/status 与 DOM artifact id/SHA-256/MIME/size，不携带 lease token 或 artifact bytes。
- [shipped] `VisionSnapshotLoader` 先读取 proxy operation ledger并核对 session/Tab/lease/request hash/status/artifact metadata，再下载 immutable artifact，复核 HTTP MIME/size/SHA/ETag 并内容寻址保存到 DSH attachment store；任何漂移都 fail closed。
- [shipped] `vision.analyze_page` 输出页面、区域、dialog、form、table 和异常状态摘要；`vision.resolve_target` 输出有序 locator candidates、置信度与证据。真实 `Page` / `Locator` / `ElementHandle` 不跨服务，当前 DOM 重解析仍归 proxy-adapter。
- [shipped] 主代理与子代理均可调用；每次调用只完成一个具有完整输入的分析任务，不保存流程状态、不连续执行、不调度脚本、不操作浏览器。
- [shipped] 生产代码不注册 `vision.find_element`；该名称只允许 test/dev compatibility adapter 使用。
- [shipped] Vision role 来自 `defaults.vision` Harness model route；provider/secret 缺失时 fail closed 且工具不发布。
- [shipped] 验收面：`vision-tool-provider.test.ts`、`snapshot-loader.test.ts`、`007-add-vision-model-columns.test.ts`、`session-vision-config.test.ts`。
