import { Routes, Route } from 'react-router-dom';
import DebugPage from './pages/DebugPage.js';
import ChatPage from './pages/ChatPage.js';
import ExecutionPage from './pages/ExecutionPage.js';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<DebugPage />} />
      <Route path="/chat" element={<ChatPage />} />
      <Route path="/execution" element={<ExecutionPage />} />
    </Routes>
  );
}
