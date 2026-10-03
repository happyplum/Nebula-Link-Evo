import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Button } from './Button.js';

it('touch 尺寸在公共 owner 提供 44px 热区并保留按钮行为', () => {
  const onClick = vi.fn();
  const { rerender } = render(
    <Button size="touch" variant="secondary" onClick={onClick}>
      立即重连
    </Button>
  );
  const button = screen.getByRole('button', { name: '立即重连' });
  expect(button).toHaveClass('h-11', 'min-w-11');
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
  rerender(
    <Button size="touch" disabled onClick={onClick}>
      立即重连
    </Button>
  );
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
});
