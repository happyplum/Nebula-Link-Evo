# 技术债清理

## MCP 传输

- [tech-debt] `proxy-adapter/src/mcp-server/transport.ts` 当前只注册无状态 `POST /mcp`；SDK 客户端请求 `GET /mcp` 通知通道时由 Fastify 返回 404。POST `tools/list` / `tools/call` 不受影响，但 server-push 通知不可用，且客户端可能把 404 视为断连后重连。后续应补充 GET SSE handler，或显式返回 SDK 可识别的 405，并增加对应传输集成测试。
