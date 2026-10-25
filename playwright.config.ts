import { defineConfig, devices } from '@playwright/test';

// E2E mínimo de acesso (P5, D-P5-2). Roda sozinho, nunca junto com build ou test:int (D12).
// Sem webServer: ele subiria antes do globalSetup e nasceria sem banco. O global-setup sobe o
// banco efêmero e depois o `next start`, e o teardown derruba os dois.
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://127.0.0.1:3190',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
