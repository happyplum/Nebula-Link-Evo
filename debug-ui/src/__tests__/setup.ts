import '@testing-library/jest-dom';

// Mock ResizeObserver for components that use it (e.g., LiveKitView)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
