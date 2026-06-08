import { Routes as RouterRoutes, Route } from 'react-router-dom';
import { Layout } from './layout.js';
import { HomePage } from './pages/HomePage.js';
import { ProjectPage } from './pages/ProjectPage.js';

const NotFoundPage = () => (
  <div className="flex h-full items-center justify-center">
    <div className="text-center">
      <h1 className="text-2xl font-semibold text-text-primary">404</h1>
      <p className="text-text-secondary mt-2">页面不存在</p>
    </div>
  </div>
);

export function Routes() {
  return (
    <RouterRoutes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/project/:projectId" element={<ProjectPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </RouterRoutes>
  );
}
