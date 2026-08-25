import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './app/globals.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('AI E2E UI root element was not found');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
