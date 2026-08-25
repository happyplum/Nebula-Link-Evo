import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DebugPage from '../DebugPage.js';
import { testIds } from '@/shared/testing/testids.js';
import fs from 'node:fs';
import path from 'node:path';

// Mock useDebugSession to prevent actual API calls
vi.mock('@/features/runtime/hooks/useDebugSession.js', () => ({
  useDebugSession: vi.fn(() => ({ data: null, isLoading: false, error: null })),
}));

// Mock PlaywrightControlContext provider
vi.mock('@/features/playwright-control/context/PlaywrightControlContext.js', () => ({
  PlaywrightControlProvider: ({ children }: { children: React.ReactNode }) => children,
  usePlaywrightControl: vi.fn(() => ({
    selectedElement: null,
    actions: [],
    setSelectedElement: vi.fn(),
  })),
}));

// Mock useNavigate before importing DebugPage
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock the LiveViewCanvas to avoid canvas rendering issues in JSDOM
vi.mock('@/features/liveview/components/LiveViewCanvas.js', () => ({
  LiveViewCanvas: () => <div data-testid="mock-liveview-canvas">LiveViewCanvas</div>,
}));

describe('DebugPage Shell Parity Test', () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const renderWithProviders = (ui: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    );
  };

  beforeAll(() => {
    // Inject the CSS variables into the jsdom document
    const cssPath = path.resolve(__dirname, '../../../styles/variables.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');

    const styleElement = document.createElement('style');
    styleElement.textContent = cssContent;
    document.head.appendChild(styleElement);
  });

  it('asserts shell uses legacy layout dimensions (56px / 300px / 320px)', () => {
    renderWithProviders(<DebugPage />);

    // Get the shell element
    const shell = screen.getByTestId(testIds.debugShell);
    expect(shell).toBeInTheDocument();

    // Verify CSS is injected into the document
    const styleElements = document.head.querySelectorAll('style');
    expect(styleElements.length).toBeGreaterThan(0);

    // Get computed styles from the documentElement (html) where :root styles are applied
    const computedStyle = window.getComputedStyle(document.documentElement);

    // Verify CSS variable values are resolved
    // Note: In jsdom, CSS variable resolution may be limited, but the values should be present
    // The grid layout in DebugPage.module.css references these variables
    const activityBarWidth = computedStyle.getPropertyValue('--activity-bar-width').trim();
    const sidebarWidth = computedStyle.getPropertyValue('--sidebar-width').trim();
    const rightPanelWidth = computedStyle.getPropertyValue('--right-panel-width').trim();

    // Assert the resolved values match legacy dimensions
    expect(activityBarWidth).toBe('56px');
    expect(sidebarWidth).toBe('300px');
    expect(rightPanelWidth).toBe('320px');
  });
});
