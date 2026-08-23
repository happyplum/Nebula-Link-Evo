import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewWorkbench } from './PreviewWorkbench.js';

function renderAuthoring(initialEntry = '/__preview/authoring') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/__preview/authoring" element={<PreviewWorkbench mode="authoring" />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderRun(runId = 'run-live') {
  return render(
    <MemoryRouter initialEntries={[`/__preview/runs/${runId}`]}>
      <Routes>
        <Route path="/__preview/runs/:runId" element={<PreviewWorkbench mode="run" />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('PreviewWorkbench', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the browser mounted and does not navigate when context changes', () => {
    renderAuthoring();
    const browser = screen.getByTestId('preview-browser-stage');
    const originalMountId = browser.getAttribute('data-mount-id');
    expect(screen.getByTestId('browser-url')).toHaveTextContent('/checkout/cart_8A21');

    fireEvent.change(screen.getByLabelText('当前页面'), { target: { value: 'page-account' } });

    expect(screen.getByTestId('preview-browser-stage')).toBe(browser);
    expect(screen.getByTestId('preview-browser-stage')).toHaveAttribute(
      'data-mount-id',
      originalMountId
    );
    expect(screen.getByTestId('browser-url')).toHaveTextContent('/checkout/cart_8A21');

    fireEvent.click(screen.getByRole('button', { name: '在浏览器中定位' }));
    expect(screen.getByTestId('browser-url')).toHaveTextContent('/account/login');
  });

  it('supports keyboard resizing, reset, and persisted layout preferences', () => {
    renderAuthoring();
    const splitter = screen.getByRole('separator', { name: '左侧上下文宽度调整' });
    expect(splitter).toHaveAttribute('aria-valuenow', '276');

    fireEvent.keyDown(splitter, { key: 'ArrowRight' });
    expect(splitter).toHaveAttribute('aria-valuenow', '292');
    expect(JSON.parse(window.localStorage.getItem('ai-e2e.preview.layout') || '{}')).toMatchObject({
      leftWidth: 292,
    });

    fireEvent.doubleClick(splitter);
    expect(splitter).toHaveAttribute('aria-valuenow', '276');
  });

  it('supports pointer resizing while preserving the minimum browser width', () => {
    renderAuthoring();
    const splitter = screen.getByRole('separator', { name: '左侧上下文宽度调整' });
    const grid = splitter.parentElement as HTMLDivElement;
    Object.defineProperty(grid, 'getBoundingClientRect', {
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 1400,
        bottom: 800,
        width: 1400,
        height: 800,
        toJSON: () => undefined,
      }),
    });

    fireEvent.pointerDown(splitter, { clientX: 276 });
    fireEvent.pointerMove(window, { clientX: 360 });
    fireEvent.pointerUp(window);

    expect(splitter).toHaveAttribute('aria-valuenow', '360');
  });

  it('creates a candidate immediately without activating current assets', () => {
    renderAuthoring();
    fireEvent.click(screen.getByRole('button', { name: '一键重新编排' }));

    expect(screen.getByText('结构化候选')).toBeInTheDocument();
    expect(screen.getByText('candidate_ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /在安全边界应用/ })).toBeEnabled();
    expect(screen.queryByText('候选已激活')).not.toBeInTheDocument();
  });

  it('marks a pending candidate stale after switching modules', () => {
    renderAuthoring();
    fireEvent.click(screen.getByRole('button', { name: '一键重新编排' }));
    fireEvent.change(screen.getByLabelText('当前模块'), { target: { value: 'module-address' } });

    expect(screen.getByText('stale')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /上下文已变化，候选过期/ })).toBeDisabled();
  });

  it('turns same-page foreign module and cross-URL chat requests into decisions', () => {
    const { unmount } = renderAuthoring();
    fireEvent.click(screen.getByRole('button', { name: '涉及其他模块' }));
    expect(screen.getByText('同页其他模块资产')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /批准范围/ })).toBeInTheDocument();

    unmount();
    renderAuthoring();
    fireEvent.click(screen.getByRole('button', { name: '跨 URL 恢复' }));
    expect(screen.getByText('跨 URL 范围扩展')).toBeInTheDocument();
    expect(
      screen.getByText(/https:\/\/staging\.shop\.example\/checkout.*account\/login/)
    ).toBeInTheDocument();
    expect(screen.getByText(/module-session@req-r7/)).toBeInTheDocument();
  });

  it('keeps current assets unchanged when candidate verification fails', () => {
    renderAuthoring();
    fireEvent.click(screen.getByRole('button', { name: '一键重新编排' }));
    fireEvent.click(screen.getByRole('button', { name: '模拟验证失败' }));

    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '验证失败，current 未变' })).toBeDisabled();
    expect(
      screen.getByText('候选未通过真实浏览器验证，current 修订保持不变。')
    ).toBeInTheDocument();
  });

  it('activates a verified candidate after explicit confirmation', () => {
    vi.useFakeTimers();
    renderAuthoring();
    fireEvent.click(screen.getByRole('button', { name: '一键重新编排' }));
    fireEvent.click(screen.getByRole('button', { name: /在安全边界应用/ }));

    expect(screen.getByText('verifying')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(700));
    expect(screen.getByText('activated')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '候选已激活' })).toBeDisabled();
  });

  it('queues an approved amendment while an atomic browser operation is active', () => {
    renderRun();
    fireEvent.click(screen.getByRole('button', { name: '一键重新编排' }));
    fireEvent.click(screen.getByRole('button', { name: /在安全边界应用/ }));

    expect(screen.getByText('queued_at_safe_boundary')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /模拟到达安全边界/ })).toBeInTheDocument();
  });

  it('keeps cancellation distinct from timeout', () => {
    renderRun();
    fireEvent.click(screen.getByRole('button', { name: '取消运行' }));
    expect(screen.getByRole('status')).toHaveTextContent('取消已记录为独立命令');
    expect(screen.getByRole('status')).not.toHaveTextContent('超时');
  });
});
