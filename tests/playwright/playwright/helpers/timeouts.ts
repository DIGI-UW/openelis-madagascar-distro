/** Conditional checks, dropdown options, negative assertions (element absent) */
export const QUICK_TIMEOUT = 2_000;

/** Element attachment, visibility, enabled checks */
export const SHORT_TIMEOUT = 5_000;

/** Post-action UI state assertions (state changes after clicks/saves) */
export const UI_TIMEOUT = 10_000;

/** Page navigation, cross-page verification, form submissions */
export const LONG_TIMEOUT = 30_000;

/** Full page load, auth flows, initial bootstrap */
export const NAV_TIMEOUT = 45_000;

/**
 * Test-level budget for a full E2E analyzer demo flow (create analyzer →
 * mock/real push → staging → accept → AccessionResults → teardown).
 * Per-step waits (UI_TIMEOUT, LONG_TIMEOUT, NAV_TIMEOUT) bound individual
 * interactions; this caps the whole flow so stalls surface fast. If a test
 * hits this, it's a real bug, not a slow build.
 */
export const TEST_TIMEOUT = 180_000;
