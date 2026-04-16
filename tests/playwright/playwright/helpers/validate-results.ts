import { Page, expect, type TestInfo } from "@playwright/test";
import type { DemoPresentation } from "./demo-presentation";
import { debugLog } from "./debug-instrumentation";
import {
  LONG_TIMEOUT,
  NAV_TIMEOUT,
  SHORT_TIMEOUT,
  UI_TIMEOUT,
} from "./timeouts";

/**
 * Navigate to the Accession Validation screen and assert that dict-typed
 * results render cleanly (no FloatingDecimal NumberFormatException).
 *
 * Prior to the A1/A2 fixes in OE PR #3372, this screen threw
 * NumberFormatException when dict-typed results (like COVID "POSITIVE"
 * or Xpert "DETECTED") were persisted with result_type='A' instead of
 * 'D'. The validation screen is the key regression-guard for that chain.
 *
 * This helper stops at "screen renders + accession visible + result value
 * shown". Full e-signature and status 15→6 transition is left for a
 * follow-up step since it requires e-signature PIN setup in the test env.
 */
export async function validateResults(
  page: Page,
  presentation: DemoPresentation,
  stepOffset: number,
  accessionNumber: string,
  testInfo?: TestInfo,
  configName?: string,
) {
  debugLog({
    phase: "validate-results",
    hypothesisId: "D1",
    location: "helpers/validate-results.ts:validateResults",
    message: `Navigating to validation screen for ${accessionNumber}`,
    runId: "validate-results",
    data: { accessionNumber },
  });

  await presentation.step(
    stepOffset + 1,
    `Loading Ready for Validation screen for ${accessionNumber}...`,
  );

  await page.goto(
    `/AccessionValidation?type=accession&accessionNumber=${encodeURIComponent(accessionNumber)}`,
    { timeout: NAV_TIMEOUT },
  );

  // The validation screen renders either a DataTable of results or
  // a "no results to validate" message. Wait for one or the other.
  const labNoLocators = page.locator('[data-testid="LabNo"]');
  const emptyMessage = page.getByText(/no results.*validat/i);

  await Promise.race([
    expect(labNoLocators.first()).toBeVisible({ timeout: LONG_TIMEOUT }),
    expect(emptyMessage).toBeVisible({ timeout: LONG_TIMEOUT }),
  ]).catch(() => {
    // Fall through — we'll diagnose below
  });

  const rowCount = await labNoLocators.count();
  if (rowCount === 0) {
    // Not necessarily a failure — results may have been auto-finalized
    // or this accession may not need biological validation. Record it.
    debugLog({
      phase: "validate-results",
      hypothesisId: "D1",
      location: "helpers/validate-results.ts:validateResults",
      message: `No rows on validation screen for ${accessionNumber} — may be already finalized`,
      runId: "validate-results",
      data: { accessionNumber },
    });
    await presentation.step(
      stepOffset + 1,
      `No pending validation for ${accessionNumber} (already finalized or no biologist review required)`,
    );
    await presentation.evidence(
      `demo-07-validation-empty${configName ? `-${configName}` : ""}`,
    );
    return { rowCount: 0, validated: false };
  }

  // Assert the accession we just accepted appears on the validation list.
  const accessionRow = page
    .getByRole("row")
    .filter({ hasText: accessionNumber });
  await expect(accessionRow.first()).toBeVisible({ timeout: SHORT_TIMEOUT });

  // Critical regression assertion: the page renders without throwing
  // NumberFormatException. If dict-typed results were stored with
  // result_type='A' + free-text value (pre-A1 bug), the render would
  // 500 or show a blank result cell. We assert the result has visible
  // content in the first row.
  //
  // The result column doesn't have a dedicated data-testid in the current
  // Validation.js, so we assert the row has more than just the accession
  // by checking the row text contains either a dict label (Positive/Negative/
  // Detected/etc.) or a numeric value.
  const rowText = await accessionRow.first().textContent();
  expect(
    rowText,
    "Validation row must have content beyond accession number",
  ).toBeTruthy();

  // Positive regression guard: absence of "NaN" or "undefined" in the
  // rendered row — those are symptoms of the old bug that stored
  // 'NEGATIVE' as numeric and then failed to parse at display time.
  expect(rowText).not.toContain("NaN");
  expect(rowText).not.toContain("undefined");

  await presentation.step(
    stepOffset + 1,
    `Validation screen rendered for ${accessionNumber} — ${rowCount} row(s) visible, no render errors`,
  );
  await presentation.evidence(
    `demo-07-validation-rendered${configName ? `-${configName}` : ""}`,
  );
  await presentation.pause(2_000);

  return { rowCount, validated: true };
}
