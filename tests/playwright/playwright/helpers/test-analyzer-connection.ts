/**
 * Reusable test-connection helper for any analyzer type.
 *
 * Opens the overflow menu → clicks "Test Connection" → clicks "Test" button →
 * waits for success tag → closes modal. Works for all protocols (the modal is
 * protocol-agnostic).
 *
 * Extracted from astm-genexpert-results.spec.ts for reuse across all demo flows.
 */

import { expect, Locator, Page } from "@playwright/test";
import type { DemoPresentation } from "./demo-presentation";
import { SHORT_TIMEOUT, UI_TIMEOUT, LONG_TIMEOUT } from "./timeouts";

export async function testAnalyzerConnection(
  page: Page,
  analyzerRow: Locator,
  presentation: DemoPresentation,
) {
  // #region agent log
  fetch("http://localhost:7356/ingest/dd709e30-65ee-44b3-9fc7-0d27deb0de7e", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "0246c3",
    },
    body: JSON.stringify({
      sessionId: "0246c3",
      runId: "genexpert-connection-pre",
      hypothesisId: "H1",
      location: "helpers/test-analyzer-connection.ts:entry",
      message: "enter testAnalyzerConnection",
      data: {
        rowCount: await analyzerRow.count(),
        overflowCount: await analyzerRow
          .first()
          .locator('[data-testid^="analyzer-row-overflow-"]')
          .count(),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  const overflow = analyzerRow
    .first()
    .locator('[data-testid^="analyzer-row-overflow-"]')
    .first();
  await overflow.click();
  await presentation.pause(500);

  const testConnectionAction = page
    .locator('[data-testid*="analyzer-action-test-connection"]')
    .first();
  await expect(testConnectionAction).toBeVisible({ timeout: SHORT_TIMEOUT });
  await testConnectionAction.click();

  const connectionModal = page.locator('[data-testid="test-connection-modal"]');
  await expect(connectionModal).toBeVisible({ timeout: UI_TIMEOUT });

  const testButton = page.locator(
    '[data-testid="test-connection-test-button"]',
  );
  const testResponsePromise = page
    .waitForResponse(
      (resp) => {
        const url = resp.url();
        return (
          url.includes("/testConnection") ||
          url.includes("/test-connection") ||
          url.includes("/analyzer/analyzers")
        );
      },
      { timeout: LONG_TIMEOUT },
    )
    .catch(() => null);
  await testButton.click();

  const testResponse = await testResponsePromise;
  // #region agent log
  fetch("http://localhost:7356/ingest/dd709e30-65ee-44b3-9fc7-0d27deb0de7e", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "0246c3",
    },
    body: JSON.stringify({
      sessionId: "0246c3",
      runId: "genexpert-connection-pre",
      hypothesisId: "H2",
      location: "helpers/test-analyzer-connection.ts:after-test-click",
      message: "test connection response probe",
      data: testResponse
        ? {
            url: testResponse.url(),
            status: testResponse.status(),
            ok: testResponse.ok(),
          }
        : { response: "none-captured" },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  const successTag = page.locator('[data-testid="test-connection-success"]');
  try {
    await expect(successTag).toBeVisible({ timeout: LONG_TIMEOUT });
    // #region agent log
    fetch("http://localhost:7356/ingest/dd709e30-65ee-44b3-9fc7-0d27deb0de7e", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "0246c3",
      },
      body: JSON.stringify({
        sessionId: "0246c3",
        runId: "genexpert-connection-pre",
        hypothesisId: "H3",
        location: "helpers/test-analyzer-connection.ts:success-visible",
        message: "success tag visible",
        data: { successCount: await successTag.count() },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  } catch (error) {
    const modalText = (await connectionModal.textContent()) || "";
    // #region agent log
    fetch("http://localhost:7356/ingest/dd709e30-65ee-44b3-9fc7-0d27deb0de7e", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "0246c3",
      },
      body: JSON.stringify({
        sessionId: "0246c3",
        runId: "genexpert-connection-pre",
        hypothesisId: "H4",
        location: "helpers/test-analyzer-connection.ts:success-timeout",
        message: "success tag timeout",
        data: {
          successCount: await successTag.count(),
          modalSnippet: modalText.slice(0, 400),
          error:
            error instanceof Error ? error.message.slice(0, 200) : "unknown",
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    throw error;
  }
  await presentation.pause(1_500);

  await connectionModal
    .locator('[data-testid="test-connection-close-button"]')
    .click();
  await expect(connectionModal).toBeHidden({ timeout: UI_TIMEOUT });
}
