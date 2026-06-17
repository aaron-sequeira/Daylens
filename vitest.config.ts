import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    // Node 20 has no native WebSocket; polyfill before any Supabase client is created.
    setupFiles: ['tests/supabase/setup.ts'],
  },
});
