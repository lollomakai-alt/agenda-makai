import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendTarget = env.API_PROXY_TARGET || 'http://127.0.0.1:8000';
  const backendHost = new URL(backendTarget).hostname;
  const isLocalBackend = ['localhost', '127.0.0.1', '::1'].includes(backendHost);
  const proxy = {
    '/api/admin': {
      target: backendTarget,
      // Keep browser Host for local origin checks; use the backend Host on remote hosts.
      changeOrigin: !isLocalBackend,
      headers: { 'X-Agenda-Backend-Key': env.AGENDA_BACKEND_SECRET || '' },
    },
  };
  return {
    plugins: [react(), tailwindcss()],
    server: { port: 5174, strictPort: true, proxy },
    preview: { port: 4174, strictPort: true, proxy },
  };
});
