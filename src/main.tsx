import React from 'react';
import ReactDOM from 'react-dom/client';
import { LogtoProvider } from '@logto/react';
import App from './App';
import { logtoConfig } from './auth/logto';
import { AppErrorBoundary, initErrorReporting } from './observability/sentry';

initErrorReporting();

const app = (
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{logtoConfig ? <LogtoProvider config={logtoConfig}>{app}</LogtoProvider> : app}</React.StrictMode>,
);
