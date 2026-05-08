import { HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Routes } from './app/routes.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Routes />
      </HashRouter>
    </QueryClientProvider>
  );
}
