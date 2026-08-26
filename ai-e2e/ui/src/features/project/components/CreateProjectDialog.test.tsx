import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CreateProjectDialog } from './CreateProjectDialog.js';

const mutate = vi.fn(
  (
    _input: unknown,
    options: { onSuccess: (workspace: { id: string; versionId: string }) => void }
  ) => options.onSuccess({ id: 'project-1', versionId: 'version-1' })
);

vi.mock('../store/projectApi.js', () => ({
  useCreateProject: () => ({ mutate, isPending: false }),
}));

function CurrentLocation() {
  return <output data-testid="location">{useLocation().pathname + useLocation().search}</output>;
}

describe('CreateProjectDialog', () => {
  it('keeps the user-provided entry path in the authoring deep link', () => {
    render(
      <MemoryRouter>
        <CreateProjectDialog isOpen onClose={vi.fn()} />
        <CurrentLocation />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: 'debug-ui' } });
    fireEvent.change(screen.getByLabelText('目标站点'), {
      target: { value: 'http://127.0.0.1:5173/debug/' },
    });
    fireEvent.change(screen.getByLabelText('PRD / 验收需求'), {
      target: { value: '# debug-ui' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建并开始编排' }));

    expect(screen.getByTestId('location')).toHaveTextContent(
      'url=http%3A%2F%2F127.0.0.1%3A5173%2Fdebug%2F'
    );
  });
});
