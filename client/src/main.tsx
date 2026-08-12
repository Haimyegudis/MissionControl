import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initRouter } from './router';
import { initSession } from './stores/session';
import './theme.css';

initRouter();
void initSession();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
