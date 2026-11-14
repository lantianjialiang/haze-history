import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";

export const test = base.extend({
  // Playwright expects every fixture's dependencies to be destructured.
  // eslint-disable-next-line no-empty-pattern
  baseURL: async ({}, use) => {
    await use(process.env.HAZE_TEST_URL);
  },
});
