import { Routes as RouterRoutes, Route } from 'react-router-dom';
import { Layout } from './layout.js';
import { HomePage } from './pages/HomePage.js';
import { SemanticHomePage } from '../features/semantic/SemanticHomePage.js';
import { SemanticAuthoringPage, SemanticRunPage } from '../features/semantic/SemanticWorkbench.js';

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
      <Route path="/semantic/:projectId/authoring/:versionId" element={<SemanticAuthoringPage />} />
      <Route path="/semantic/:projectId/runs/:runId" element={<SemanticRunPage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/semantic/:projectId" element={<SemanticHomePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </RouterRoutes>
  );
}
