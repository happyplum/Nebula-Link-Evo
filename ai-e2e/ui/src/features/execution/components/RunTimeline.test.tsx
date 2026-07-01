import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunTimeline, type RunTimelineStep } from './RunTimeline.js';

const steps: RunTimelineStep[] = [
  { id: 's1', label: '开始执行', status: 'completed', durationMs: 12 },
  { id: 's2', label: '初始化浏览器', status: 'running' },
  { id: 's3', label: '执行登录脚本', status: 'failed', detail: 'timeout' },
  { id: 's4', label: '清理资源', status: 'pending' },
];

describe('RunTimeline', () => {
  it('renders every step label', () => {
    render(<RunTimeline steps={steps} />);
    expect(screen.getByText('开始执行')).toBeInTheDocument();
    expect(screen.getByText('初始化浏览器')).toBeInTheDocument();
    expect(screen.getByText('执行登录脚本')).toBeInTheDocument();
    expect(screen.getByText('清理资源')).toBeInTheDocument();
  });

  it('renders detail text for steps that have it', () => {
    render(<RunTimeline steps={steps} />);
    expect(screen.getByText('timeout')).toBeInTheDocument();
  });

  it('renders duration when provided', () => {
    render(<RunTimeline steps={steps} />);
    expect(screen.getByText('12ms')).toBeInTheDocument();
  });

  it('renders an empty container when there are no steps', () => {
    const { container } = render(<RunTimeline steps={[]} />);
    // No step labels rendered.
    expect(container.textContent).toBe('');
  });

  it('shows a spinner icon (animate-spin) for the running step', () => {
    const { container } = render(<RunTimeline steps={steps} />);
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).not.toBeNull();
  });

  it('renders the pending step index (4th step => "4")', () => {
    render(<RunTimeline steps={steps} />);
    expect(screen.getByText('4')).toBeInTheDocument();
  });
});
