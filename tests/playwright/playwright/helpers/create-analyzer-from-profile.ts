/**
 * Create an analyzer via the UI using a profile for auto-fill.
 *
 * Handles the full creation flow:
 * 1. (TCP only) Create mock network to get unique analyzer IP
 * 2. Open dashboard → click Add
 * 3. Select plugin type → select profile → fill name
 * 4. (TCP only) Fill IP address and port
 * 5. Save → verify success
 *
 * Returns the IP assigned to the analyzer (for TCP push destinations).
 */

import { execFileSync } from "child_process";
import { Page, expect } from "@playwright/test";
import { AnalyzerFormPage } from "../fixtures/analyzer-form";
import { AnalyzerListPage } from "../fixtures/analyzer-list";
import {
  cleanupAnalyzerById,
  cleanupAnalyzersMatching,
} from "./cleanup-analyzer";
import type { DemoPresentation } from "./demo-presentation";
import type { AnalyzerTestConfig, CreatedAnalyzer } from "./analyzer-test-config";
import { LONG_TIMEOUT } from "./timeouts";
import { resolveDbContainer } from "./db-container";
import { debugLog } from "./debug-instrumentation";

const SIMULATOR_URL = process.env.SIMULATOR_URL || "http://localhost:8085";
const ANALYZER_API_PATH = "/api/OpenELIS-Global/rest/analyzer/analyzers";
const API_READY_TIMEOUT_MS = 15_000;
const API_RETRY_DELAY_MS = 500;

function getAnalyzerApiUrl(): string {
  const baseUrl = (process.env.BASE_URL || "https://localhost").replace(
    /\/$/,
    "",
  );
  return `${baseUrl}${ANALYZER_API_PATH}`;
}

/**
 * Create a mock analyzer network and return the assigned IP.
 * The mock server creates a Docker network with a unique subnet per analyzer,
 * giving each a stable IP for bridge identification.
 */
