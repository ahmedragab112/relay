import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve('src/renderer'),
  base: './',
  server: { host: '127.0.0.1', port: 5178, strictPort: true },
  build: { outDir: resolve('dist/renderer'), emptyOutDir: true },
  worker: { format: 'es' },
  plugins: [{
    name: 'relay-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace("connect-src 'none'", "connect-src 'self' ws://127.0.0.1:5178");
    },
  }],
});
