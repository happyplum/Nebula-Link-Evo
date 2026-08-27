import { HashRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner.js';
import { Routes } from './app/routes.js';
import { queryClient } from './shared/api/queryClient.js';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Routes />
      </HashRouter>
      <Toaster position="top-right" offset={{ top: '72px', right: '12px' }} richColors />
    </QueryClientProvider>
  );
}
