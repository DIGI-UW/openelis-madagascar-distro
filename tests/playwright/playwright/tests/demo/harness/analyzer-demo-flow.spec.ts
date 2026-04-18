/**
 * Unified Madagascar Analyzer Demo Flows
 *
 * Each test exercises the full E2E lifecycle:
 *   1. Create analyzer from profile via dashboard UI
 *   2. Test connection (TCP analyzers only)
 *   3. Push a result via mock server (ASTM, HL7, or FILE)
 *   4. Verify results appear on the AnalyzerResults page
 *   5. Accept results and verify on AccessionResults page
 *   6. Delete analyzer (teardown)
 *
 * The mock server is the single source of truth for all analyzer interactions.
 * It owns the fixture files, delivers results, and returns metadata.
 * Tests never hardcode expected values — they come from the mock response.
 */

import { expect, test } from "../../../helpers/test-base";
import { createDemoPresentation } from "../../../helpers/demo-presentation";
import {
  findAnalyzerRowById,
} from "../../../helpers/analyzer-dashboard";
import {
  createAnalyzerFromProfile,
  teardownAnalyzer,
} from "../../../helpers/create-analyzer-from-profile";
import { testAnalyzerConnection } from "../../../helpers/test-analyzer-connection";
import { pushAnalyzerResult } from "../../../helpers/push-analyzer-result";
import { dropRealAnalyzerFileViaBridgeUI } from "../../../helpers/drop-real-analyzer-file";
import { acceptAndVerifyResults } from "../../../helpers/accept-results";
import { validateResults } from "../../../helpers/validate-results";
import {
  accessionTextRegExp,
  expectResultVisible,
  openAnalyzerResultsByIdAndWaitForText,
} from "../../../helpers/results-ui";
import { LONG_TIMEOUT, TEST_TIMEOUT, UI_TIMEOUT } from "../../../helpers/timeouts";
import type {
  AnalyzerTestConfig,
  PushResult,
} from "../../../helpers/analyzer-test-config";
import { buildRunScopedFileTargetDir } from "../../../helpers/file-target-dir";
import { debugLog } from "../../../helpers/debug-instrumentation";

const SIMULATOR_URL = process.env.SIMULATOR_URL || "http://localhost:8085";
const RESULTS_TIMEOUT = 90_000;

// ── Analyzer Configurations ──────────────────────────────────────
//
// Every config creates from scratch via UI and tears down after.
// Names use "Demo:" prefix to coexist with pre-seeded analyzers.
//
// No hardcoded expectedResults — the mock server returns them.

