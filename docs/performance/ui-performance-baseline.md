# UI 性能基线

本基线用于比较 `debug-ui` 与 `ai-e2e/ui` 的生产构建首屏表现。它是可复现的本地实验室参考，不是线上 CrUX 数据，也不是 CI 硬阈值。

## 测量环境

- 日期：2026-08-29
- 系统：Windows 11 x64
- 浏览器：Chrome 152.0.7977.64
- Node.js：24.18.0
- 构建：Vite 8.2.2 production bundle + `vite preview`
- 视口：1365 × 768
- 网络：Fast 3G
- CPU：4× slowdown
- 缓存：禁用；每次使用隔离浏览器上下文冷启动
- 采集：Chrome DevTools Performance trace；初始传输量只统计首屏 JS/CSS 请求

## 结果

| 页面/阶段                     |      LCP | CLS | 首屏 JS/CSS 传输 |                    交互参考 |
| ----------------------------- | -------: | --: | ---------------: | --------------------------: |
| `debug-ui` LiveKit 优化前     | 4,039 ms |   0 |        305,941 B |          184 ms EventTiming |
| `debug-ui` LiveKit 按需加载后 | 3,133 ms |   0 |        172,078 B |          184 ms EventTiming |
| `ai-e2e/ui` 当前基线          | 2,529 ms |   0 |        143,334 B | 40.2 ms click-to-second-rAF |

`debug-ui` 首屏减少 133,863 B（43.8%），同条件 LCP 缩短 906 ms（22.4%）。优化后的首屏不再请求 LiveKit；切换到 WebRTC 时才加载 `LiveKitView` 与 `vendor-livekit`，加载期间继续显示 MJPEG。

`ai-e2e/ui` 的 40.2 ms 是“打开新建项目对话框”从点击到第二个 `requestAnimationFrame` 的实验室代理值，不等同于 INP。该次 DevTools trace 没有产生可用的非零 EventTiming interaction candidate。

## 首屏传输明细

| 页面/阶段         |   应用 JS | Runtime JS | React vendor | LiveKit vendor |      CSS |      合计 |
| ----------------- | --------: | ---------: | -----------: | -------------: | -------: | --------: |
| `debug-ui` 优化前 | 102,834 B |    1,016 B |     59,241 B |      132,555 B | 10,295 B | 305,941 B |
| `debug-ui` 优化后 | 101,574 B |    1,016 B |     59,241 B |            0 B | 10,247 B | 172,078 B |
| `ai-e2e/ui`       |  66,664 B |      889 B |     59,253 B |              — | 16,528 B | 143,334 B |

## 复测流程

1. 构建目标 UI：`pnpm --filter debug-ui build` 或 `pnpm --filter ai-e2e-ui build`。
2. 使用对应包的 `preview` 脚本启动 production bundle；默认端口分别为 4173、4174。
3. 新建隔离浏览器上下文，设定 1365 × 768、Fast 3G、CPU 4× slowdown，并禁用缓存。
4. 从冷启动导航到 `/debug/` 或 `/ai-e2e/`，录制到首屏稳定。
5. 从 Performance trace 读取 LCP/CLS，从首屏请求读取 JS/CSS transfer size。
6. 交互对比必须使用同一控件与同一指标；不要把 second-rAF 代理值与 EventTiming/INP 混比。

单次本地采样会受机器和调度噪声影响。准备把它升级为 CI 性能预算前，应在固定 runner 上至少采集 3 次冷启动并采用中位数。
