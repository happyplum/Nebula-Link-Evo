# Browser Manager Guidelines

## OVERVIEW
BrowserManager (792 lines) — Singleton that encapsulates Playwright API. Controls browser lifecycle and page actions.

## WHERE TO LOOK
| Class | File | Purpose |
|-------|------|---------|
| BrowserManager | `browser.ts` | Browser lifecycle, page actions |
| ScreencastManager | `screencast.ts` | CDP-based video streaming |
| LocatorGenerator | `locator-generator.ts` | Multi-strategy element locators |
| MarkerInjector | `marker-injector.ts` | DOM visual markers |

## BROWSERMANGER API
| Method | Purpose |
|--------|---------|
| `openBrowser(config)` | Launch Chromium instance |
| `closeBrowser()` | Terminate browser |
| `navigate(url, options)` | Navigate to URL with wait strategy |
| `screenshot(fullPage)` | Capture page screenshot |
| `click(x, y)` / `clickBySelector(selector)` | Click action |
| `type(selector, text)` | Input text |
| `scroll(x, y)` | Scroll page |
| `getDomSimplified()` | Extract visible DOM tree |
| `getElementState(selector)` | Check element visibility/interactability |

## LOCATOR STRATEGIES
Priority order (most reliable first):
1. **Role**: `getByRole()`
2. **TestId**: `getByTestId()`
3. **Aria**: `getByLabel()`, `getByPlaceholder()`
4. **Text**: `getByText()`, `containsText()`
5. **CSS**: `locator()`
6. **XPath**: `locator()` (fallback)

## UNIQUE FEATURES
- **Screencast**: Real-time WebSocket streaming via CDP
- **Snapshot cache**: DOM caching for performance
- **Marker injection**: `data-nebula-id` for element tracking
- **Multi-strategy locators**: Automatic fallback chain

## ANTI-PATTERNS
- ❌ No direct Page object access — use BrowserManager
- ❌ No hardcoded selectors — prefer semantic locators
- ❌ No synchronous blocking — use async polling
- ❌ No manual instance management — singleton pattern

## DEPENDENCIES
- Playwright: `chromium.launch()`, `page.*` APIs
- CDP: Low-level Chrome DevTools Protocol
- Fastify routes: HTTP endpoint handlers

See parent `src/AGENTS.md` for conventions.
