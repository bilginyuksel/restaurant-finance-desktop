import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './styles/theme.css';
import { App } from './App';
import { FinanceProvider } from './context/FinanceContext';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');
const root = createRoot(container);

root.render(
  <React.StrictMode>
    <HashRouter>
      <FinanceProvider>
        <App />
      </FinanceProvider>
    </HashRouter>
  </React.StrictMode>,
);
