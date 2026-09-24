import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

// Dev server only: @vitejs/plugin-react injects an inline refresh preamble and Vite HMR uses a websocket,
// both blocked by index.html's production CSP. Relax it in `serve` mode; `build` output is untouched.
const devCsp = (): Plugin => ({
  name: 'daylens-dev-csp',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace("default-src 'self';", "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws:;")
});

// externalizeDepsPlugin externalizes package.json "dependencies" only; @worksight/core is a devDependency, so it is bundled.
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    root: '.',
    build: { rollupOptions: { input: { index: resolve(__dirname, 'index.html') } } },
    plugins: [react(), devCsp()]
  }
});
