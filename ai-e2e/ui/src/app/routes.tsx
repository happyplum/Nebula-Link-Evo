import { lazy, Suspense } from 'react';
import { Routes as RouterRoutes, Route } from 'react-router-dom';
import { Layout } from './layout.js';
import { HomePage } from './pages/HomePage.js';
import { ProjectPage } from './pages/ProjectPage.js';
import { SemanticHomePage } from '../features/semantic/SemanticHomePage.js';
import { SemanticAuthoringPage, SemanticRunPage } from '../features/semantic/SemanticWorkbench.js';

const PreviewApp = import.meta.env.DEV
  ? lazy(() =>
      import('../features/preview/PreviewApp.js').then((module) => ({
        default: module.PreviewApp,
      }))
    )
  : null;

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
      {PreviewApp && (
        <Route
          path="/__preview/*"
          element={
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center bg-surface-content text-text-secondary">
                  正在加载体验原型…
                </div>
              }
            >
              <PreviewApp />
            </Suspense>
          }
        />
      )}
      <Route path="/semantic/:projectId/authoring/:versionId" element={<SemanticAuthoringPage />} />
      <Route path="/semantic/:projectId/runs/:runId" element={<SemanticRunPage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/project/:projectId" element={<ProjectPage />} />
        <Route path="/semantic/:projectId" element={<SemanticHomePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </RouterRoutes>
  );
}
