import { defineConfig } from '@playwright/test';

// Testes e2e usam apenas fixtures HTML locais. Nunca contas reais de terceiros.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [['list']],
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