async function createMockNetwork(
  page: Page,
  mockName: string,
  template: string,
  port: number,
): Promise<string | null> {
  try {
    const response = await page.request.post(`${SIMULATOR_URL}/analyzers`, {
      data: { name: mockName, template, port },
    });
    const status = response.status();
    const textBody = await response.text().catch(() => "");
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
        hypothesisId: "H6",
        location: "helpers/create-analyzer-from-profile.ts:createMockNetwork-post",
        message: "mock create response",
        data: {
          mockName,
          status,
          ok: response.ok(),
          bodySnippet: textBody.slice(0, 300),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    if (response.ok()) {
      const body = JSON.parse(textBody) as { ip?: string };
      await response.dispose();
      return body.ip || null;
    }
    await response.dispose();
    // 409 = already exists, which is fine (idempotent)
    if (status === 409) {
      // Fetch existing
      const listResp = await page.request.get(`${SIMULATOR_URL}/analyzers`);
      const list = listResp.ok() ? await listResp.json() : null;
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
          hypothesisId: "H7",
          location:
            "helpers/create-analyzer-from-profile.ts:createMockNetwork-list",
          message: "mock list fallback response",
          data: {
            mockName,
            listOk: listResp.ok(),
            analyzerCount: Array.isArray(list?.analyzers)
              ? list.analyzers.length
              : -1,
            analyzerShape: Array.isArray(list?.analyzers)
              ? Object.keys(list.analyzers[0] || {})
              : [],
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      await listResp.dispose();
      if (list) {
        const existing = list.analyzers?.find(
          (a: { name: string }) => a.name === mockName,
        );
        return existing?.ip || null;
      }
    }
    return null;
  } catch (error) {
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
        hypothesisId: "H8",
        location:
          "helpers/create-analyzer-from-profile.ts:createMockNetwork-catch",
        message: "mock create threw",
        data: {
          mockName,
          error: error instanceof Error ? error.message.slice(0, 250) : "unknown",
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    try {
      const listResp = await page.request.get(`${SIMULATOR_URL}/analyzers`);
      const list = listResp.ok() ? await listResp.json() : null;
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
          hypothesisId: "H10",
          location:
            "helpers/create-analyzer-from-profile.ts:createMockNetwork-recover",
          message: "mock create recovery list response",
          data: {
            mockName,
            listOk: listResp.ok(),
            analyzerCount: Array.isArray(list?.analyzers)
              ? list.analyzers.length
              : -1,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      await listResp.dispose();
      if (Array.isArray(list?.analyzers)) {
        const existing = list.analyzers.find(
          (a: { name?: string; ip?: string }) => a?.name === mockName,
        );
        if (existing?.ip) {
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
              hypothesisId: "H11",
              location:
                "helpers/create-analyzer-from-profile.ts:createMockNetwork-recover",
              message: "recovered mock ip after create failure",
              data: {
                mockName,
                recoveredIp: existing.ip,
              },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
          return existing.ip;
        }
      }
    } catch {
      // Best-effort recovery only
    }
    return null;
  }
}

/**
 * Remove a mock analyzer network (cleanup).
 */
async function removeMockNetwork(page: Page, mockName: string): Promise<void> {
  try {
    const existing = await page.request.get(`${SIMULATOR_URL}/analyzers`);
    const body = existing.ok() ? await existing.json() : null;
    await existing.dispose();
    if (!body) return;

    const exists = Array.isArray(body?.analyzers)
      ? body.analyzers.some((a: { name?: string }) => a?.name === mockName)
      : false;

    if (!exists) return;

    const delResp = await page.request.delete(
      `${SIMULATOR_URL}/analyzers/${mockName}`,
    );
    await delResp.dispose();
  } catch {
    // Best-effort cleanup
  }
}

async function waitForAnalyzerApiReady(page: Page): Promise<void> {
  const analyzerApiUrl = getAnalyzerApiUrl();

  await expect
    .poll(
      async () => {
        try {
          const response = await page.request.get(analyzerApiUrl);
          const status = response.status();
          await response.dispose();
          return status;
        } catch {
          return 0; // Network can flap while docker networks settle
        }
      },
      {
        message: `Analyzer API at ${analyzerApiUrl} did not become ready`,
        timeout: API_READY_TIMEOUT_MS,
        intervals: [API_RETRY_DELAY_MS],
      },
    )
    .toBe(200);
}

function normalizeAnalyzerId(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

async function findAnalyzerIdByName(
  page: Page,
  analyzerName: string,
): Promise<string | null> {
  const analyzerApiUrl = `${getAnalyzerApiUrl()}?search=${encodeURIComponent(analyzerName)}`;
  const response = await page.request.get(analyzerApiUrl);
  if (!response.ok()) {
    await response.dispose();
    return null;
  }

  try {
    const payload = (await response.json()) as {
      analyzers?: Array<{ id?: string | number; name?: string }>;
    };
    const candidates = (payload.analyzers ?? []).filter(
      (a) => (a.name ?? "").trim() === analyzerName,
    );
    const withIds = candidates
      .map((a) => normalizeAnalyzerId(a.id))
      .filter((id): id is string => Boolean(id));
    if (withIds.length === 0) return null;

    // Newly created analyzers tend to have the highest numeric id.
    const numericIds = withIds
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id));
    if (numericIds.length > 0) {
      return String(Math.max(...numericIds));
    }
    return withIds[withIds.length - 1];
  } finally {
    await response.dispose();
  }
}

async function captureCreatedAnalyzerId(
  page: Page,
  response: Awaited<ReturnType<Page["waitForResponse"]>> | null,
  analyzerName: string,
): Promise<string> {
  if (response) {
    try {
      const body = (await response.json()) as { id?: string | number };
      const id = normalizeAnalyzerId(body.id);
      if (id) return id;
    } catch {
      // Fall through to name-based lookup fallback.
    }
  }

  const fallbackId = await findAnalyzerIdByName(page, analyzerName);
  if (fallbackId) return fallbackId;

  throw new Error(`Could not determine analyzer ID for "${analyzerName}"`);
}

function buildFileImportDirectories(targetDir: string): {
  importDirectory: string;
  archiveDirectory: string;
  errorDirectory: string;
} {
  const normalized = targetDir.replace(/\/+$/, "");
  if (normalized.endsWith("/incoming")) {
    const root = normalized.slice(0, -"incoming".length).replace(/\/+$/, "");
    return {
      importDirectory: normalized,
      archiveDirectory: `${root}/archive`,
      errorDirectory: `${root}/error`,
    };
  }
  return {
    importDirectory: normalized,
    archiveDirectory: `${normalized}/archive`,
    errorDirectory: `${normalized}/error`,
  };
}

export async function createAnalyzerFromProfile(
  page: Page,
  config: AnalyzerTestConfig,
  presentation: DemoPresentation,
): Promise<CreatedAnalyzer> {
  const list = new AnalyzerListPage(page);
  const form = new AnalyzerFormPage(page);

  // Clean up any leftover from a previous failed run
  await cleanupAnalyzersMatching(
    page,
    new RegExp(`^\\s*${escapeRegExp(config.name)}\\s*$`, "i"),
  );
  // Also purge any soft-deleted duplicate rows that can still violate unique constraints.
  hardDeleteAnalyzerFromDb(config.name);

  // For TCP analyzers: create mock network to get a unique IP.
  // Delete any leftover network first (from a previous failed run).
  let assignedIp: string | null = null;
  if (config.protocol !== "FILE" && config.mockAnalyzerName) {
    await removeMockNetwork(page, config.mockAnalyzerName);
    const template =
      config.push.protocol === "ASTM" || config.push.protocol === "HL7"
        ? (config.push as { template: string }).template
        : "";
    const port = config.port || 0;
    assignedIp = await createMockNetwork(
      page,
      config.mockAnalyzerName,
      template,
      port,
    );
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
        hypothesisId: "H5",
        location: "helpers/create-analyzer-from-profile.ts:mock-network",
        message: "mock network assigned",
        data: {
          analyzerName: config.name,
          mockAnalyzerName: config.mockAnalyzerName,
          assignedIp,
          port,
          protocol: config.protocol,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

    // Creating/attaching docker networks can briefly destabilize connectivity.
    await waitForAnalyzerApiReady(page);
  }

  await list.goto();
  await list.expectLoaded();
  await presentation.pause(500);

  await list.clickAdd();
  await form.expectOpen();

  // Select plugin type
  await form.selectPluginType(config.pluginType);
  await presentation.pause(500);

  // Select profile (auto-fills fields)
  if (config.profileName) {
    await form.selectDefaultConfig(config.profileName);
    await presentation.pause(500);
  }

  // Select analyzer type (may already be set by profile)
  await form.selectType(config.analyzerType);

  // Fill name
  await form.fillName(config.name);
  await presentation.pause(500);

  // Fill file import directories for FILE analyzers (in the unified form, before save)
  if (config.protocol === "FILE" && config.push.targetDir) {
    const dirs = buildFileImportDirectories(config.push.targetDir);
    await form.fillImportDirectory(dirs.importDirectory);
    await form.fillArchiveDirectory(dirs.archiveDirectory);
    await form.fillErrorDirectory(dirs.errorDirectory);
    await presentation.pause(500);
  }

  // Fill IP and port for TCP analyzers
  if (config.protocol !== "FILE") {
    const harnessIp = assignedIp || null;
    const harnessPort = config.port;
    if (!harnessIp || !harnessPort) {
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
          hypothesisId: "H9",
          location: "helpers/create-analyzer-from-profile.ts:tcp-required-values",
          message: "missing required harness TCP values",
          data: {
            analyzerName: config.name,
            protocol: config.protocol,
            harnessIp,
            harnessPort: harnessPort ?? null,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      throw new Error(
        `Harness TCP values are required for ${config.name}: ip=${harnessIp ?? "missing"}, port=${harnessPort ?? "missing"}`,
      );
    }

    await form.fillIpAddress(harnessIp);
    await form.fillPort(String(harnessPort));
    await presentation.pause(500);
  }

  // Save
  await waitForAnalyzerApiReady(page);
  const createResponsePromise = page
    .waitForResponse(
      (resp) =>
        resp.url().includes(ANALYZER_API_PATH) &&
        resp.request().method() === "POST",
      { timeout: LONG_TIMEOUT },
    )
    .catch(() => null);
  await form.save();
  await form.expectSuccessNotification();

  // Wait for modal to close
  await expect(form.modal).not.toBeVisible({ timeout: LONG_TIMEOUT });
  await presentation.pause(1_000);
  const createResponse = await createResponsePromise;
  const analyzerId = await captureCreatedAnalyzerId(
    page,
    createResponse,
    config.name,
  );

  return { analyzerId, assignedIp };
}

/**
 * Delete an analyzer via the UI dashboard (teardown).
 */
export async function deleteAnalyzerFromDashboard(
  page: Page,
  analyzerName: string,
  analyzerId?: string,
): Promise<void> {
  if (analyzerId) {
    await cleanupAnalyzerById(page, analyzerId);
    return;
  }
  await cleanupAnalyzersMatching(
    page,
    new RegExp(`^\\s*${escapeRegExp(analyzerName)}\\s*$`, "i"),
  );
}

/**
 * Full cleanup: soft-delete via UI (tests production flow) → SQL cleanup
 * (test isolation) → remove mock network.
 */
export async function teardownAnalyzer(
  page: Page,
  config: AnalyzerTestConfig,
  analyzerId?: string,
): Promise<void> {
  // Step 1: Soft-delete via UI (tests the production user flow).
  // If this fails, continue with DB cleanup to avoid polluting subsequent runs.
  try {
    await deleteAnalyzerFromDashboard(page, config.name, analyzerId);
  } catch (error) {
    console.warn(`UI delete failed for "${config.name}", continuing with DB cleanup: ${error}`);
  }

  // Step 2: SQL cleanup (test isolation), regardless of UI delete outcome.
  hardDeleteAnalyzerFromDb(config.name, analyzerId);

  // Step 3: Remove mock network
  if (config.mockAnalyzerName) {
    await removeMockNetwork(page, config.mockAnalyzerName);
  }
}

/** Escape a value for use inside a PostgreSQL single-quoted literal. */
function escapePgStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function analyzerIdSqlLiteral(analyzerId: string): string {
  const numeric = Number(analyzerId);
  return Number.isFinite(numeric)
    ? String(numeric)
    : escapePgStringLiteral(analyzerId);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Hard-delete analyzer rows after UI soft-delete (test isolation).
 * Clear analysis.analyzer_id first (fk_analysis_analyzer); then analyzer_results;
 * analyzer_test_map CASCADE handles mappings when analyzer is removed.
 */
function hardDeleteAnalyzerFromDb(analyzerName: string, analyzerId?: string): void {
  const container = resolveDbContainer();
  const sql = analyzerId
    ? `UPDATE clinlims.analysis SET analyzer_id = NULL WHERE analyzer_id = ${analyzerIdSqlLiteral(analyzerId)}; DELETE FROM clinlims.analyzer_results WHERE analyzer_id = ${analyzerIdSqlLiteral(analyzerId)}; DELETE FROM clinlims.analyzer WHERE id = ${analyzerIdSqlLiteral(analyzerId)};`
    : `UPDATE clinlims.analysis SET analyzer_id = NULL WHERE analyzer_id IN (SELECT id FROM clinlims.analyzer WHERE name = ${escapePgStringLiteral(analyzerName)}); DELETE FROM clinlims.analyzer_results WHERE analyzer_id IN (SELECT id FROM clinlims.analyzer WHERE name = ${escapePgStringLiteral(analyzerName)}); DELETE FROM clinlims.analyzer WHERE name = ${escapePgStringLiteral(analyzerName)};`;
  const dockerArgs = [
    "exec",
    "-i",
    container,
    "psql",
    "-U",
    "clinlims",
    "-d",
    "clinlims",
    "-c",
    sql,
  ];
  // Most CI/dev environments here require sudo for Docker socket access.
  try {
    execFileSync("sudo", ["docker", ...dockerArgs]);
    return;
  } catch (sudoError) {
    try {
      execFileSync("docker", dockerArgs);
      return;
    } catch (dockerError) {
      console.warn(
        `DB cleanup failed for "${analyzerName}": ${sudoError}; fallback error: ${dockerError}`,
      );
    }
  }
}
