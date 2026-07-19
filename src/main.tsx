import React from 'react';
import ReactDOM from 'react-dom/client';
import { initAnalytics } from './analytics';
import App from './App';
import { registerPwaAutoUpdate } from './clientVersion';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/ToastProvider';
import { initSentry } from './sentry';
import { initWebVitals } from './webVitals';
import { scheduleWebFonts } from './webFonts';

initSentry();
initAnalytics();
initWebVitals();
scheduleWebFonts();
registerPwaAutoUpdate();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
