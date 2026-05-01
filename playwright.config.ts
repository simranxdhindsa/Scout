import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env.e2e') });

interface ProductConfig {
  name: string;
  baseURL: string;
}

/**
 * Register each product here. The name becomes the Playwright project name
 * and must match a directory under specs/{name}/.
 * Base URLs are read from .env.e2e — see .env.e2e.example.
 */
const products: ProductConfig[] = [
  // { name: 'apyhub', baseURL: process.env.APYHUB_URL ?? '' },
];

const setupProjects = products.map((p) => ({
  name: `setup-${p.name}`,
  testMatch: /global-setup\.ts/,
  use: { baseURL: p.baseURL },
}));

const testProjects = products.map((p) => ({
  name: p.name,
  testMatch: new RegExp(`specs/${p.name}/.*\\.spec\\.ts`),
  dependencies: [`setup-${p.name}`],
  use: {
    baseURL: p.baseURL,
    storageState: `.auth/${p.name}-user.json`,
  },
}));

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 30_000,
  reporter: [
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['json', { outputFile: 'reports/results.json' }],
    ['list'],
  ],
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    ...setupProjects,
    ...testProjects,
  ],
});
