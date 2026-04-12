import { Page, expect, type TestInfo } from "@playwright/test";
import type { DemoPresentation } from "./demo-presentation";
import { debugLog } from "./debug-instrumentation";
import {
  accessionTextRegExp,
  openAccessionResultsAndWaitForText,
} from "./results-ui";
import {
  SHORT_TIMEOUT,
  UI_TIMEOUT,
  LONG_TIMEOUT,
  NAV_TIMEOUT,
} from "./timeouts";

/**
 * Accept staged analyzer results, save, and verify in AccessionResults.
 *
 * Accepts the first {@code acceptCount} distinct accessions visible on the
 * staging page (default 3). For the video, this shows a realistic "accept a
 * batch" workflow instead of just one row. After save, navigates to
 * AccessionResults for the first accepted accession to prove the downstream
 * chain (sample → analysis → result) was created.
 *
 * @param acceptCount Number of distinct accessions to accept (default 3).
 *   Pass 1 for the old single-accession behavior.
 */
export async function acceptAndVerifyResults(
  page: Page,
  presentation: DemoPresentation,
  stepOffset: number,
  accessionNumber?: string,
  testInfo?: TestInfo,
  acceptCount: number = 3,
) {
  // ── Collect accessions to accept ──────────────────────────────────
  const labNoLocators = page.locator('[data-testid="LabNo"]');
  await expect(labNoLocators.first()).toBeVisible({ timeout: LONG_TIMEOUT });

  // Gather the first N distinct accession numbers from the staging page
  const allLabNos = await labNoLocators.allTextContents();
  const uniqueAccessions: string[] = [];
  for (const raw of allLabNos) {
    const trimmed = raw.trim();
    if (trimmed && !uniqueAccessions.includes(trimmed)) {
      uniqueAccessions.push(trimmed);
      if (uniqueAccessions.length >= acceptCount) break;
    }
  }

  // If an explicit accession was passed and isn't already in the list, prepend it
  if (accessionNumber?.trim()) {
    const explicit = accessionNumber.trim();
    if (!uniqueAccessions.includes(explicit)) {
      uniqueAccessions.unshift(explicit);
    }
  }

  if (uniqueAccessions.length === 0) {
    throw new Error("No staged accessions found on the page.");
  }

  const primaryAccession = uniqueAccessions[0];

  // #region agent log
  debugLog({
    phase: "accept-results",
    hypothesisId: "A0",
    location: "helpers/accept-results.ts:acceptAndVerifyResults",
    message: `Accepting ${uniqueAccessions.length} accessions`,
    runId: "accept-results",
    data: {
      accessions: uniqueAccessions,
      explicitAccessionPassed: accessionNumber != null,
    },
  });
  // #endregion

  // ── Accept rows ───────────────────────────────────────────────────
  await presentation.step(
    stepOffset + 1,
    `Accept ${uniqueAccessions.length} accession(s)`,
  );

  let totalChecked = 0;
  for (const accession of uniqueAccessions) {
    const rows = page
      .getByRole("row")
      .filter({ hasText: accessionTextRegExp(accession) });
    const rowCount = await rows.count();

    for (let i = 0; i < rowCount; i++) {
      const acceptInput = rows
        .nth(i)
        .locator('input[id$=".isAccepted"]')
        .first();
      await expect(acceptInput).toBeAttached({ timeout: SHORT_TIMEOUT });
      if (!(await acceptInput.isChecked())) {
        const checkboxId = await acceptInput.getAttribute("id");
        if (!checkboxId) continue;
        await page.locator(`label[for="${checkboxId}"]`).click();
        totalChecked++;
      }
    }
  }

  await presentation.pause(1_000);

  // ── Save ────────────────────────────────────────────────────────
  await presentation.step(
    stepOffset + 2,
    `Save ${totalChecked} accepted result(s)`,
  );

  const saveButton = page.locator('[data-testid="Save-btn"]');
  await expect(saveButton).toBeVisible({ timeout: SHORT_TIMEOUT });
  await expect(saveButton).toBeEnabled({ timeout: SHORT_TIMEOUT });

  await saveButton.click();

  const saveInProgress = page.locator(
    '[data-testid="analyzer-results-save-in-progress"]',
  );
  await Promise.any([
    expect(saveButton).toBeDisabled({ timeout: SHORT_TIMEOUT }),
    saveInProgress.waitFor({ state: "attached", timeout: SHORT_TIMEOUT }),
  ]).catch(() => {
    // Some runs complete quickly and can skip observable transition states.
  });

  // Success path issues full page reload (AnalyserResults.js).
  await page.waitForURL(/AnalyzerResults[?](id|type)=/, {
    timeout: NAV_TIMEOUT,
  });
  await page
    .waitForResponse(
      (resp) =>
        resp.url().includes("/rest/AnalyzerResults") && resp.status() === 200,
      { timeout: LONG_TIMEOUT },
    )
    .catch((e) => {
      if (!(e instanceof Error && e.message.includes("Timeout"))) {
        console.error(`[waitForResponse] unexpected: ${e}`);
      }
    });
  const emptyState = page.locator('[data-testid="analyzer-results-empty"]');
  await expect(saveButton.or(emptyState).first()).toBeVisible({
    timeout: LONG_TIMEOUT,
  });

  await presentation.evidence("demo-05-results-accepted");

  // ── Verify in AccessionResults ──────────────────────────────────
  // Show a step card BEFORE navigating so the video has visual feedback
  // during the AccessionResults page load (React fetches data async after
  // domcontentloaded — can take 10-30s under Docker load). Without this
  // card the viewer sees a frozen screen.
  await presentation.step(
    stepOffset + 3,
    `Loading AccessionResults for ${primaryAccession}...`,
  );
  await openAccessionResultsAndWaitForText(
    page,
    primaryAccession,
    primaryAccession,
    {
      timeoutMs: NAV_TIMEOUT,
      perAttemptTimeoutMs: UI_TIMEOUT,
      testInfo,
    },
  );
  await presentation.step(
    stepOffset + 4,
    `Verified: ${primaryAccession} accepted in By Order view`,
  );
  await presentation.evidence("demo-06-accession-results-view");
  await presentation.pause(2_000);
}
