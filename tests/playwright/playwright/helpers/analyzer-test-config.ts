/**
 * Configuration types for unified analyzer E2E demo tests.
 *
 * Each config describes one analyzer's full test flow:
 * create → test connection → push result → verify → accept
 *
 * All protocols (ASTM, HL7, FILE) push through the mock server.
 * The mock returns metadata (sample IDs, results) — tests never
 * hardcode expected values.
 */

export type AnalyzerProtocol = "ASTM" | "HL7" | "FILE";

/**
 * Push config for all protocols. The mock server handles everything:
 * - ASTM: POST /simulate/astm/{template} → pushes via TCP
 * - HL7:  POST /simulate/hl7/{template}  → pushes via MLLP
 * - FILE: POST /simulate/file/{template} → drops fixture into watched folder
 *
 * All return metadata including sample IDs and results.
 */
export interface PushConfig {
  protocol: AnalyzerProtocol;
  simulatorUrl: string;
  /** Mock server template name (e.g., "quantstudio7", "genexpert_astm"). */
  template: string;
  /** TCP/MLLP destination (ASTM/HL7 only). */
  destination?: string;
  /** Container path for file drop (FILE only, e.g., "/data/analyzer-imports/quantstudio-7/incoming"). */
  targetDir?: string;
  /** Explicit sample ID override (optional — mock generates if omitted). */
  sampleId?: string;
}

/** Result metadata returned by the mock server after a push. */
export interface PushResult {
  sampleId: string;
  result: string;
  testCode?: string;
}

export interface AnalyzerTestConfig {
  /** Analyzer name as it appears in the list (must match seeded name). */
  name: string;
  /** Display name for demo title cards. */
  displayName: string;
  /** Analyzer category: HEMATOLOGY, CHEMISTRY, MOLECULAR, etc. */
  analyzerType: string;
  /** Plugin type label for the dropdown: "Generic HL7", "Generic ASTM", "Generic File". */
  pluginType: string;
  /** Profile name for the default config dropdown (e.g., "QuantStudio", "Mindray"). */
  profileName?: string;
  /** Protocol family. */
  protocol: AnalyzerProtocol;
  /** How to push a result (all protocols go through mock server). */
  push: PushConfig;
  /** IP address for TCP analyzers (filled in UI form when creating). */
  ipAddress?: string;
  /** Port for TCP analyzers (filled in UI form when creating). */
  port?: number;
  /** Mock analyzer name for dynamic network creation (if different from name). */
  mockAnalyzerName?: string;
  /** Whether this scenario requires explicit "Test Connection" success. */
  requireConnectionTest?: boolean;
  /**
   * Test code the Playwright helper will select from the bridge upload UI's
   * Test dropdown at drop time. Event-scoped per upload, NOT persisted on
   * the analyzer instance (no such config field exists post-v4 revert —
   * the scalar Analyzer.defaultTestCode column was removed for being a
   * persistent test-identity assertion). Used by the drop-real-analyzer-file
   * helper when a FILE analyzer's result file has no per-row target column
   * and needs per-file declaration (e.g. Bruker Fluorocycler XT HIV VL →
   * "VIH-1"). Leave unset when the file's column_mapping provides a per-row
   * target (QuantStudio QS5/QS7) — the upload UI still requires a test
   * selection, but the parser's per-row path wins for rows that carry
   * their own Target Name.
   */
  uploadTestCode?: string;

  /**
   * Absolute path (inside the demo-tests container) to a real analyzer
   * result file that should be uploaded via the bridge /admin/upload UI
   * instead of via the mock server. When set, the harness uses the
   * drop-real-analyzer-file helper to drive the bridge upload UI
   * end-to-end (real file + real tech declaration), bypassing the mock
   * push path. Resolved at runtime via ${ANALYZER_HOST_MOUNT:-/mnt}
   * bind mount (docker-compose.validate.yml). Plan §2.5d.
   */
  realFileSourcePath?: string;
}

/** Runtime analyzer metadata captured after UI create. */
export interface CreatedAnalyzer {
  analyzerId: string;
  assignedIp: string | null;
}
