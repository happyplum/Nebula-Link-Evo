# 贡献指南

感谢你参与 Nebula-Link Evo。提交改动前，请先阅读根目录及目标包中的
`AGENTS.md`，并确认改动没有越过各包的产品边界。

## 开发环境

- Node.js 22.13.0 或更高版本
- pnpm 10.34.5

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

运行开发环境与包级命令前，请参考 [README](README.md) 和目标包的
`PRODUCT-SPEC.md`。

## 提交改动

1. 一个 Pull Request 只处理一个可独立验证的意图。
2. 修改前先检查现有实现、调用方和相关测试，避免无关重构或格式化。
3. 新增或修改模块、页面、路由、功能及跨包契约时，同步维护对应的
   `PRODUCT-SPEC.md`、根索引和相关 shipped 清单。
4. 不得提交 API Key、访问令牌、Cookie、数据库、日志、截图或本地配置。
5. 新增依赖、代码或资产时，必须确认其许可证与 `AGPL-3.0-only` 兼容，
   并保留必要的版权和许可证声明。

提交 PR 前至少运行：

```bash
pnpm exec prettier --check path/to/changed-file.ts
pnpm build
pnpm test
```

根级 `pnpm lint` 和 `pnpm format:check` 仍有已登记的历史技术债；请对本次
修改的文件运行对应包的 lint 或 Prettier 检查，且不得新增问题。

## 贡献授权

除非文件中另有明确声明，提交到本仓库的贡献将按
`AGPL-3.0-only` 授权，不要求转让版权。

项目维护者可能为其拥有完整再授权权利的代码提供单独商业许可。未经贡献者
另行书面授权，第三方贡献不会被重新授权到闭源商业发行版中。
