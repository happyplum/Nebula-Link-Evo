# Playwright Server API Reference

端口 3001 上运行的浏览器自动化服务，提供 HTTP 端点用于浏览器生命周期、页面操作和 DOM 交互。

## Browser (/browser/*)

**POST /browser/open** - 打开浏览器实例
- Body: `{ headless?: boolean, viewport?, cdpPort? }`
- Response: `{ success, message }`

**POST /browser/navigate** - 导航到 URL
- Body: `{ url, waitUntil?: 'networkidle' | 'load' | 'domcontentloaded' }`
- Response: `{ success, isOpen, currentUrl, title }`

**POST /browser/screenshot** - 截图
- Body: `{ fullPage?: boolean }`
- Response: `{ success, data: base64 }`

**POST /browser/close** - 关闭浏览器
- Response: `{ success, message }`

**GET /browser/status** - 浏览器状态
- Response: `{ isOpen, currentUrl, title }`

## Action (/action/*)

**POST /action/click** - 坐标点击，3次重试
- Body: `{ x, y }`
- Response: `{ success, message, attempts }`

**POST /action/click-by-selector** - 选择器点击，失败时强制重试
- Body: `{ selector, options? }`
- Response: `{ success, message }`

**POST /action/click-by-marker** - 标记点击，多策略降级
- Body: `{ snapshot_id, nebula_id }`
- Response: `{ success, strategy_used, attempts, latency_ms, error? }`

**POST /action/type** - 输入文本，3次重试
- Body: `{ selector, text, options? }`
- Response: `{ success, message, attempts }`

**POST /action/scroll** - 滚动页面
- Body: `{ x?: 0, y?: 0 }`
- Response: `{ success, message }`

**POST /action/focus** - 聚焦元素
- Body: `{ selector }`
- Response: `{ success, message }`

**POST /action/blur** - 失焦元素
- Body: `{ selector }`
- Response: `{ success, message }`

**POST /action/hover** - 悬停元素
- Body: `{ selector }`
- Response: `{ success, message }`

**POST /action/value** - 设置表单值
- Body: `{ selector, value }`
- Response: `{ success, message }`

**POST /action/dispatch** - 触发事件
- Body: `{ selector, eventType }`
- Response: `{ success, message }`

**POST /action/execute-by-marker** - 通过标记执行操作
- Body: `{ snapshot_id, nebula_id, action: 'click' | 'type' | 'focus' | 'blur' | 'hover' | 'value' | 'dispatch', param? }`
- Response: `{ success, strategy_used, attempts, latency_ms, error? }`

## DOM (/dom/*)

**GET /dom/simplified** - 简化 DOM 树，v2.0 格式，URL 缓存 (TTL 5min, max 100 entries)
- Response: `{ snapshot_id, annotated_screenshot_base64, elements_map, simplified_dom }`

**POST /dom/script** - 执行 JavaScript，带安全检查
- Body: `{ script, args? }`
- Response: `{ success, result }`

**GET /dom/element-at** - 指定坐标处的元素信息
- Query: `{ x, y }`
- Response: `{ success, element: { selector, tag, id?, class?, type?, bbox?, isVisible, isInteractable } }`

## Execute (/execute/*)

**POST /execute/script** - 与 POST /dom/script 相同

## Health

**GET /health** - 服务健康状态
- Response: `{ status: 'healthy', browserOpen }`

## Stream

**GET /browser/stream** - MJPEG 多部分截图流，30 FPS，最大 1920x1080，80% JPEG 质量

## CDP

**GET /cdp** - WebSocket 转发到 Chrome DevTools Protocol

**GET /cdp-status** - CDP 连接状态
- Response: `{ browserOpen, cdpPort?, cdpEndpoint, ready }`

## Vision Marker System

在可交互元素上自动注入 `data-nebula-id` 属性。定位策略顺序: nebula-id → role → testid → aria-label → text → css → xpath。返回: `{ success, strategy_used, attempts, latency_ms, error? }`

## Script Execution Safety

脚本执行阻止以下危险模式: eval(), Function(), document.cookie, localStorage.setItem, fetch(), XMLHttpRequest, $http
