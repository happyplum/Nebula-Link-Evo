import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { BrowserStage } from './BrowserStage.js';

it('zoom 只缩放实际画面，空态和图像失败重试保持原始热区', () => {
  const { container, rerender } = render(
    <BrowserStage url="https://example.test" zoom={90} collapsed={false} browserActive={false} />
  );
  const canvas = container.querySelector('.semantic-browser-canvas');
  expect(canvas).not.toHaveStyle({ transform: 'scale(0.9)' });
  rerender(<BrowserStage url="https://example.test" zoom={90} collapsed={false} browserActive />);
  expect(canvas).not.toHaveStyle({ transform: 'scale(0.9)' });
  expect(screen.getByRole('img', { name: '当前受控浏览器实时画面' })).toHaveStyle({
    transform: 'scale(0.9)',
  });
  fireEvent.error(screen.getByRole('img', { name: '当前受控浏览器实时画面' }));
  expect(canvas).not.toHaveStyle({ transform: 'scale(0.9)' });
  fireEvent.click(screen.getByRole('button', { name: '重试实时画面' }));
  expect(canvas).not.toHaveStyle({ transform: 'scale(0.9)' });
  expect(screen.getByRole('img', { name: '当前受控浏览器实时画面' })).toHaveStyle({
    transform: 'scale(0.9)',
  });
  expect(screen.getByRole('img', { name: '当前受控浏览器实时画面' })).toBeInTheDocument();
});
