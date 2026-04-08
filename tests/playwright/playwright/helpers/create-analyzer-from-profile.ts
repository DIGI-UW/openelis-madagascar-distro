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

const SIMULATOR_URL = process.env.SIMULATOR_URL || "http://localhost:8085";
const ANALYZER_API_PATH = "/api/OpenELIS-Global/rest/analyzer/analyzers";
const FILE_IMPORT_API_PATH = "/api/OpenELIS-Global/rest/analyzer/file-import/configurations";
const API_READY_TIMEOUT_MS = 15_000;
const API_RETRY_DELAY_MS = 500;

function getAnalyzerApiUrl(): string {
  const baseUrl = (process.env.BASE_URL || "https://localhost").replace(
    /\/$/,
    "",
  );
  return `${baseUrl}${ANALYZER_API_PATH}`;
}

function getFileImportApiUrl(): string {
  const baseUrl = (process.env.BASE_URL || "https://localhost").replace(
    /\/$/,
    "",
  );
  return `${baseUrl}${FILE_IMPORT_API_PATH}`;
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
    if (response.ok()) {
      const body = await response.json();
      await response.dispose();
      return body.ip || null;
    }
    const status = response.status();
    await response.dispose();
    // 409 = already exists, which is fine (idempotent)
    if (status === 409) {
      // Fetch existing
      const listResp = await page.request.get(`${SIMULATOR_URL}/analyzers`);
      const list = listResp.ok() ? await listResp.json() : null;
      await listResp.dispose();
      if (list) {
        const existing = list.analyzers?.find(
          (a: { name: string }) => a.name === mockName,
        );
        return existing?.ip || null;
      }
    }
    return null;
  } catch {
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

type FileImportConfigPayload = {
  id?: string;
  analyzerId: number;
  importDirectory: string;
  archiveDirectory: string;
  errorDirectory: string;
  filePattern: string;
  fileFormat: string;
  columnMappings: Record<string, string>;
  delimiter: string;
  hasHeader: boolean;
  active: boolean;
};

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

async function updateFileImportDirectory(
  page: Page,
  analyzerId: string,
  targetDir: string,
): Promise<void> {
  const analyzerIdInt = Number(analyzerId);
  if (!Number.isFinite(analyzerIdInt)) {
    throw new Error(`Analyzer ID "${analyzerId}" is not numeric for FILE config`);
  }

  const cfgBase = getFileImportApiUrl();
  const existingResp = await page.request.get(
    `${cfgBase}/analyzer/${analyzerIdInt}`,
    { timeout: LONG_TIMEOUT },
  );

  if (!existingResp.ok()) {
    const status = existingResp.status();
    await existingResp.dispose();
    throw new Error(
      `Failed to load FILE config for analyzer ${analyzerIdInt} (HTTP ${status})`,
    );
  }

  const existing = (await existingResp.json()) as FileImportConfigPayload;
  await existingResp.dispose();
  if (!existing.id) {
    throw new Error(`Analyzer ${analyzerIdInt} FILE config does not include id`);
  }

  const dirs = buildFileImportDirectories(targetDir);
  const payload: FileImportConfigPayload = {
    ...existing,
    analyzerId: analyzerIdInt,
    importDirectory: dirs.importDirectory,
    archiveDirectory: dirs.archiveDirectory,
    errorDirectory: dirs.errorDirectory,
  };

  const putResp = await page.request.put(`${cfgBase}/${existing.id}`, {
    data: payload,
    timeout: LONG_TIMEOUT,
  });
  if (!putResp.ok()) {
    const status = putResp.status();
    const body = await putResp.text();
    await putResp.dispose();
    throw new Error(
      `Failed to update FILE config directory for analyzer ${analyzerIdInt} (HTTP ${status}): ${body}`,
    );
  }
  await putResp.dispose();
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

  // Fill IP and port for TCP analyzers
  if (config.protocol !== "FILE") {
    const ip = assignedIp || config.ipAddress;
    if (ip) {
      await form.fillIpAddress(ip);
    }
    if (config.port) {
      await form.fillPort(String(config.port));
    }
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

  if (config.protocol === "FILE" && config.push.targetDir) {
    await updateFileImportDirectory(page, analyzerId, config.push.targetDir);
  }

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
  // Step 1: Soft-delete via UI (tests the production user flow)
  await deleteAnalyzerFromDashboard(page, config.name, analyzerId);

  // Step 2: SQL cleanup of the soft-deleted row (test isolation)
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
 * CASCADE FK on analyzer_test_map handles test mapping cleanup automatically.
 */
function hardDeleteAnalyzerFromDb(analyzerName: string, analyzerId?: string): void {
  const container = resolveDbContainer();
  const sql = analyzerId
    ? `DELETE FROM clinlims.analyzer_results WHERE analyzer_id = ${analyzerIdSqlLiteral(analyzerId)}; DELETE FROM clinlims.analyzer WHERE id = ${analyzerIdSqlLiteral(analyzerId)};`
    : `DELETE FROM clinlims.analyzer_results WHERE analyzer_id IN (SELECT id FROM clinlims.analyzer WHERE name = ${escapePgStringLiteral(analyzerName)}); DELETE FROM clinlims.analyzer WHERE name = ${escapePgStringLiteral(analyzerName)};`;
  try {
    execFileSync("docker", [
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
    ]);
  } catch (e) {
    console.warn(`DB cleanup failed for "${analyzerName}": ${e}`);
  }
}
