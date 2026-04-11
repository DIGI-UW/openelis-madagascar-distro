import { expect, Locator, Page, type TestInfo } from "@playwright/test";
import {
  attachScreenshot,
  debugLog,
} from "./debug-instrumentation";
import { LONG_TIMEOUT, SHORT_TIMEOUT, UI_TIMEOUT } from "./timeouts";

/**
 * Mirrors {@link frontend/src/components/utils/Utils.js} `convertAlphaNumLabNumForDisplay`.
 * When site AccessionFormat is ALPHANUM, AnalyzerResults / AccessionResults show this form
 * (e.g. E2E001 → E2-E001). Plain `getByText('E2E001')` then fails in CI while it may pass
 * locally with SiteYearNum formatting.
 */
export function convertAlphaNumLabNumForDisplay(labNumber: string): string {
  if (!labNumber) {
    return labNumber;
  }
  if (labNumber.length > 15) {
    return labNumber;
  }
  const labNumberParts = labNumber.split("-");
  const isAnalysisLabNumber = labNumberParts.length > 1;
  let labNumberForDisplay = labNumberParts[0];
  if (labNumberParts[0].length < 8) {
    labNumberForDisplay = labNumberParts[0].slice(0, 2);
    if (labNumberParts[0].length > 2) {
      labNumberForDisplay =
        labNumberForDisplay + "-" + labNumberParts[0].slice(2);
    }
  } else {
    labNumberForDisplay = labNumberParts[0].slice(0, 2) + "-";
    if (labNumberParts[0].length > 8) {
      labNumberForDisplay =
        labNumberForDisplay +
        labNumberParts[0].slice(2, labNumberParts[0].length - 6) +
        "-";
    }
    labNumberForDisplay =
      labNumberForDisplay +
      labNumberParts[0].slice(
        labNumberParts[0].length - 6,
        labNumberParts[0].length - 3,
      ) +
      "-";
    labNumberForDisplay =
      labNumberForDisplay +
      labNumberParts[0].slice(labNumberParts[0].length - 3);
  }
  if (isAnalysisLabNumber) {
    labNumberForDisplay = labNumberForDisplay + "-" + labNumberParts[1];
  }
  return labNumberForDisplay.toUpperCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Regex matching raw lab number and ALPHANUM display variant (for scoped table locators). */
export function accessionTextRegExp(accession: string): RegExp {
  const raw = accession.trim();
  const alphanum = convertAlphaNumLabNumForDisplay(raw);
  const variants = Array.from(new Set([raw, alphanum].filter(Boolean)));
  return new RegExp(variants.map(escapeRegExp).join("|"));
}

/**
 * Locator for lab/accession text as rendered under either SiteYearNum or ALPHANUM accession format.
 */
export function locatorForAccessionNumber(
  page: Page,
  accession: string,
): Locator {
  return page.getByText(accessionTextRegExp(accession)).first();
}

export type NavigateUntilVisibleOptions = {
  timeoutMs?: number;
  perAttemptTimeoutMs?: number;
  /** Optional API URL to poll before navigating. When provided, the helper
   *  waits for the API to return matching content before loading the page,
   *  eliminating the reload loop entirely. */
  apiPollUrl?: string;
  /** Text(s) to match in resultList accessionNumber fields. When an array,
   *  ALL must be present before navigating (handles multi-sample file imports
   *  where the bridge posts results one accession at a time). */
  apiPollMatch?: string | string[];
};

/** AccessionResults navigation + optional Playwright report attachments. */
export type OpenAccessionResultsOptions = NavigateUntilVisibleOptions & {
  /**
   * When set, full-page failure screenshots attach to the HTML report
   * before `finally`/teardown can navigate away (diagnosis stays unambiguous).
   */
  testInfo?: TestInfo;
};

/**
 * Full-page screenshot + NDJSON diagnostics when AccessionResults (or same URL)
 * does not show the expected accession. Safe to call from catch blocks.
 */
export async function captureAccessionPageFailureArtifacts(
  page: Page,
  testInfo: TestInfo | undefined,
  expectedLabel: string,
  hypothesisId: string,
  location: string,
  reason: string,
): Promise<void> {
  const screenshot = await page.screenshot({ fullPage: true }).catch(() => null);
  const safe = expectedLabel.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 40);
  if (screenshot) {
    await attachScreenshot(
      testInfo,
      `accession-verify-${hypothesisId}-${safe}.png`,
      screenshot,
    );
  }
  const bodyText = ((await page.locator("body").textContent()) || "").replace(
    /\s+/g,
    " ",
  );
  const alphanum = convertAlphaNumLabNumForDisplay(expectedLabel);
  const title = await page.title().catch(() => "");
  const h1 = await page.locator("h1").first().textContent().catch(() => "");
  const accessionInputValue = await page
    .locator('input[name="accessionNumber"], #searchAccessionID')
    .first()
    .inputValue()
    .catch(() => "");
  const sampleInfoPreview = await page
    .locator('[data-testid="LabNo"], .sampleInfo')
    .allTextContents()
    .then((items) =>
      items
        .map((t) => t.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 6),
    )
    .catch(() => []);
  let locatorMatchCount = 0;
  try {
    locatorMatchCount = await page
      .getByText(accessionTextRegExp(expectedLabel))
      .count();
  } catch {
    locatorMatchCount = -1;
  }
  const noResultsBanner = await page
    .getByText(/no sample found|no tests with pending/i)
    .first()
    .isVisible()
    .catch(() => false);

  debugLog({
    phase: "accession-verify",
    hypothesisId,
    location,
    message: reason,
    runId: "accession-verify",
    data: {
      url: page.url(),
      expectedAccession: expectedLabel,
      expectedDisplayVariants: Array.from(
        new Set([expectedLabel.trim(), alphanum].filter(Boolean)),
      ),
      bodyHasRawAccession: bodyText.includes(expectedLabel.trim()),
      bodyHasAlphanumVariant: bodyText.includes(alphanum),
      locatorMatchCount,
      pageTitle: title,
      h1First: (h1 || "").trim().slice(0, 240),
      accessionSearchInputValue: accessionInputValue,
      noResultsBannerVisible: noResultsBanner,
      sampleInfoPreview,
      screenshotBytes: screenshot ? screenshot.length : 0,
      screenshotAttachedToReport: Boolean(screenshot && testInfo),
      bodySnippet: bodyText.slice(0, 600),
    },
  });
}

