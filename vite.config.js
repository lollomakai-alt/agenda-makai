import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxy = {
    '/api/admin': {
      target: env.API_PROXY_TARGET || 'http://127.0.0.1:8000',
      // Preserve the browser Host so local origin checks and cookies keep working.
      changeOrigin: false,
      headers: { 'X-Agenda-Backend-Key': env.AGENDA_BACKEND_SECRET || '' },
    },
  };
  return {
    plugins: [react(), tailwindcss()],
    server: { port: 5174, strictPort: true, proxy },
    preview: { port: 4174, strictPort: true, proxy },
  };
});
