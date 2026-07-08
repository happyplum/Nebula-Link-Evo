# F4: 范围保真度 (Scope Fidelity)

**审查日期**: 2026-07-08
**审查执行者**: Sisyphus-Junior (Kimi K2.7)
**审查对象**: `.omo/plans/vision-ai-extraction.md`
**证据来源**: `git diff HEAD~7..HEAD` (7 commits), `grep` Phase 2/3 关键词, 文件源码审查

---

## 验证范围

| # | 检查项 | 方法 | 结果 |
|---|--------|------|------|
| 1 | **无 subagent 框架 (Phase 2)** | grep `subagent\|agent.framework\|orchestrator\|planning.loop\|multi.agent` in `proxy-adapter/src` + `ai-chat-service/src` | ✅ PASS |
| 2 | **无 MCP 工具过滤 (Phase 3)** | grep `filterConfig\|allowlist\|denylist\|tool.filter\|mcp.filter\|mcp-filter` in `proxy-adapter/src` + `ai-chat-service/src` | ✅ PASS |
| 3 | **无 debug-ui 更改** | `git diff HEAD~7..HEAD -- debug-ui/` | ✅ PASS |
| 4 | **无 ai-e2e 更改** | `git diff HEAD~7..HEAD -- ai-e2e/` | ✅ PASS |
| 5 | **无新增环境变量** | 检查所有新增/修改文件中的 `process.env` 和 env var 引用 | ✅ PASS |
| 6 | **变更限制在计划范围内** | 确认变更仅涉及 proxy-adapter, ai-chat-service, docs | ✅ PASS |
| 7 | **依赖变更在计划范围内** | 审查 `proxy-adapter/package.json` (仅移除 `@ai-sdk/openai-compatible` 和 `ai`) | ✅ PASS |

---

## 逐项详情

### 1️⃣ 无 subagent 框架 (Phase 2)

**检查命令**:
```powershell
Select-String -Path "proxy-adapter/src/**/*.ts" -Pattern "subagent|agent.framework|orchestrator|planning.loop|multi.agent"
Select-String -Path "ai-chat-service/src/**/*.ts" -Pattern "subagent|agent.framework|orchestrator|planning.loop|multi.agent"
```

**结果**: 两包均零匹配 ✅

**源码审查**: 新文件 `vision-tool-provider.ts` 是一个单一工具 Provider（`ToolProvider` 接口实现），没有子代理路由、状态机或编排逻辑。`VisionAnalyzer` 只是一个调用 AI model 的纯函数类。无任何多智能体或多代理模式引入。

**结论**: ✅ PASS

---

### 2️⃣ 无 MCP 工具过滤 (Phase 3)

**检查命令**:
```powershell
Select-String -Path "proxy-adapter/src/**/*.ts" -Pattern "filterConfig|allowlist|denylist|tool.filter|mcp.filter|mcp-filter"
Select-String -Path "ai-chat-service/src/**/*.ts" -Pattern "filterConfig|allowlist|denylist|tool.filter|mcp.filter|mcp-filter"
```

**结果**: 两包均零匹配 ✅

**源码审查**: 变更中没有引入任何 allowlist/denylist 配置、filterConfig 数据结构或工具过滤逻辑。`VisionToolProvider` 仅向 `exposeTo: ['chat']` 注册单个工具，这是已有 `ToolProvider` 接口的标准行为，不是新的过滤机制。

**结论**: ✅ PASS

---

### 3️⃣ 无 debug-ui 更改

**检查命令**:
```powershell
git diff HEAD~7..HEAD -- debug-ui/
```

**结果**: 无输出（零变更） ✅

**解释**: 计划 Scope OUT 明确排除 `debug-ui 前端改动（vision-agent.* 工具名称变化由后端 ToolRegistry 自动反映，前端无需改动）`。此检查确认 debug-ui 无任何文件被修改。

**结论**: ✅ PASS

---

### 4️⃣ 无 ai-e2e 更改

**检查命令**:
```powershell
git diff HEAD~7..HEAD -- ai-e2e/
```

**结果**: 无输出（零变更） ✅

**解释**: ai-e2e 不在当前计划范围内，确认无文件被修改。

**结论**: ✅ PASS

---

### 5️⃣ 无新增环境变量

