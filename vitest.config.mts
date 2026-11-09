import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  // Tests never touch a real database: anything that asks for the default connection gets a private in-memory one.
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 60000, hookTimeout: 60000, env: { PGLITE_DIR: 'memory://', DATABASE_URL: '' } },
});
