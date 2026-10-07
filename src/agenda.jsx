import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(error => {
    console.error('Registrazione del service worker non riuscita.', error);
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
