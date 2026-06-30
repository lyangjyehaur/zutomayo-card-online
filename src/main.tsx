import React from 'react';
import ReactDOM from 'react-dom/client';
import { initAnalytics } from './analytics';
import App from './App';
import { registerPwaAutoUpdate } from './clientVersion';
import { ErrorBoundary } from './components/ErrorBoundary';

initAnalytics();
registerPwaAutoUpdate();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