async function navigateUntilVisible(
  page: Page,
  url: string,
  visibleLocator: () => Locator,
  options?: NavigateUntilVisibleOptions,
) {
  const timeoutMs = options?.timeoutMs ?? LONG_TIMEOUT;
  const perAttemptTimeoutMs = options?.perAttemptTimeoutMs ?? UI_TIMEOUT;
  let pollAttempt = 0;

  // When an API poll URL is provided, poll the REST API before navigating.
  // Uses page.request.get() but disposes each response immediately to avoid
  // stale protocol bindings that cause "guid response@... was not bound"
  // on the subsequent page.goto().
  if (options?.apiPollUrl) {
    const matchList = !options?.apiPollMatch
      ? []
      : Array.isArray(options.apiPollMatch)
        ? options.apiPollMatch
        : [options.apiPollMatch];
    let shouldFallbackToUiReload = false;

    try {
      await expect
        .poll(
          async () => {
            pollAttempt += 1;
            try {
              const resp = await page.request.get(options.apiPollUrl!, {
                timeout: SHORT_TIMEOUT,
              });
              let ok = false;
              let data = null;
              let text = "";
              try {
                ok = resp.ok();
                text = await resp.text();
                data = ok && text ? JSON.parse(text) : null;
              } finally {
                await resp.dispose();
              }
              if (pollAttempt <= 3) {
                // #region agent log
                debugLog({
                  phase: "results-poll",
                  hypothesisId: "R1",
                  location: "helpers/results-ui.ts:api-poll",
                  message: "AnalyzerResults REST poll sample (first 3 attempts)",
                  runId: "results-poll",
                  data: {
                    attempt: pollAttempt,
                    apiPollUrl: options.apiPollUrl,
                    ok,
                    keys:
                      data && typeof data === "object"
                        ? Object.keys(data as Record<string, unknown>)
                        : [],
                    resultListLength: Array.isArray(data?.resultList)
                      ? data.resultList.length
                      : -1,
                    bodySnippet: text.slice(0, 220),
                  },
                });
                // #endregion
              }
              if (
                data &&
                !Array.isArray(data?.resultList) &&
                data?.formName === "AnalyzerResultsForm"
              ) {
                shouldFallbackToUiReload = true;
                return true;
              }
              if (!ok || !data) return false;
              const results = data?.resultList ?? [];
              if (results.length === 0) return false;
              if (matchList.length === 0) return true;
              const accessions = results.map(
                (r: { accessionNumber?: string }) => r.accessionNumber ?? "",
              );
              return matchList.every((m) =>
                accessions.some((a: string) => a.includes(m)),
              );
            } catch {
              return false;
            }
          },
          {
            message: `Waiting for results matching "${options?.apiPollMatch}" at ${options.apiPollUrl}`,
            timeout: timeoutMs,
            intervals: [2_000],
          },
        )
        .toBeTruthy();
    } catch (error) {
      if (!shouldFallbackToUiReload) {
        throw error;
      }
    }

    if (shouldFallbackToUiReload) {
      // #region agent log
      debugLog({
        phase: "results-poll",
        hypothesisId: "R2",
        location: "helpers/results-ui.ts:api-poll-fallback",
        message: "API returned form metadata — falling back to UI reload loop",
        runId: "results-poll",
        data: {
          apiPollUrl: options.apiPollUrl,
          attempts: pollAttempt,
        },
      });
      // #endregion
    } else {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: perAttemptTimeoutMs,
      });
      await expect(visibleLocator()).toBeVisible({
        timeout: perAttemptTimeoutMs,
      });
      return;
    }

    // Fall through to the generic UI reload loop below.
  }

  // Fallback: reload loop for pages without a known API endpoint.
  const attempts = Math.max(1, Math.ceil(timeoutMs / perAttemptTimeoutMs));
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      if (attempt === 1) {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: perAttemptTimeoutMs,
        });
      } else {
        await page.reload({
          waitUntil: "domcontentloaded",
          timeout: perAttemptTimeoutMs,
        });
      }

      await expect(visibleLocator()).toBeVisible({
        timeout: perAttemptTimeoutMs,
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Timed out waiting for visible content at ${url}`);
}

export function analyzerResultsUrl(analyzerName: string): string {
  return `AnalyzerResults?type=${encodeURIComponent(analyzerName)}`;
}

export function analyzerResultsUrlById(analyzerId: string): string {
  return `AnalyzerResults?id=${encodeURIComponent(analyzerId)}`;
}

export function accessionResultsUrl(accessionNumber: string): string {
  return `AccessionResults?accessionNumber=${encodeURIComponent(accessionNumber)}`;
}

export async function openAnalyzerResultsAndWaitForText(
  page: Page,
  analyzerName: string,
  visibleText: string,
  options?: NavigateUntilVisibleOptions & {
    /** All expected accession numbers — poll waits for ALL before navigating. */
    allExpectedAccessions?: string[];
  },
) {
  const apiUrl = `/api/OpenELIS-Global/rest/AnalyzerResults?type=${encodeURIComponent(analyzerName)}`;
  const pollMatch = options?.allExpectedAccessions ?? visibleText;
  await navigateUntilVisible(
    page,
    analyzerResultsUrl(analyzerName),
    () => locatorForAccessionNumber(page, visibleText),
    { ...options, apiPollUrl: apiUrl, apiPollMatch: pollMatch },
  );
}

export async function openAnalyzerResultsByIdAndWaitForText(
  page: Page,
  analyzerId: string,
  visibleText: string,
  options?: NavigateUntilVisibleOptions & {
    allExpectedAccessions?: string[];
  },
) {
  const apiUrl = `/api/OpenELIS-Global/rest/AnalyzerResults?id=${encodeURIComponent(analyzerId)}`;
  const pollMatch = options?.allExpectedAccessions ?? visibleText;
  await navigateUntilVisible(
    page,
    analyzerResultsUrlById(analyzerId),
    () => locatorForAccessionNumber(page, visibleText),
    { ...options, apiPollUrl: apiUrl, apiPollMatch: pollMatch },
  );
}

/**
 * Verify a result value is visible on the staging page. Checks input fields
 * first (editable numeric results render as <input>), falls back to text nodes
 * (read-only or dictionary results render as plain text).
 */
export async function expectResultVisible(
  resultsRegion: Locator,
  resultValue: string,
): Promise<void> {
  for (const candidate of resultValueSearchVariants(resultValue)) {
    const inputResult = resultsRegion
      .locator(`input[value*="${candidate}"]`)
      .first();
    try {
      await expect(inputResult).toBeVisible({ timeout: SHORT_TIMEOUT });
      return;
    } catch {
      // Input not found for this variant — try text match
    }
    try {
      await expect(
        resultsRegion.getByText(candidate, { exact: false }).first(),
      ).toBeVisible({ timeout: SHORT_TIMEOUT });
      return;
    } catch {
      // Text not found for this variant — keep trying
    }
  }
  await expect(resultsRegion.getByText(resultValue, { exact: false }).first())
    .toBeVisible({ timeout: UI_TIMEOUT });
}

export function resultValueSearchVariants(resultValue: string): string[] {
  const trimmed = resultValue.trim();
  const variants = new Set<string>([trimmed]);
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) {
    variants.add(String(asNumber));
    if (Number.isInteger(asNumber)) {
      variants.add(asNumber.toFixed(1));
    }
  }
  return Array.from(variants);
}

export async function openAccessionResultsAndWaitForText(
  page: Page,
  accessionNumber: string,
  visibleText = accessionNumber,
  options?: OpenAccessionResultsOptions,
) {
  // AccessionResults is called after results are saved — data already exists
  // in the DB. Navigate once with a generous assertion timeout instead of the
  // reload loop, which wastes memory and can trigger OOM browser crashes on CI.
  const navTimeout = options?.timeoutMs ?? LONG_TIMEOUT;
  // Table/API hydration after domcontentloaded often exceeds NAV_TIMEOUT under docker load.
  const visibilityTimeout = Math.max(navTimeout, 90_000);
  await page.goto(accessionResultsUrl(accessionNumber), {
    waitUntil: "domcontentloaded",
    timeout: navTimeout,
  });
  try {
    await expect(locatorForAccessionNumber(page, visibleText)).toBeVisible({
      timeout: visibilityTimeout,
    });
  } catch (error) {
    // #region agent log
    await captureAccessionPageFailureArtifacts(
      page,
      options?.testInfo,
      visibleText,
      "R3",
      "helpers/results-ui.ts:openAccessionResultsAndWaitForText",
      "Accession text not visible on AccessionResults page",
    );
    // #endregion
    throw error;
  }
}
