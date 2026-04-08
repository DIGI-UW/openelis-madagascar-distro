import { test as setup, expect } from "@playwright/test";
import { SHORT_TIMEOUT, LONG_TIMEOUT, NAV_TIMEOUT } from "../helpers/timeouts";

const AUTH_FILE = "playwright/.auth/user.json";

/**
 * Shared authentication setup for all Playwright projects.
 *
 * Flow:
 *   1. Verify backend health (API responds, not just HTML shell)
 *   2. Login via Playwright request API (ValidateLogin endpoint)
 *   3. Inject the authenticated JSESSIONID into the browser context
 *   4. Navigate to verify authenticated state
 *   5. Save storage state for downstream tests
 *
 * Why request API + cookie injection:
 *   - The React login page creates an anonymous JSESSIONID on mount.
 *     Spring Security's session fixation protection rejects credentials
 *     when a prior session exists → UI form login fails from Playwright.
 *   - The request API avoids this, but its JSESSIONID has path=/api/...
 *     which doesn't cover frontend routes.
 *   - Solution: authenticate via request API, extract the JSESSIONID,
 *     and add it to the browser context with path=/ so all routes work.
 */
setup("authenticate", async ({ page, request, context }, testInfo) => {
  testInfo.setTimeout(NAV_TIMEOUT);
  const baseUrl = process.env.BASE_URL || "https://localhost";
  let healthAttempts = 0;

  const username = process.env.TEST_USER;
  const password = process.env.TEST_PASS;
  page.on("response", (resp) => {
    const url = resp.url();
    if (
      url.includes("/api/OpenELIS-Global/session") ||
      url.includes("/login")
    ) {
      // #region agent log
      fetch("http://localhost:7356/ingest/dd709e30-65ee-44b3-9fc7-0d27deb0de7e", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Session-Id": "0246c3",
        },
        body: JSON.stringify({
          sessionId: "0246c3",
          runId: "auth-postfix",
          hypothesisId: "A5",
          location: "tests/auth.setup.ts:page-response",
          message: "auth-related page response",
          data: {
            url,
            status: resp.status(),
            ok: resp.ok(),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
    }
  });

  // #region agent log
  fetch("http://localhost:7356/ingest/dd709e30-65ee-44b3-9fc7-0d27deb0de7e", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "0246c3",
    },
    body: JSON.stringify({
      sessionId: "0246c3",
      runId: "auth-pre",
      hypothesisId: "A1",
      location: "tests/auth.setup.ts:entry",
      message: "auth setup start",
      data: {
        baseUrl,
        hasUser: !!username,
        hasPass: !!password,
        ci: !!process.env.CI,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  if (!username || !password) {
    throw new Error(
      "TEST_USER and TEST_PASS environment variables must be set.\n" +
        "  Source .env from repo root: set -a; . .env; set +a\n" +
        "  Or use ANSI-C quoting: export TEST_PASS=$'adminADMIN!'",
    );
  }

  // ── Step 1: Backend health check ──────────────────────────────
  const healthCheckResult = await expect
    .poll(
      async () => {
        healthAttempts += 1;
        try {
          const health = await request.get("/health", {
            timeout: SHORT_TIMEOUT,
          });
          // #region agent log
          fetch("http://localhost:7356/ingest/dd709e30-65ee-44b3-9fc7-0d27deb0de7e", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Debug-Session-Id": "0246c3",
            },
            body: JSON.stringify({
              sessionId: "0246c3",
              runId: "auth-pre",
              hypothesisId: "A2",
              location: "tests/auth.setup.ts:health-poll",
              message: "health poll response",
              data: {
                attempt: healthAttempts,
                status: health.status(),
                ok: health.ok(),
                url: health.url(),
              },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
          return health.ok();
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
              runId: "auth-pre",
              hypothesisId: "A3",
              location: "tests/auth.setup.ts:health-poll-catch",
              message: "health poll exception",
              data: {
                attempt: healthAttempts,
                error:
                  error instanceof Error ? error.message.slice(0, 250) : "unknown",
              },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
          return false;
        }
      },
      {
        timeout: NAV_TIMEOUT,
        intervals: [1_000, 2_000, 5_000],
        message: "Waiting for backend /health endpoint to become ready",
      },
    )
    .toBeTruthy()
    .then(() => true)
    .catch(() => false);

  if (!healthCheckResult) {
    throw new Error(
      "Backend health check failed after 60s.\n" +
        "  Ensure the OE container is running and accessible at the baseURL.",
    );
  }

  // ── Step 2: Login via request API ───────────────────────────────
  const loginResponse = await request.post(
    "/api/OpenELIS-Global/ValidateLogin?apiCall=true",
    {
      form: { loginName: username, password: password },
    },
  );
  const loginData = await loginResponse.json().catch(() => null);
  // #region agent log
  fetch("http://localhost:7356/ingest/dd709e30-65ee-44b3-9fc7-0d27deb0de7e", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "0246c3",
    },
    body: JSON.stringify({
      sessionId: "0246c3",
      runId: "auth-pre",
      hypothesisId: "A4",
      location: "tests/auth.setup.ts:login-response",
      message: "login response received",
      data: {
        status: loginResponse.status(),
        success: !!loginData?.success,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  if (loginResponse.status() !== 200 || !loginData?.success) {
    throw new Error(
      `Login API returned ${loginResponse.status()}: ${JSON.stringify(loginData)}\n` +
        `  Credentials: ${username} / ***\n` +
        "  Possible causes:\n" +
        "    - Wrong password (check TEST_PASS env var)\n" +
        "    - Credentials: source .env from repo root (set -a; . .env; set +a)\n" +
        "    - Account locked (check login_user.account_locked in DB)\n" +
        "    - Fixtures not loaded (run load-test-fixtures.sh to reset admin password)",
    );
  }

  // ── Step 3: Inject JSESSIONID into browser context ──────────────
  // The request API's JSESSIONID has path=/api/OpenELIS-Global — too
  // narrow for frontend routes. Extract it and re-add with path=/.
  const setCookieHeaders = loginResponse
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie");

  let jsessionId: string | null = null;
  for (const header of setCookieHeaders) {
    const match = header.value.match(/JSESSIONID=([^;]+)/);
    if (match) {
      jsessionId = match[1];
      break;
    }
  }

  if (!jsessionId) {
    // Fallback: try to get from the request context's stored cookies
    const storageState = await request.storageState();
    const sessionCookie = storageState.cookies.find(
      (c) => c.name === "JSESSIONID",
    );
    if (sessionCookie) {
      jsessionId = sessionCookie.value;
    }
  }

  if (!jsessionId) {
    throw new Error(
      "Login succeeded but no JSESSIONID cookie found in response.\n" +
        "  This is unexpected — check proxy/backend cookie configuration.",
    );
  }

  // Add the cookie to the browser context with root path
  const host = new URL(process.env.BASE_URL || "https://localhost").hostname;
  await context.addCookies([
    {
      name: "JSESSIONID",
      value: jsessionId,
      domain: host,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  // #region agent log
  fetch("http://localhost:7356/ingest/dd709e30-65ee-44b3-9fc7-0d27deb0de7e", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "0246c3",
    },
    body: JSON.stringify({
      sessionId: "0246c3",
      runId: "auth-postfix",
      hypothesisId: "A6",
      location: "tests/auth.setup.ts:cookie-added",
      message: "session cookie added to browser context",
      data: {
        host,
        secure: true,
        sameSite: "Lax",
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  // ── Step 4: Verify authenticated state ────────────────────────
  // Navigate to the home page — lightest authenticated route.
  // Wait for the session API call that SecureRoute uses to resolve auth,
  // then assert we weren't redirected to /login. Without this, the
  // not.toHaveURL assertion would pass instantly before React hydrates.
  const sessionResponse = page.waitForResponse(
    (resp) => resp.url().includes("/api/OpenELIS-Global/session") && resp.ok(),
    { timeout: NAV_TIMEOUT },
  );
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await sessionResponse;
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
        runId: "auth-postfix",
        hypothesisId: "A7",
        location: "tests/auth.setup.ts:session-wait-failed",
        message: "session bootstrap failed",
        data: {
          currentUrl: page.url(),
          error:
            error instanceof Error ? error.message.slice(0, 250) : "unknown",
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    throw error;
  }
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, {
    timeout: NAV_TIMEOUT,
  });

  // ── Step 5: Save session ──────────────────────────────────────
  await page.context().storageState({ path: AUTH_FILE });
});
