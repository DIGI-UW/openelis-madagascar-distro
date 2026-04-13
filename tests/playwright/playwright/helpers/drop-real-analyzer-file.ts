import { Page } from "@playwright/test";
import { DemoPresentation } from "./demo-presentation";

/**
 * Drive the bridge `/admin/upload` UI with Playwright to upload a real
 * analyzer result file into a registered FILE analyzer's watched
 * directory. This is the "true user workflow" Gate 1 video path: the
 * same admin UI a lab tech without NFS access would use manually, NOT
 * a docker cp shortcut.
 *
 * <p>Design note — unified video: the upload flow runs on the SAME page
 * the test started on. Playwright records one continuous {@code video.webm}
 * per test, so the viewer sees the full user story in a single stream:
 * create analyzer → admin upload UI → staging → accept → AccessionResults.
 *
 * <p>How the cross-origin detour stays safe:
 * <ul>
 * <li>Global {@code ignoreHTTPSErrors: true} (playwright.config.ts) lets
 * the main context load the bridge's self-signed cert.</li>
 * <li>{@link Page#setExtraHTTPHeaders} installs the bridge's HTTP Basic
 * credential only for the main-page navigations during the upload window,
 * then clears it before handing control back — so subsequent OE requests
 * don't carry a stray {@code Authorization} header.</li>
 * <li>Cookies are origin-scoped: the OE session cookie at {@code proxy}
 * is not sent to {@code openelis-analyzer-bridge:8443} and vice versa,
 * so the OE session survives the detour and resumes cleanly.</li>
 * </ul>
 *
 * Preconditions:
 * - Bridge is running and reachable at BRIDGE_URL (default
 *   https://openelis-analyzer-bridge:8443 inside the compose network)
 * - Analyzer has been created via the OE AnalyzerForm and registered
 *   with the bridge (so it appears in the /admin/upload/analyzers
 *   dropdown AND in /admin/upload/analyzers/{id}/tests)
 * - The source file exists at a path Playwright can read — the
 *   demo-tests container bind-mounts ${ANALYZER_HOST_MOUNT:-/mnt}
 *   read-only.
 */
export interface DropRealFileOptions {
  /** The analyzer id as registered with the bridge (resolved via webapp REST lookup). */
  analyzerId: string;
  /**
   * Optional per-file test code to declare at upload time. Only needed when
   * the file has NO per-row test labels (e.g. FluoroCycler). Files with
   * per-row labels (e.g. QuantStudio's Target Name column) don't need this
   * — leave undefined and the parser reads test identity from each row.
   * If provided, must be in the analyzer's AnalyzerTestMapping set.
   */
  testCode?: string;
  /** Absolute path to the source file, inside the demo-tests container. */
  sourcePath: string;
  /** Demo presentation helper for step narration + pacing. */
  presentation: DemoPresentation;
  /** Config name for unique evidence screenshot filenames (e.g., "Demo--FluoroCycler-XT"). */
  configName?: string;
}

export async function dropRealAnalyzerFileViaBridgeUI(
  page: Page,
  opts: DropRealFileOptions,
): Promise<void> {
  const bridgeUrl =
    process.env.BRIDGE_URL ?? "https://openelis-analyzer-bridge:8443";
  // Bridge HTTP Basic auth on /admin/** uses its own credentials, NOT the
  // OE webapp admin/adminADMIN! creds. SecurityConfig logs "Configured
  // bridge security user: bridge" + "default password 'changeme'" at
  // startup.
  const creds = {
    username: process.env.BRIDGE_USER ?? "bridge",
    password: process.env.BRIDGE_PASS ?? "changeme",
  };
  const basicAuth =
    "Basic " +
    Buffer.from(`${creds.username}:${creds.password}`).toString("base64");

  // Install Basic auth for the main-page navigations during the upload
  // flow. This is per-page and applies to BOTH the main document load and
  // the page's subsequent fetch()/XHR calls (the analyzer/test dropdowns
  // populate via JS fetch to /admin/upload/analyzers*). Cleared in the
  // finally block so the test's next request to OE does not carry a
  // stray Authorization header.
  await page.setExtraHTTPHeaders({ Authorization: basicAuth });

  try {
    await opts.presentation.step("Opening bridge admin upload UI");
    await page.goto(`${bridgeUrl}/admin/upload/index.html`);
    // Wait for the analyzer dropdown to populate (JS fetch to /admin/upload/analyzers)
    await page.waitForFunction(
      () => {
        const sel = document.querySelector(
          "#analyzer-select",
        ) as HTMLSelectElement | null;
        return (
          !!sel &&
          sel.options.length > 0 &&
          Array.from(sel.options).some((o) => o.value !== "")
        );
      },
      { timeout: 10_000 },
    );
    await opts.presentation.evidence(
      `admin-upload-01-form-loaded${opts.configName ? `-${opts.configName}` : ""}`,
    );

    await opts.presentation.step(
      `Selecting analyzer ${opts.analyzerId} from upload UI dropdown`,
    );
    await page.selectOption("#analyzer-select", opts.analyzerId);
    await opts.presentation.pause(750);

    // Test dropdown populates via fetch after analyzer-change event
    await page.waitForFunction(
      () => {
        const sel = document.querySelector(
          "#test-select",
        ) as HTMLSelectElement | null;
        return (
          !!sel &&
          !sel.disabled &&
          sel.options.length > 0 &&
          Array.from(sel.options).some((o) => o.value !== "")
        );
      },
      { timeout: 10_000 },
    );

    // testCode is optional — only select if the caller provided one
    // (files with per-row test labels don't need a form declaration)
    if (opts.testCode) {
      await opts.presentation.step(
        `Selecting test code ${opts.testCode} from upload UI Test dropdown`,
      );
      await page.selectOption("#test-select", opts.testCode);
      await opts.presentation.pause(500);
    } else {
      await opts.presentation.step(
        "Skipping test code selection — file has per-row test labels",
      );
    }

    await opts.presentation.step(
      `Picking real file ${opts.sourcePath.split("/").pop()} via file picker`,
    );
    await page.setInputFiles("#file-input", opts.sourcePath);
    await opts.presentation.pause(750);
    await opts.presentation.evidence(
      `admin-upload-02-file-selected${opts.configName ? `-${opts.configName}` : ""}`,
    );

    await opts.presentation.step("Clicking Upload File");
    // Upload controller parses + forwards one FHIR Bundle per accession
    // synchronously before returning — a full HIV-result.xlsx can take
    // ~30s for ~90 patient rows. Give the navigation 180s so the POST
    // completes before test timeout.
    await Promise.all([
      page.waitForNavigation({ timeout: 180_000 }),
      page.click("button[type='submit']"),
    ]);

    await page.waitForSelector(".banner.success", { timeout: 10_000 });
    await opts.presentation.evidence(
      `admin-upload-03-success-banner${opts.configName ? `-${opts.configName}` : ""}`,
    );
    await opts.presentation.pause(1_500);
  } finally {
    // Clear the bridge Basic auth header so the next navigation back to
    // OE does not carry a stray Authorization. OE's Spring Security would
    // try to authenticate a "bridge:changeme" basic credential against
    // its own user store and that would be a weird diagnostic path to
    // debug later.
    await page.setExtraHTTPHeaders({});
  }
}
