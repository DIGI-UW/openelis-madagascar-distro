/**
 * API Endpoint Contract Smoke Tests
 *
 * Validates that critical REST endpoints exist and respond (not 404/405).
 * Catches upstream regressions where a controller or route is removed or
 * never wired up — exactly the class of bug that broke file import config.
 *
 * A 400/401/403/422 is fine — it proves the route is registered.
 * Only 404 (Not Found) and 405 (Method Not Allowed) indicate a missing route.
 */

import { expect, test } from "@playwright/test";

interface EndpointProbe {
  method: string;
  path: string;
  label: string;
  body?: Record<string, unknown>;
}

const ROUTE_MISSING = [404, 405];

const ENDPOINTS: EndpointProbe[] = [
  // Core analyzer CRUD — known working, serves as control
  {
    method: "GET",
    path: "/api/OpenELIS-Global/rest/analyzer/analyzers",
    label: "GET analyzer list",
  },
  {
    method: "POST",
    path: "/api/OpenELIS-Global/rest/analyzer/analyzers",
    label: "POST create analyzer",
    body: { name: "__contract_test__" },
  },
  // Profiles endpoint — used by cascade dropdown
  {
    method: "GET",
    path: "/api/OpenELIS-Global/rest/analyzer/profiles",
    label: "GET analyzer profiles",
  },
];

test.describe("API endpoint contract: critical routes exist", () => {
  test.setTimeout(30_000);

  for (const probe of ENDPOINTS) {
    test(`${probe.label}: route exists`, async ({ page }) => {
      const url = `${probe.path}`;
      const options: Parameters<typeof page.request.fetch>[1] = {
        method: probe.method,
        ...(probe.body && { data: probe.body }),
      };

      const response = await page.request.fetch(url, options);
      const status = response.status();
      await response.dispose();

      expect(
        ROUTE_MISSING.includes(status),
        `${probe.method} ${probe.path} returned ${status} — route is not registered`,
      ).toBe(false);
    });
  }
});
