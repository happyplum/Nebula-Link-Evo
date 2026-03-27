/**
 * Tests for ui.ts - Debug UI frontend functions
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  showNotification,
  showError,
  showSuccess,
  showWarning,
  updateStatus,
  appendLog,
  updateDecisions,
  addAICallLog,
} from '../ui.js';

// Mock scrollIntoView - jsdom doesn't implement this
Element.prototype.scrollIntoView = vi.fn();

describe('showNotification', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="notificationContainer"></div>';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('should create notification element', () => {
    showNotification('success', 'Test message');
    const container = document.getElementById('notificationContainer');
    expect(container?.children.length).toBe(1);
    expect(container?.children[0].className).toContain('success');
  });

  it('should include correct icon for error', () => {
    showNotification('error', 'Error message');
    const container = document.getElementById('notificationContainer');
    expect(container?.innerHTML).toContain('❌');
  });

  it('should include correct icon for success', () => {
    showNotification('success', 'Success message');
    const container = document.getElementById('notificationContainer');
    expect(container?.innerHTML).toContain('✅');
  });

  it('should include correct icon for warning', () => {
    showNotification('warning', 'Warning message');
    const container = document.getElementById('notificationContainer');
    expect(container?.innerHTML).toContain('⚠️');
  });

  it('should auto-remove after duration', () => {
    showNotification('success', 'Test', 1000);
    const container = document.getElementById('notificationContainer');
    expect(container?.children.length).toBe(1);

    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(300);
    expect(container?.children.length).toBe(0);
  });

  it('should not auto-remove when duration is 0', () => {
    showNotification('success', 'Test', 0);
    const container = document.getElementById('notificationContainer');
    expect(container?.children.length).toBe(1);

    vi.advanceTimersByTime(10000);
    expect(container?.children.length).toBe(1);
  });
});

describe('showError', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="notificationContainer"></div>';
  });

  it('should call showNotification with error type', () => {
    showError('Error test');
    const container = document.getElementById('notificationContainer');
    expect(container?.children[0].className).toContain('error');
  });
});

describe('showSuccess', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="notificationContainer"></div>';
  });

  it('should call showNotification with success type', () => {
    showSuccess('Success test');
    const container = document.getElementById('notificationContainer');
    expect(container?.children[0].className).toContain('success');
  });
});

describe('showWarning', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="notificationContainer"></div>';
  });

  it('should call showNotification with warning type', () => {
    showWarning('Warning test');
    const container = document.getElementById('notificationContainer');
    expect(container?.children[0].className).toContain('warning');
  });
});

describe('updateStatus', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="statusIndicator"></div>
      <div id="statusText"></div>
      <div id="connectionStatusBadge"></div>
      <div id="connectionStatus"></div>
    `;
  });

  it('should set online class when connected', () => {
    updateStatus(true, 'healthy', 'Online');
    const indicator = document.getElementById('statusIndicator');
    expect(indicator?.classList.contains('online')).toBe(true);
    expect(indicator?.classList.contains('offline')).toBe(false);
  });

  it('should set offline class when disconnected', () => {
    updateStatus(false, 'unhealthy', 'Offline');
    const indicator = document.getElementById('statusIndicator');
    expect(indicator?.classList.contains('offline')).toBe(true);
    expect(indicator?.classList.contains('online')).toBe(false);
  });

  it('should update status text', () => {
    updateStatus(true, 'healthy', 'Custom message');
    const text = document.getElementById('statusText');
    expect(text?.textContent).toBe('Custom message');
  });

  it('should show default text when no message provided', () => {
    updateStatus(true, 'healthy', '');
    const text = document.getElementById('statusText');
    expect(text?.textContent).toBe('在线');
  });
});

describe('appendLog', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="logDisplay"><div class="empty-state">Empty</div></div>';
  });

  it('should append log entry', () => {
    appendLog('info', 'Test log message');
    const display = document.getElementById('logDisplay');
    expect(display?.querySelector('.log-entry')).not.toBeNull();
  });

  it('should remove empty state', () => {
    appendLog('info', 'Test');
    const display = document.getElementById('logDisplay');
    expect(display?.querySelector('.empty-state')).toBeNull();
  });

  it('should include log type in class', () => {
    appendLog('error', 'Error log');
    const entry = document.querySelector('.log-entry');
    expect(entry?.classList.contains('error')).toBe(true);
  });
});

describe('updateDecisions', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="decisionDisplay"></div>';
  });

  it('should display object as JSON', () => {
    updateDecisions({ action: 'click', target: 'button' });
    const display = document.getElementById('decisionDisplay');
    expect(display?.textContent).toContain('click');
    expect(display?.textContent).toContain('button');
  });

  it('should display string directly', () => {
    updateDecisions('Simple decision');
    const display = document.getElementById('decisionDisplay');
    expect(display?.textContent).toContain('Simple decision');
  });

  it('should show empty state when null', () => {
    updateDecisions(null);
    const display = document.getElementById('decisionDisplay');
    expect(display?.textContent).toContain('暂无决策');
  });
});

describe('addAICallLog', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="fullLogDisplay"></div>';
  });

  it('should add log to display', () => {
    addAICallLog({
      type: 'decision',
      modelType: 'vision',
      provider: 'anthropic',
      model: 'claude-3',
      success: true,
    });
    const display = document.getElementById('fullLogDisplay');
    expect(display?.innerHTML).toContain('decision');
    expect(display?.innerHTML).toContain('vision');
  });

  it('should limit logs to 50 entries', () => {
    for (let i = 0; i < 60; i++) {
      addAICallLog({
        type: `type-${i}`,
        modelType: 'vision',
        provider: 'test',
        model: 'test-model',
        success: true,
      });
    }
    const display = document.getElementById('fullLogDisplay');
    // Should only contain 50 logs
    const items = display?.querySelectorAll('.ai-log-item');
    expect(items?.length).toBe(50);
  });
});