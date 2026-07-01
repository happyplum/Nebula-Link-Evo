import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AgentEntry } from './AgentEntry.js';

describe('AgentEntry', () => {
  it('renders when inside /project/:projectId route', () => {
    render(
      <MemoryRouter initialEntries={['/project/p1']}>
        <Routes>
          <Route path="/project/:projectId" element={<AgentEntry />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /AI 助手/ })).toBeInTheDocument();
  });

  it('returns null on /', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AgentEntry />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('calls onClick when provided', () => {
    const onClick = vi.fn();
    render(
      <MemoryRouter initialEntries={['/project/p1']}>
        <Routes>
          <Route path="/project/:projectId" element={<AgentEntry onClick={onClick} />} />
        </Routes>
      </MemoryRouter>,
    );
    screen.getByRole('button', { name: /AI 助手/ }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