const CONFIGS: AnalyzerTestConfig[] = [
  {
    name: "Demo: GeneXpert ASTM",
    displayName: "GeneXpert ASTM",
    analyzerType: "MOLECULAR",
    pluginType: "Generic ASTM",
    profileName: "Cepheid GeneXpert (ASTM Mode)",
    protocol: "ASTM",
    mockAnalyzerName: "demo-genexpert",
    port: 9600,
    push: {
      protocol: "ASTM",
      simulatorUrl: SIMULATOR_URL,
      template: "genexpert_astm",
      destination: "tcp://placeholder:12001",
    },
  },
  {
    name: "Demo: Mindray BC-5380",
    displayName: "Mindray BC-5380 (HL7 Hematology)",
    analyzerType: "HEMATOLOGY",
    pluginType: "Generic HL7",
    profileName: "Mindray BC-5380",
    protocol: "HL7",
    mockAnalyzerName: "demo-bc5380",
    port: 5380,
    push: {
      protocol: "HL7",
      simulatorUrl: SIMULATOR_URL,
      template: "mindray_bc5380",
      destination: "mllp://placeholder:2575",
    },
  },
  {
    name: "Demo: Mindray BS-200",
    displayName: "Mindray BS-200 (HL7 Chemistry)",
    analyzerType: "CHEMISTRY",
    pluginType: "Generic HL7",
    profileName: "Mindray BS-200",
    protocol: "HL7",
    mockAnalyzerName: "demo-bs200",
    port: 6001,
    push: {
      protocol: "HL7",
      simulatorUrl: SIMULATOR_URL,
      template: "mindray_bs200",
      destination: "mllp://placeholder:2575",
    },
  },
  {
    name: "Demo: Mindray BS-300",
    displayName: "Mindray BS-300 (HL7 Chemistry)",
    analyzerType: "CHEMISTRY",
    pluginType: "Generic HL7",
    profileName: "Mindray BS-300",
    protocol: "HL7",
    mockAnalyzerName: "demo-bs300",
    port: 6002,
    push: {
      protocol: "HL7",
      simulatorUrl: SIMULATOR_URL,
      template: "mindray_bs300",
      destination: "mllp://placeholder:2575",
    },
  },
  // ── FILE Analyzers (Gate 1: real-file upload via bridge /admin/upload UI) ──
  //
  // These configs use realFileSourcePath to drive the bridge upload UI
  // with the real LA2M file instead of the mock push.
  // uploadTestCode is OPTIONAL per-file metadata — only needed when the
  // file has NO per-row test labels (e.g. FluoroCycler). Files with
  // per-row labels (QuantStudio Target Name) omit it and let the parser
  // read test identity from each row.
  {
    name: "Demo: QuantStudio 7",
    displayName: "QuantStudio 7 (FILE/Excel)",
    analyzerType: "MOLECULAR",
    pluginType: "Generic File",
    profileName: "QuantStudio QS5/QS7",
    protocol: "FILE",
    push: {
      protocol: "FILE",
      simulatorUrl: SIMULATOR_URL,
      template: "quantstudio7",
      targetDir: "/data/analyzer-imports/demo--quantstudio-7/incoming",
    },
    // QS7 has per-row Target Name column — each row carries its own
    // test identity. No form-level uploadTestCode needed (optional
    // metadata left blank so the parser uses per-row labels).
    realFileSourcePath: `${process.env.ANALYZER_HOST_MOUNT ?? "/mnt"}/la2m/central/analyzers_results/QuantStudio-7/archive/CVVIH 24 07 2024 serie 02 à valider.xlsx`,
  },
  {
    name: "Demo: QuantStudio 5",
    displayName: "QuantStudio 5 (FILE/Excel)",
    analyzerType: "MOLECULAR",
    pluginType: "Generic File",
    profileName: "QuantStudio QS5/QS7",
    protocol: "FILE",
    push: {
      protocol: "FILE",
      simulatorUrl: SIMULATOR_URL,
      template: "quantstudio5",
      targetDir: "/data/analyzer-imports/demo--quantstudio-5/incoming",
    },
    // QS5 Arbo: per-row Target Name for CHIKV/DENV/ZIKV. No form-level
    // uploadTestCode needed — parser reads per-row labels.
    realFileSourcePath: `${process.env.ANALYZER_HOST_MOUNT ?? "/mnt"}/la2m/central/analyzers_results/QuantStudio-5/Arbo-extraitQS5.xls`,
  },
  {
    name: "Demo: FluoroCycler XT",
    displayName: "FluoroCycler XT HIV VL (FILE/ODS)",
    analyzerType: "MOLECULAR",
    pluginType: "Generic File",
    profileName: "Bruker FluoroCycler XT",
    protocol: "FILE",
    push: {
      protocol: "FILE",
      simulatorUrl: SIMULATOR_URL,
      template: "hain_fluorocycler",
      targetDir: "/data/analyzer-imports/demo--fluorocycler-xt/incoming",
    },
    realFileSourcePath: `${process.env.ANALYZER_HOST_MOUNT ?? "/mnt"}/la2m/central/analyzers_results/Fluorocycler-XT/result-septembre.ods`,
    uploadTestCode: "VIH-1",
  },
  // ── Madagascar Sprint: 3 New FILE Analyzers ────────────────────
  {
    name: "Demo: Wondfo Finecare FS-205",
    displayName: "Wondfo Finecare FS-205 (FILE/CSV — POCT)",
    analyzerType: "IMMUNOLOGY",
    pluginType: "Generic File",
    profileName: "Wondfo Finecare FS-205 (CSV)",
    protocol: "FILE",
    push: {
      protocol: "FILE",
      simulatorUrl: SIMULATOR_URL,
      template: "wondfo_finecare",
      targetDir: "/data/analyzer-imports/demo--wondfo-finecare-fs-205/incoming",
    },
  },
  {
    name: "Demo: Tecan Infinite F50",
    displayName: "Tecan Infinite F50 (FILE/CSV — ELISA)",
    analyzerType: "IMMUNOLOGY",
    pluginType: "Generic File",
    profileName: "Tecan Infinite F50",
    protocol: "FILE",
    push: {
      protocol: "FILE",
      simulatorUrl: SIMULATOR_URL,
      template: "tecan_f50",
      targetDir: "/data/analyzer-imports/demo--tecan-infinite-f50/incoming",
    },
    realFileSourcePath: `${process.env.ANALYZER_HOST_MOUNT ?? "/mnt"}/la2m/central/analyzers_results/ELISA reader Tecan Infinite F50/Tecan-F50_HIV-result.csv`,
  },
  {
    name: "Demo: Thermo Multiskan FC",
    displayName: "Thermo Multiskan FC (FILE/CSV — Dengue IgG ELISA)",
    analyzerType: "IMMUNOLOGY",
    pluginType: "Generic File",
    profileName: "Thermo Multiskan FC",
    protocol: "FILE",
    push: {
      protocol: "FILE",
      simulatorUrl: SIMULATOR_URL,
      template: "multiskan_fc",
      targetDir: "/data/analyzer-imports/demo--thermo-multiskan-fc/incoming",
    },
    realFileSourcePath: `${process.env.ANALYZER_HOST_MOUNT ?? "/mnt"}/la2m/central/analyzers_results/ELISA reader Multiscan FC/Multiskan-FC_Dengue-result.csv`,
    uploadTestCode: "Dengue IgG",
  },
];

