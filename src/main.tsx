import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerPwaAutoUpdate } from './clientVersion';

registerPwaAutoUpdate();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
