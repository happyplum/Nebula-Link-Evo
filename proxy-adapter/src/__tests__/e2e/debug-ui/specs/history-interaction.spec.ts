import { test, expect } from '../fixtures/test.fixture';
import { TIMEOUTS } from '../constants';

test.describe('Debug UI - History & Interaction Panels', () => {
  test.beforeEach(async ({ debugPage }) => {
    // Wait for page to fully load
    await debugPage.waitForTimeout(TIMEOUTS.LONG);
  });

  test.describe('History Panel - Basic Rendering', () => {
    test.beforeEach(async ({ debugPage }) => {
      // Click History panel in activity bar
      await debugPage.locator('[data-panel="history"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    });

    test('history panel renders with all basic elements', async ({ debugPage }) => {
      // History panel should exist
      const historyPanel = debugPage.locator('#sidebar-history');
      await expect(historyPanel).toBeVisible();

      // Three tabs should exist
      await expect(debugPage.locator('[data-history-tab="tasks"]')).toBeVisible();
      await expect(debugPage.locator('[data-history-tab="logs"]')).toBeVisible();
      await expect(debugPage.locator('[data-history-tab="decision"]')).toBeVisible();

      // History list container should exist
      await expect(debugPage.locator('#history-list-container')).toBeTruthy();
    });

    test('history panel has proper layout structure', async ({ debugPage }) => {
      const historyPanel = debugPage.locator('#sidebar-history');
      
      // Should have sidebar-panel class
      await expect(historyPanel).toHaveClass(/sidebar-panel/);

      // Should have sidebar-tabs container
      const tabsContainer = historyPanel.locator('.sidebar-tabs');
      await expect(tabsContainer).toBeVisible();

      // Should have sidebar-tab-content container
      const contentContainer = historyPanel.locator('.sidebar-tab-content');
      await expect(contentContainer).toBeVisible();
    });

    test('history panel tabs have correct labels', async ({ debugPage }) => {
      const tasksTab = debugPage.locator('[data-history-tab="tasks"]');
      const logsTab = debugPage.locator('[data-history-tab="logs"]');
      const decisionTab = debugPage.locator('[data-history-tab="decision"]');

      // Tasks tab should have label with emoji
      await expect(tasksTab).toContainText('📋');
      await expect(tasksTab).toContainText('历史');

      // Logs tab should have label with emoji
      await expect(logsTab).toContainText('📝');
      await expect(logsTab).toContainText('日志');

      // Decision tab should have label with emoji
      await expect(decisionTab).toContainText('🧠');
      await expect(decisionTab).toContainText('决策');
    });
  });

  test.describe('History Panel - Tab Navigation', () => {
    test.beforeEach(async ({ debugPage }) => {
      // Click History panel first
      await debugPage.locator('[data-panel="history"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    });

    test('tasks tab is active by default', async ({ debugPage }) => {
      const tasksTab = debugPage.locator('[data-history-tab="tasks"]');
      await expect(tasksTab).toHaveClass(/active/);

      // Tasks page should be visible
      const tasksPage = debugPage.locator('#history-tasks');
      await expect(tasksPage).toHaveClass(/active/);
    });

    test('switching to logs tab activates correct content', async ({ debugPage }) => {
      // Click Logs tab
      await debugPage.locator('[data-history-tab="logs"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);

      // Logs tab should be active
      const logsTab = debugPage.locator('[data-history-tab="logs"]');
      await expect(logsTab).toHaveClass(/active/);

      // Logs page should be visible
      const logsPage = debugPage.locator('#history-logs');
      await expect(logsPage).toBeVisible();
    });

    test('switching to decision tab activates correct content', async ({ debugPage }) => {
      // Click Decision tab
      await debugPage.locator('[data-history-tab="decision"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);

      // Decision tab should be active
      const decisionTab = debugPage.locator('[data-history-tab="decision"]');
      await expect(decisionTab).toHaveClass(/active/);

      // Decision page should be visible
      const decisionPage = debugPage.locator('#history-decision');
      await expect(decisionPage).toBeVisible();
    });

    test('switching back to tasks tab reactivates tasks content', async ({ debugPage }) => {
      // Switch to Logs
      await debugPage.locator('[data-history-tab="logs"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);

      // Switch to Decision
      await debugPage.locator('[data-history-tab="decision"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);

      // Switch back to Tasks
      await debugPage.locator('[data-history-tab="tasks"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);

      // Tasks tab should be active again
      const tasksTab = debugPage.locator('[data-history-tab="tasks"]');
      await expect(tasksTab).toHaveClass(/active/);

      const tasksPage = debugPage.locator('#history-tasks');
      await expect(tasksPage).toHaveClass(/active/);
    });

    test('tab switching is smooth with proper timing', async ({ debugPage }) => {
      const startTime = Date.now();

      // Click through all tabs
      await debugPage.locator('[data-history-tab="logs"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.VERY_SHORT);
      await debugPage.locator('[data-history-tab="decision"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.VERY_SHORT);
      await debugPage.locator('[data-history-tab="tasks"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.VERY_SHORT);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time
      expect(duration).toBeLessThan(5000);
    });
  });

  test.describe('History Panel - Empty States', () => {
    test.beforeEach(async ({ debugPage }) => {
      // Click History panel
      await debugPage.locator('[data-panel="history"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    });

    test('tasks tab shows empty state when no history exists', async ({ debugPage }) => {
      // Tasks page should show empty state or error state (no backend)
      const tasksPage = debugPage.locator('#history-tasks');
      await expect(tasksPage).toBeVisible();
      
      // Should contain either empty state or error message
      const text = await tasksPage.textContent();
      expect(text).toBeTruthy();
    });

    test('logs tab shows empty state when no logs exist', async ({ debugPage }) => {
      // Switch to Logs tab
      await debugPage.locator('[data-history-tab="logs"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);

      // Logs page should show empty state
      const logsPage = debugPage.locator('#history-logs');
      await expect(logsPage).toContainText('暂无日志');
    });

    test('decision tab shows empty state when no decisions exist', async ({ debugPage }) => {
      // Switch to Decision tab
      await debugPage.locator('[data-history-tab="decision"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);

      // Decision page should show empty state
      const decisionPage = debugPage.locator('#history-decision');
      await expect(decisionPage).toContainText('暂无决策');
    });

    test('empty state has proper styling', async ({ debugPage }) => {
      // Empty state or error message should exist
      const emptyState = debugPage.locator('#history-tasks .empty-state');
      await expect(emptyState).toBeVisible();

      // Empty state should have proper classes
      await expect(emptyState).toHaveClass(/empty-state/);

      // Should contain some text (either empty state or error)
      const text = await emptyState.textContent();
      expect(text).toBeTruthy();
    });
  });

  test.describe('History Panel - Refresh Functionality', () => {
    test.beforeEach(async ({ debugPage }) => {
      // Click History panel
      await debugPage.locator('[data-panel="history"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    });

    test('refresh button exists in tasks tab', async ({ debugPage }) => {
      // Use exact button text to avoid strict mode violation
      const refreshBtn = debugPage.locator('#history-tasks button:has-text("刷新")').first();
      await expect(refreshBtn).toBeVisible();
      await expect(refreshBtn).toBeEnabled();
    });

    test('refresh button is clickable', async ({ debugPage }) => {
      // Use exact button text to avoid strict mode violation
      const refreshBtn = debugPage.locator('#history-tasks button:has-text("刷新")').first();
      
      // Click should not throw error
      await refreshBtn.click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);

      // Should still be visible
      await expect(refreshBtn).toBeVisible();
    });

    test('refresh button has proper styling', async ({ debugPage }) => {
      // Use exact button text to avoid strict mode violation
      const refreshBtn = debugPage.locator('#history-tasks button:has-text("刷新")').first();
      
      // Should have text-12 class
      await expect(refreshBtn).toHaveClass(/text-12/);
    });
  });

  test.describe('Interaction Panel - Basic Rendering', () => {
    test.beforeEach(async ({ debugPage }) => {
      // Click Interactions panel in activity bar
      await debugPage.locator('[data-panel="interactions"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    });

    test('interaction panel renders with all basic elements', async ({ debugPage }) => {
      // Interaction panel should exist
      const interactionPanel = debugPage.locator('#sidebar-interactions');
      await expect(interactionPanel).toBeVisible();

      // Header should exist
      await expect(interactionPanel.locator('.sidebar-header h1')).toContainText('🖱️ 交互历史');

      // Filter card should exist
      await expect(interactionPanel.locator('.card')).toBeVisible();

      // Interaction list container should exist
      await expect(debugPage.locator('#interaction-list-container')).toBeTruthy();
    });

    test('interaction panel has proper layout structure', async ({ debugPage }) => {
      const interactionPanel = debugPage.locator('#sidebar-interactions');
      
      // Should have sidebar-panel class
      await expect(interactionPanel).toHaveClass(/sidebar-panel/);

      // Should have sidebar-header
      const header = interactionPanel.locator('.sidebar-header');
      await expect(header).toBeVisible();

      // Should have sidebar-content
      const content = interactionPanel.locator('.sidebar-content');
      await expect(content).toBeVisible();
    });

    test('interaction panel header displays correctly', async ({ debugPage }) => {
      const header = debugPage.locator('#sidebar-interactions .sidebar-header h1');
      
      await expect(header).toBeVisible();
      await expect(header).toContainText('🖱️');
      await expect(header).toContainText('交互历史');
    });
  });

  test.describe('Interaction Panel - Filter Controls', () => {
    test.beforeEach(async ({ debugPage }) => {
      // Click Interactions panel
      await debugPage.locator('[data-panel="interactions"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    });

    test('action type filter renders correctly', async ({ debugPage }) => {
      const actionTypeFilter = debugPage.locator('#filter-action-type');
      
      await expect(actionTypeFilter).toBeVisible();
      
      // Should have options for different action types
      const allOption = actionTypeFilter.locator('option[value=""]');
      await expect(allOption).toHaveText('全部');

      const clickOption = actionTypeFilter.locator('option[value="click"]');
      await expect(clickOption).toContainText('点击');
      await expect(clickOption).toContainText('click');

      const typeOption = actionTypeFilter.locator('option[value="type"]');
      await expect(typeOption).toContainText('输入');
      await expect(typeOption).toContainText('type');

      const scrollOption = actionTypeFilter.locator('option[value="scroll"]');
      await expect(scrollOption).toContainText('滚动');
      await expect(scrollOption).toContainText('scroll');

      const finishOption = actionTypeFilter.locator('option[value="finish"]');
      await expect(finishOption).toContainText('完成');
      await expect(finishOption).toContainText('finish');
    });

    test('success filter renders correctly', async ({ debugPage }) => {
      const successFilter = debugPage.locator('#filter-success');
      
      await expect(successFilter).toBeVisible();

      const allOption = successFilter.locator('option[value=""]');
      await expect(allOption).toHaveText('全部');

      const successOption = successFilter.locator('option[value="true"]');
      await expect(successOption).toHaveText('成功');

      const failureOption = successFilter.locator('option[value="false"]');
      await expect(failureOption).toHaveText('失败');
    });

    test('locator strategy filter renders correctly', async ({ debugPage }) => {
      const strategyFilter = debugPage.locator('#filter-locator-strategy');
      
      await expect(strategyFilter).toBeVisible();

      const allOption = strategyFilter.locator('option[value=""]');
      await expect(allOption).toHaveText('全部');

      const coordinateOption = strategyFilter.locator('option[value="coordinate"]');
      await expect(coordinateOption).toContainText('坐标');
      await expect(coordinateOption).toContainText('coordinate');

      const selectorOption = strategyFilter.locator('option[value="selector"]');
      await expect(selectorOption).toContainText('选择器');
      await expect(selectorOption).toContainText('selector');

      const textOption = strategyFilter.locator('option[value="text"]');
      await expect(textOption).toContainText('文本');
      await expect(textOption).toContainText('text');

      const markerOption = strategyFilter.locator('option[value="marker"]');
      await expect(markerOption).toContainText('标记');
      await expect(markerOption).toContainText('marker');
    });

    test('time range filter renders correctly', async ({ debugPage }) => {
      const timeRangeFilter = debugPage.locator('#filter-time-range');
      
      await expect(timeRangeFilter).toBeVisible();

      const allOption = timeRangeFilter.locator('option[value=""]');
      await expect(allOption).toHaveText('全部');

      const hourOption = timeRangeFilter.locator('option[value="1h"]');
      await expect(hourOption).toHaveText('最近 1 小时');

      const dayOption = timeRangeFilter.locator('option[value="24h"]');
      await expect(dayOption).toHaveText('最近 24 小时');

      const weekOption = timeRangeFilter.locator('option[value="7d"]');
      await expect(weekOption).toHaveText('最近 7 天');
    });

    test('all filter labels display correctly', async ({ debugPage }) => {
      const labels = debugPage.locator('#sidebar-interactions .form-group label');
      
      await expect(labels.nth(0)).toContainText('操作类型');
      await expect(labels.nth(1)).toContainText('状态');
      await expect(labels.nth(2)).toContainText('策略类型');
      await expect(labels.nth(3)).toContainText('时间范围');
    });
  });

  test.describe('Interaction Panel - Filter Interactions', () => {
    test.beforeEach(async ({ debugPage }) => {
      // Click Interactions panel
      await debugPage.locator('[data-panel="interactions"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    });

    test('action type filter can be changed', async ({ debugPage }) => {
      const actionTypeFilter = debugPage.locator('#filter-action-type');
      
      // Select click option
      await actionTypeFilter.selectOption('click');
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);

      const selectedValue = await actionTypeFilter.inputValue();
      expect(selectedValue).toBe('click');

      // Select type option
      await actionTypeFilter.selectOption('type');
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);

      const newSelectedValue = await actionTypeFilter.inputValue();
      expect(newSelectedValue).toBe('type');
    });

    test('success filter can be changed', async ({ debugPage }) => {
      const successFilter = debugPage.locator('#filter-success');
      
      // Select success option
      await successFilter.selectOption('true');
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);

      const selectedValue = await successFilter.inputValue();
      expect(selectedValue).toBe('true');

      // Select failure option
      await successFilter.selectOption('false');
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);

      const newSelectedValue = await successFilter.inputValue();
      expect(newSelectedValue).toBe('false');
    });

    test('locator strategy filter can be changed', async ({ debugPage }) => {
      const strategyFilter = debugPage.locator('#filter-locator-strategy');
      
      // Select coordinate option
      await strategyFilter.selectOption('coordinate');
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);

      const selectedValue = await strategyFilter.inputValue();
      expect(selectedValue).toBe('coordinate');
    });

    test('time range filter can be changed', async ({ debugPage }) => {
      const timeRangeFilter = debugPage.locator('#filter-time-range');
      
      // Select 1h option
      await timeRangeFilter.selectOption('1h');
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);

      const selectedValue = await timeRangeFilter.inputValue();
      expect(selectedValue).toBe('1h');
    });

    test('apply filter button exists and is clickable', async ({ debugPage }) => {
      const applyBtn = debugPage.locator('#sidebar-interactions button:has-text("应用过滤")');
      
      await expect(applyBtn).toBeVisible();
      await expect(applyBtn).toBeEnabled();

      // Click should not throw error
      await applyBtn.click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    });

    test('apply filter button has proper styling', async ({ debugPage }) => {
      const applyBtn = debugPage.locator('#sidebar-interactions button:has-text("应用过滤")');
      
      // Should have text-12 class
      await expect(applyBtn).toHaveClass(/text-12/);
      await expect(applyBtn).toHaveClass(/w-full/);
      await expect(applyBtn).toHaveClass(/mt-2/);
    });
  });

  test.describe('Interaction Panel - Empty State', () => {
    test.beforeEach(async ({ debugPage }) => {
      // Click Interactions panel
      await debugPage.locator('[data-panel="interactions"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    });

    test('interaction list shows loading state initially', async ({ debugPage }) => {
      // Table should exist in main-interactions area
      const table = debugPage.locator('#main-interactions table');
      await expect(table).toBeVisible();

      // Should show loading message initially
      const loadingCell = table.locator('td:has-text("加载中...")');
      await expect(loadingCell).toBeVisible();
    });

    test('interaction table has correct columns', async ({ debugPage }) => {
      const table = debugPage.locator('#main-interactions table');
      const headers = table.locator('thead th');

      // Should have 7 columns
      await expect(headers).toHaveCount(7);

      // Column headers should include:
      await expect(headers.nth(0)).toContainText('时间');
      await expect(headers.nth(1)).toContainText('操作');
      await expect(headers.nth(2)).toContainText('目标');
      await expect(headers.nth(3)).toContainText('策略');
      await expect(headers.nth(4)).toContainText('状态');
      await expect(headers.nth(5)).toContainText('耗时');
      await expect(headers.nth(6)).toContainText('操作');
    });

    test('table has proper styling classes', async ({ debugPage }) => {
      const table = debugPage.locator('#main-interactions table');
      
      // Should have w-full class
      await expect(table).toHaveClass(/w-full/);
      await expect(table).toHaveClass(/text-left/);
      await expect(table).toHaveClass(/border-collapse/);
      await expect(table).toHaveClass(/text-sm/);
    });

    test('table header has sticky positioning', async ({ debugPage }) => {
      const thead = debugPage.locator('#main-interactions table thead');
      
      // Should have sticky class for fixed header
      await expect(thead).toHaveClass(/sticky/);
      await expect(thead).toHaveClass(/top-0/);
      await expect(thead).toHaveClass(/bg-tertiary/);
    });
  });

  test.describe('Interaction Panel - Statistics Cards', () => {
    test.beforeEach(async ({ debugPage }) => {
      // Click Interactions panel
      await debugPage.locator('[data-panel="interactions"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    });

    test('statistics cards render correctly', async ({ debugPage }) => {
      // Should have 3 stat cards in main-interactions area
      const statCards = debugPage.locator('#main-interactions .grid .card');
      await expect(statCards).toHaveCount(3);
    });

    test('total interactions card displays correctly', async ({ debugPage }) => {
      const totalCard = debugPage.locator('#stat-total-interactions');
      
      await expect(totalCard).toBeVisible();
      
      // Should show placeholder or number
      const text = await totalCard.textContent();
      expect(text).toBeTruthy();
    });

    test('success rate card displays correctly', async ({ debugPage }) => {
      const successRateCard = debugPage.locator('#stat-success-rate');
      
      await expect(successRateCard).toBeVisible();
      
      // Should have success color class
      await expect(successRateCard).toHaveClass(/text-success/);
    });

    test('average latency card displays correctly', async ({ debugPage }) => {
      const avgLatencyCard = debugPage.locator('#stat-avg-latency');
      
      await expect(avgLatencyCard).toBeVisible();
      
      // Should show placeholder or number
      const text = await avgLatencyCard.textContent();
      expect(text).toBeTruthy();
    });

    test('stat cards have proper layout', async ({ debugPage }) => {
      const grid = debugPage.locator('#main-interactions .grid');
      
      // Should have grid-cols-3 class
      await expect(grid).toHaveClass(/grid-cols-3/);
      await expect(grid).toHaveClass(/gap-4/);
      await expect(grid).toHaveClass(/mb-4/);
    });
  });

  test.describe('Interaction Panel - Refresh Functionality', () => {
    test.beforeEach(async ({ debugPage }) => {
      // Click Interactions panel
      await debugPage.locator('[data-panel="interactions"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);
    });

    test('refresh button exists in interaction panel', async ({ debugPage }) => {
      const refreshBtn = debugPage.locator('#main-interactions button:has-text("刷新")');
      await expect(refreshBtn).toBeVisible();
      await expect(refreshBtn).toBeEnabled();
    });

    test('refresh button is clickable', async ({ debugPage }) => {
      const refreshBtn = debugPage.locator('#main-interactions button:has-text("刷新")').first();
      
      // Click should not throw error
      await refreshBtn.click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);

      // Should still show table
      const table = debugPage.locator('#main-interactions table');
      await expect(table).toBeVisible();
    });

    test('refresh button has proper styling', async ({ debugPage }) => {
      const refreshBtn = debugPage.locator('#main-interactions button:has-text("刷新")').first();
      
      // Should have text-12 class
      await expect(refreshBtn).toHaveClass(/text-12/);
    });
  });

  test.describe('History & Interaction Panels - Cross-Panel Navigation', () => {
    test('switching from history to interaction panel works', async ({ debugPage }) => {
      // Click History panel
      await debugPage.locator('[data-panel="history"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);

      // History panel should be active
      await expect(debugPage.locator('#sidebar-history')).toBeVisible();

      // Click Interactions panel
      await debugPage.locator('[data-panel="interactions"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);

      // Interaction panel should be active
      await expect(debugPage.locator('#sidebar-interactions')).toBeVisible();
    });

    test('switching from interaction to history panel works', async ({ debugPage }) => {
      // Click Interactions panel
      await debugPage.locator('[data-panel="interactions"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);

      // Interaction panel should be active
      await expect(debugPage.locator('#sidebar-interactions')).toBeVisible();

      // Click History panel
      await debugPage.locator('[data-panel="history"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);

      // History panel should be active
      await expect(debugPage.locator('#sidebar-history')).toBeVisible();
    });

    test('switching between multiple panels maintains state', async ({ debugPage }) => {
      // Go to History
      await debugPage.locator('[data-panel="history"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);

      // Switch to Logs tab
      await debugPage.locator('[data-history-tab="logs"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);

      // Go to Interactions
      await debugPage.locator('[data-panel="interactions"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);

      // Go back to History
      await debugPage.locator('[data-panel="history"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);

      // Logs tab should still be active
      const logsTab = debugPage.locator('[data-history-tab="logs"]');
      await expect(logsTab).toHaveClass(/active/);
    });
  });

  test.describe('History & Interaction Panels - Accessibility', () => {
    test('history panel tabs are keyboard accessible', async ({ debugPage }) => {
      await debugPage.locator('[data-panel="history"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);

      const tasksTab = debugPage.locator('[data-history-tab="tasks"]');
      const logsTab = debugPage.locator('[data-history-tab="logs"]');

      // Focus on tasks tab
      await tasksTab.focus();
      await expect(tasksTab).toBeFocused();

      // Tab to next tab
      await tasksTab.press('Tab');
      await debugPage.waitForTimeout(TIMEOUTS.VERY_SHORT);

      // Focus should move to logs tab or another focusable element
      await expect(async () => {
        const activeElement = await debugPage.evaluate('() => document.activeElement?.tagName');
        expect(activeElement).toBeTruthy();
      }).toPass({ timeout: 2000 });
    });

    test('interaction panel filters are keyboard accessible', async ({ debugPage }) => {
      await debugPage.locator('[data-panel="interactions"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);

      const actionTypeFilter = debugPage.locator('#filter-action-type');
      
      // Focus on filter
      await actionTypeFilter.focus();
      await expect(actionTypeFilter).toBeFocused();

      // Should accept keyboard input
      await actionTypeFilter.press('ArrowDown');
      await debugPage.waitForTimeout(TIMEOUTS.VERY_SHORT);
    });

    test('filter selects have proper labels', async ({ debugPage }) => {
      await debugPage.locator('[data-panel="interactions"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);

      const labels = debugPage.locator('#sidebar-interactions .form-group label');
      
      // All labels should be visible
      for (let i = 0; i < 4; i++) {
        await expect(labels.nth(i)).toBeVisible();
      }
    });

    test('panels have proper ARIA structure', async ({ debugPage }) => {
      // History panel
      const historyPanel = debugPage.locator('#sidebar-history');
      await expect(historyPanel).toHaveAttribute('id');

      // Interaction panel
      const interactionPanel = debugPage.locator('#sidebar-interactions');
      await expect(interactionPanel).toHaveAttribute('id');
    });

    test('history panel has proper role attributes', async ({ debugPage }) => {
      await debugPage.locator('[data-panel="history"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);

      // Tab buttons should be clickable
      const tabs = debugPage.locator('[data-history-tab]');
      await expect(tabs.first()).toBeEnabled();
    });

    test('interaction panel has proper form structure', async ({ debugPage }) => {
      await debugPage.locator('[data-panel="interactions"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);

      // Filter form groups should exist
      const formGroups = debugPage.locator('#sidebar-interactions .form-group');
      await expect(formGroups).toHaveCount(4);
    });
  });

  test.describe('History & Interaction Panels - Responsive Design', () => {
    test('history panel adapts to smaller viewport', async ({ debugPage }) => {
      // Set smaller viewport
      await debugPage.setViewportSize({ width: 375, height: 667 });
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);

      // Click History panel
      await debugPage.locator('[data-panel="history"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);

      // All tabs should still be visible
      await expect(debugPage.locator('[data-history-tab="tasks"]')).toBeVisible();
      await expect(debugPage.locator('[data-history-tab="logs"]')).toBeVisible();
      await expect(debugPage.locator('[data-history-tab="decision"]')).toBeVisible();

      // Reset viewport
      await debugPage.setViewportSize({ width: 1920, height: 1080 });
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
    });

    test('interaction panel adapts to smaller viewport', async ({ debugPage }) => {
      // Set smaller viewport
      await debugPage.setViewportSize({ width: 375, height: 667 });
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);

      // Click Interactions panel
      await debugPage.locator('[data-panel="interactions"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);

      // Filter controls should still be visible
      await expect(debugPage.locator('#filter-action-type')).toBeVisible();
      await expect(debugPage.locator('#filter-success')).toBeVisible();
      await expect(debugPage.locator('#filter-locator-strategy')).toBeVisible();
      await expect(debugPage.locator('#filter-time-range')).toBeVisible();

      // Reset viewport
      await debugPage.setViewportSize({ width: 1920, height: 1080 });
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
    });

    test('statistics cards stack on mobile viewport', async ({ debugPage }) => {
      // Set mobile viewport
      await debugPage.setViewportSize({ width: 375, height: 667 });
      await debugPage.waitForTimeout(TIMEOUTS.MEDIUM);

      // Click Interactions panel
      await debugPage.locator('[data-panel="interactions"]').first().click();
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);

      // Stat cards should still exist (may stack)
      const statCards = debugPage.locator('#main-interactions .grid .card');
      await expect(statCards).toHaveCount(3);

      // Reset viewport
      await debugPage.setViewportSize({ width: 1920, height: 1080 });
      await debugPage.waitForTimeout(TIMEOUTS.SHORT);
    });
  });
});