// ── Unified Test Flow ────────────────────────────────────────────

async function verifyResults(
  page: import("@playwright/test").Page,
  analyzerId: string,
  pushResults: PushResult[],
  primarySampleId: string,
  presentation: import("../../../helpers/demo-presentation").DemoPresentation,
) {
  if (pushResults.length === 0) {
    await presentation.step(
      "Polling /rest/AnalyzerResults?id=<id> for real-file results...",
    );
    await openAnalyzerResultsByIdAndWaitForText(page, analyzerId, "", {
      timeoutMs: RESULTS_TIMEOUT,
      perAttemptTimeoutMs: LONG_TIMEOUT,
      allExpectedAccessions: [],
    });
    const resultsRegion = page.locator(".orderLegendBody, table").first();
    await expect(resultsRegion).toBeVisible({ timeout: UI_TIMEOUT });
    await presentation.pause(2_000);
    return;
  }

  const allAccessions = pushResults
    .map((r) => r.sampleId || primarySampleId)
    .filter((v, i, a) => a.indexOf(v) === i);

  await openAnalyzerResultsByIdAndWaitForText(page, analyzerId, primarySampleId, {
    timeoutMs: RESULTS_TIMEOUT,
    perAttemptTimeoutMs: LONG_TIMEOUT,
    allExpectedAccessions: allAccessions,
  });

  const resultsRegion = page.locator(".orderLegendBody, table").first();
  await expect(resultsRegion).toBeVisible({ timeout: UI_TIMEOUT });

  for (const expected of pushResults) {
    const expectedSampleId = expected.sampleId || primarySampleId;
    await expect(
      resultsRegion.getByText(accessionTextRegExp(expectedSampleId)).first(),
    ).toBeVisible({ timeout: LONG_TIMEOUT });
    if (expected.result) {
      await expectResultVisible(resultsRegion, expected.result);
    }
  }

  await presentation.pause(2_000);
}

// ── Test Suite ───────────────────────────────────────────────────

