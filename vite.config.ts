import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  server: { proxy: { '/api': 'http://127.0.0.1:8080' } },
});
