import { HashRouter } from 'react-router-dom';
import { AppRoutes } from './router.js';
import { QueryProvider } from '@/shared/query/QueryProvider.js';

export default function App() {
  // HashRouter doesn't need the /debug basename for the hash itself,
  // as the pathname /debug/ is handled by the browser before the hash.
  return (
    <QueryProvider>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </QueryProvider>
  );
}
