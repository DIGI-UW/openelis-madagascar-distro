/**
 * Session-scoped NDJSON debug ingest for harness diagnosis.
 * Payload shape is fixed so logs sort and grep cleanly.
 */

import type { TestInfo } from "@playwright/test";

export const DEBUG_SESSION_ID = "0246c3";

const INGEST_URL =
  "http://localhost:7356/ingest/dd709e30-65ee-44b3-9fc7-0d27deb0de7e";

export type DebugPhase =
  | "auth"
  | "file-config"
  | "mock-network"
  | "results-poll"
  | "accept-results"
  | "accession-verify"
  | "teardown"
  | "generic";

export type DebugLogPayload = {
  sessionId: typeof DEBUG_SESSION_ID;
  /** Stable category for filtering (e.g. grep phase:accession-verify). */
  phase: DebugPhase;
  /** Short hypothesis or area id, e.g. R3, F3, T1. */
  hypothesisId: string;
  /** file:symbol or path — unambiguous source. */
  location: string;
  /** One-line human summary. */
  message: string;
  runId?: string;
  data?: Record<string, unknown>;
  timestamp: number;
};

/**
 * Fire-and-forget POST to the debug ingest (NDJSON on disk in Cursor).
 */
export function debugLog(payload: Omit<DebugLogPayload, "sessionId" | "timestamp">): void {
  const body: DebugLogPayload = {
    ...payload,
    sessionId: DEBUG_SESSION_ID,
    timestamp: Date.now(),
  };
  fetch(INGEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": DEBUG_SESSION_ID,
    },
    body: JSON.stringify(body),
  }).catch(() => {});
}

/**
 * Attach PNG to HTML report when TestInfo is available (survives teardown navigation).
 */
export async function attachScreenshot(
  testInfo: TestInfo | undefined,
  name: string,
  screenshot: Buffer,
): Promise<void> {
  if (!testInfo) return;
  await testInfo.attach(name, {
    body: screenshot,
    contentType: "image/png",
  });
}
