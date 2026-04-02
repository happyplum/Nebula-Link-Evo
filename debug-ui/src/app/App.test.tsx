import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from './router.js';
import { testIds } from '@/shared/testing/testids.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

describe('AppRoutes', () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  beforeAll(() => {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  afterAll(() => {
    delete (global as any).ResizeObserver;
  });

  it('renders DebugPage on "/" route', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(screen.getByTestId(testIds.debugShell)).toBeInTheDocument();
  });

  it('renders ChatPage on "/chat" route', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/chat']}>
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(screen.getByTestId(testIds.chatPageRoot)).toBeInTheDocument();
  });
});