test.describe("Madagascar analyzer demo flows", () => {
  // Per-step waits (UI_TIMEOUT, LONG_TIMEOUT, NAV_TIMEOUT) bound individual
  // interactions; this caps the whole flow. Stalls surface fast instead of
  // burning minutes on hung tests.
  test.setTimeout(TEST_TIMEOUT);

  for (const config of CONFIGS) {
    test(`${config.displayName}: full E2E flow`, async ({ page }, testInfo) => {
      const presentation = createDemoPresentation(page, testInfo);
      let analyzerId: string | undefined;
      let dynamicIp: string | null = null;
      const runConfig: AnalyzerTestConfig =
        config.protocol === "FILE" && config.push.targetDir
          ? {
              ...config,
              push: {
                ...config.push,
                targetDir: buildRunScopedFileTargetDir(config.push.targetDir),
              },
            }
          : config;

      let testFailed = false;
      try {
        await presentation.title(
          config.displayName,
          `${config.protocol} → Bridge → OpenELIS → Review → Accept`,
        );

        // Step 1: Create analyzer from profile via dashboard UI
        await presentation.step(
          1,
          `Create ${config.name} from profile via dashboard`,
        );
        const created = await createAnalyzerFromProfile(
          page,
          runConfig,
          presentation,
        );
        analyzerId = created.analyzerId;
        dynamicIp = created.assignedIp;
        await findAnalyzerRowById(page, analyzerId, testInfo);
        await presentation.evidence(`demo-01-analyzer-created-${config.name}`);

        // Step 2: Test connection is optional for demo harness flows.
        if (config.requireConnectionTest !== false) {
          await presentation.step(2, "Test analyzer connection");
          const analyzerRow = await findAnalyzerRowById(page, analyzerId, testInfo);
          await testAnalyzerConnection(page, analyzerRow, presentation);
        }

        const hasTestConnection = config.requireConnectionTest !== false;
        let step = hasTestConnection ? 3 : 2;

        // Override push destination with dynamic bridge IP for TCP analyzers
        let pushConfig = config.push;
        if (runConfig.protocol === "FILE") {
          pushConfig = runConfig.push;
        }
        if (config.protocol !== "FILE") {
          if (!dynamicIp) {
            throw new Error(
              `Harness dynamic IP is required for TCP push destination in ${config.name}`,
            );
          }
          const bridgeIp = dynamicIp.replace(/\.\d+$/, ".2");
          const port = config.protocol === "ASTM" ? 12001 : 2575;
          const scheme = config.protocol === "ASTM" ? "tcp" : "mllp";
          pushConfig = {
            ...pushConfig,
            destination: `${scheme}://${bridgeIp}:${port}`,
          };
        }

        // Step 3: Push result — either via bridge upload UI (real-file
        // drop for Gate 1 FILE videos) or via mock server (everything else)
        let pushResults;
        let primarySampleId: string;
        if (config.realFileSourcePath && analyzerId) {
          await presentation.step(
            step,
            `Upload real file ${config.realFileSourcePath.split("/").pop()} via bridge /admin/upload`,
          );
          const safeName = config.name.replace(/[^a-zA-Z0-9._-]/g, "-");
          await dropRealAnalyzerFileViaBridgeUI(page, {
            analyzerId,
            testCode: config.uploadTestCode,
            sourcePath: config.realFileSourcePath,
            presentation,
            configName: safeName,
          });
          // With a real-file upload there is no mock-provided sample id
          // list — sample IDs are whatever the real file contains. For
          // Gate 1 we do a weaker verification: "at least one result
          // row appeared in staging for this analyzer". Stronger
          // accession-level matching is deferred to Gate 2.
          pushResults = [];
          primarySampleId = "";
        } else {
          await presentation.step(
            step,
            `Send ${config.protocol} result → Bridge → OpenELIS`,
          );
          pushResults = await pushAnalyzerResult(
            page,
            pushConfig,
            presentation,
          );
          expect(
            pushResults.length,
            `Mock should return at least 1 result for ${config.name}`,
          ).toBeGreaterThan(0);
          primarySampleId = pushResults[0].sampleId;
          expect(
            primarySampleId,
            `Mock should return a sampleId for ${config.name}`,
          ).toBeTruthy();
        }

        // Step 4: Wait for results from bridge
        step++;
        await presentation.step(
          step,
          "Waiting for results from analyzer bridge...",
        );
        await verifyResults(
          page,
          analyzerId,
          pushResults,
          primarySampleId,
          presentation,
        );
        await presentation.evidence(
          `demo-04-results-in-staging-${config.name}`,
        );

        await presentation.step(step, "Results staged — ready to accept");
        await presentation.pause(3_000);

        // Step 5: Accept results
        const safeConfigName = config.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        await acceptAndVerifyResults(
          page,
          presentation,
          step,
          primarySampleId,
          testInfo,
          3,
          safeConfigName,
        );

        // Step 6: Validate results on the "Ready for Validation" screen.
        // This is the regression guard for OE PR #3372 — validates that
        // dict-typed results render without throwing FloatingDecimal
        // NumberFormatException. When primarySampleId is empty (real-file
        // uploads), pick the first accession visible on the AnalyzerResults
        // page instead.
        const accessionForValidation = primarySampleId || await (async () => {
          const firstLabNo = page.locator('[data-testid="LabNo"]').first();
          try {
            const text = await firstLabNo.textContent({ timeout: 5_000 });
            return text?.trim() || "";
          } catch {
            return "";
          }
        })();

        if (accessionForValidation) {
          await validateResults(
            page,
            presentation,
            step + 4,
            accessionForValidation,
            testInfo,
            safeConfigName,
          );
        }

        await presentation.title(
          "Flow Complete",
          `${config.displayName}: ${pushResults.length} results accepted and validated.`,
        );
      } catch (e) {
        testFailed = true;
        throw e;
      } finally {
        debugLog({
          phase: "teardown",
          hypothesisId: "T1",
          location:
            "tests/demo/harness/analyzer-demo-flow.spec.ts:finally-before-teardown",
          message: testFailed
            ? "SKIPPING teardown — test failed. DB + bridge state preserved for diagnosis. Run `./scripts/restart-stack.sh --clean` before the next iteration."
            : "Running teardown on success path",
          runId: "harness-demo",
          data: {
            analyzerId: analyzerId ?? null,
            testFailed,
            urlBeforeTeardown: (() => {
              try {
                return page.url();
              } catch {
                return "(page unavailable)";
              }
            })(),
          },
        });
        if (!testFailed || process.env.PRESERVE_FAILURE_STATE === "0") {
          await teardownAnalyzer(page, runConfig, analyzerId);
        }
      }
    });
  }
});
