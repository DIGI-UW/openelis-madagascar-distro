import { Page } from "@playwright/test";
import { DemoPresentation } from "../fixtures/demo-presentation";

/**
 * Drive the bridge `/admin/upload` UI with Playwright to upload a real
 * analyzer result file into a registered FILE analyzer's watched
 * directory. This is the "true user workflow" Gate 1 video path: the
 * same admin UI a lab tech without NFS access would use manually, NOT
 * a docker cp shortcut.
 *
 * Preconditions:
 * - Bridge is running and reachable at BRIDGE_URL (default
 *   https://openelis-analyzer-bridge:8443 inside the compose network)
 * - Analyzer has been created via the OE AnalyzerForm and registered
 *   with the bridge (so it appears in the /admin/upload/analyzers
 *   dropdown AND in /admin/upload/analyzers/{id}/tests)
 * - The source file exists at a path Playwright can read — the
 *   demo-tests container bind-mounts ${ANALYZER_HOST_MOUNT:-/mnt}
 *   read-only per plan §2.5c
 *
 * Flow:
 * 1. Open new browser context with HTTP Basic creds for /admin/**
 * 2. Navigate to /admin/upload/index.html
 * 3. Wait for analyzer dropdown to populate via fetch
 * 4. Select the target analyzer by id
 * 5. Wait for test dropdown to populate (fires on analyzer-change event)
 * 6. Select the admin's declared test code from the test dropdown
 * 7. Pick the real file via setInputFiles
 * 8. Click Upload
 * 9. Wait for .banner.success response HTML
 * 10. Close context
 *
 * Plan ref: mellow-honking-cascade §2.5d.
 */
export interface DropRealFileOptions {
  /** The analyzer id as registered with the bridge (resolved via webapp REST lookup). */
  analyzerId: string;
  /**
   * The test code to declare at upload time. Must be in the analyzer's
   * AnalyzerTestMapping set (the controller will reject with 400
   * otherwise). Event-scoped per upload — NOT persisted on the
   * analyzer instance.
   */
  testCode: string;
  /** Absolute path to the source file, inside the demo-tests container. */
  sourcePath: string;
  /** Demo presentation helper for step narration + pacing. */
  presentation: DemoPresentation;
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

  const browser = page.context().browser();
  if (!browser) {
    throw new Error(
      "dropRealAnalyzerFileViaBridgeUI: no browser from page.context() — cannot open upload UI context",
    );
  }

  // httpCredentials alone handles the initial page navigation but NOT the
  // page's subsequent fetch() XHRs, which triggered indefinite hangs in
  // Playwright's 240s test timeout because /admin/upload/analyzers returned
  // 401 to the JS fetch and the dropdown stayed empty. Inject the Basic
  // Authorization header explicitly so every request the page makes
  // carries it.
  const basicAuth =
    "Basic " +
    Buffer.from(`${creds.username}:${creds.password}`).toString("base64");
  const ctx = await browser.newContext({
    httpCredentials: creds,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { Authorization: basicAuth },
  });
  const uploadPage = await ctx.newPage();

  try {
    await opts.presentation.step(
      "Opening bridge admin upload UI in a new browser tab",
    );
    await uploadPage.goto(`${bridgeUrl}/admin/upload/index.html`);
    // Wait for the analyzer dropdown to populate (JS fetch to /admin/upload/analyzers)
    await uploadPage.waitForFunction(
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

    await opts.presentation.step(
      `Selecting analyzer ${opts.analyzerId} from upload UI dropdown`,
    );
    await uploadPage.selectOption("#analyzer-select", opts.analyzerId);
    await opts.presentation.pause(750);

    // Test dropdown populates via fetch after analyzer-change event
    await uploadPage.waitForFunction(
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

    await opts.presentation.step(
      `Selecting test code ${opts.testCode} from upload UI Test dropdown`,
    );
    await uploadPage.selectOption("#test-select", opts.testCode);
    await opts.presentation.pause(500);

    await opts.presentation.step(
      `Picking real file ${opts.sourcePath} via file picker`,
    );
    await uploadPage.setInputFiles("#file-input", opts.sourcePath);
    await opts.presentation.pause(750);

    await opts.presentation.step("Clicking Upload File");
    // Upload controller parses + forwards one FHIR Bundle per accession
    // synchronously before returning — a full HIV-result.xlsx can take
    // ~30s for ~90 patient rows. Give the navigation 180s so the POST
    // completes before test timeout.
    await Promise.all([
      uploadPage.waitForNavigation({ timeout: 180_000 }),
      uploadPage.click("button[type='submit']"),
    ]);

    await uploadPage.waitForSelector(".banner.success", { timeout: 10_000 });
    await opts.presentation.pause(1_500);
  } finally {
    await uploadPage.close();
    await ctx.close();
  }
}