**检查方法**: 审查所有新文件和新代码中 `process.env` 的引用，以及新增的配置字段。

**结果**:
- 所有新增/修改文件中的配置引用均来自 `config.json defaults.vision`（已有字段）
- 无新增 `process.env.XXX` 在新增代码中
- `vision-tool-provider.ts` 的 VisionConfig 使用从 `server.ts` 传入的 `providerConfig.settings` 值（timeout, maxTokens, temperature, maxRetries — 均为已有配置字段）

**结论**: ✅ PASS

---

### 6️⃣ 变更限制在计划范围内

**检查命令**:
```powershell
git diff HEAD~7..HEAD -- ':(exclude)proxy-adapter/*' ':(exclude)ai-chat-service/*' ':(exclude)docs/*' ':(exclude)*.md' ':(exclude)evidence/*'
```

**结果**: 无输出（零变更） ✅

**变更包范围**:
| 受影响包 | 变更类型 | 是否在计划 IN 中 |
|---------|---------|----------------|
| `proxy-adapter/` | 删除 vision-agent 模块，config 去 AI 化，swagger 文档更新 | ✅ 是 (Task 1) |
| `ai-chat-service/` | 新增 VisionAnalyzer, VisionToolProvider, schema 修复 | ✅ 是 (Task 2-4) |
| `docs/` | 架构文档更新 | ✅ 是 (Task 7) |
| `AGENTS.md` (根) | 概览更新 | ✅ 是 (属于 docs 同步) |
| `README.md` | 产品描述更新 | ✅ 是 (属于 docs 同步) |
| `evidence/` | 验证证据 | ✅ 是 (Final verification wave) |

**结论**: ✅ PASS — 无计划外变更

---

### 7️⃣ 依赖变更在计划范围内

**`proxy-adapter/package.json` 变更**:
```diff
-    "@ai-sdk/openai-compatible": "^2.0.31",
-    "ai": "^6.0.105",
```

**计划依据**: 计划 Task 1 备注明确说明：
> **可选的依赖清理**（如果移除后 proxy-adapter 不再使用）：
> 检查 `proxy-adapter/package.json` 是否仍需要 `@ai-sdk/openai-compatible` 和 `ai` 包

移除 vision-agent 后，`@ai-sdk/openai-compatible`（原 vision-agent 使用的 AI SDK 兼容包）和 `ai`（`generateText` 调用）不再需要。依赖移除属于计划范围内的可选清理。

**注**: 未检查 `ai` 是否因测试依赖仍被需要 — 这是一个潜在风险，但属于代码质量审查 (F2) 范围，不影响范围保真度。

**结论**: ✅ PASS

---

## 综合判定

### Scope Creep 清单

| 潜在的 scope creep | 出现位置 | 结论 |
|-------------------|---------|------|
| `/test-ai` 响应 schema 修复 (`debug-ai.ts`) | ai-chat-service | ⚠️ **在范围内** — 修复已有 test-ai endpoint 的 Fastify schema 序列化问题，不是新功能；计划明确声明不因此拒绝 |
| Swagger 文档大幅更新 (`02-swagger.plugin.ts`) | proxy-adapter | ⚠️ **在范围内** — 是 proxy-adapter 去 AI 化的一部分，更新文档描述反映新架构 |
| `validator.ts` apiKey/baseUrl error → warning | proxy-adapter | ⚠️ **在范围内** — 计划 Task 1 明确列出此变更（config 去 AI 化） |
| `resolver.ts` decision provider 错误分级 | proxy-adapter | ⚠️ **在范围内** — 计划 Task 1 明确要求 |

**未发现** 任何 Phase 2 (subagent/多智能体) 或 Phase 3 (MCP 过滤) 的代码或配置。

### Final Verdict

**VERDICT: ✅ APPROVE**

所有 7 项范围保真度检查全部通过：
- ✗ 无 subagent 框架代码
- ✗ 无 MCP 工具过滤代码
- ✗ 无 debug-ui 或 ai-e2e 更改
- ✗ 无新增环境变量
- ✗ 无计划外包或文件变更
- ✗ 依赖变更符合计划说明

变更严格限制在 plan Scope IN 范围内：proxy-adapter 去 AI 化 + ai-chat-service 视觉能力接管 + 文档同步。未引入 Phase 2/3 的增量。
