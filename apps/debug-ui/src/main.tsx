import { createRoot } from 'react-dom/client';
import App from './app/App.js';
import './styles/variables.css';
import '@nebula-link-evo/agent-activity-ui/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(<App />);
