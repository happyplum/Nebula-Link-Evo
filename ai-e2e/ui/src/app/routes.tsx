import { Routes as RouterRoutes, Route } from 'react-router-dom';
import { Layout } from './layout.js';
import { HomePage } from './pages/HomePage.js';
import { ProjectPage } from './pages/ProjectPage.js';

export function Routes() {
  return (
    <RouterRoutes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/project/:projectId" element={<ProjectPage />} />
      </Route>
    </RouterRoutes>
  );
}
