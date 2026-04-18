import * as fs from "fs";
import * as path from "path";
import { Page, TestInfo } from "@playwright/test";
import { showSceneLabel, showStepCard, showTitleCard } from "./title-card";
import { isVideoProject, videoPause } from "./video-pause";

/**
 * Directory where loose screenshot evidence files are saved (video mode).
 * Lives under {@code test-results/evidence/} so the bind mount in
 * docker-compose.validate.yml (./test-results:/app/test-results) exposes
 * the PNGs to the host. Previous path ({@code ../../e2e-evidence}) resolved
 * to {@code /app/e2e-evidence} inside the container — a path that is NOT
 * mounted, so loose files never survived the {@code --rm} container teardown.
 */
const EVIDENCE_DIR = path.resolve(__dirname, "../../test-results/evidence");

export type DemoPresentation = {
  readonly isVideo: boolean;
  title: (
    title: string,
    subtitle?: string,
    durationMs?: number,
  ) => Promise<void>;
  step: (
    stepNumber: number,
    description: string,
    durationMs?: number,
  ) => Promise<void>;
  scene: (label: string) => Promise<void>;
  pause: (ms: number) => Promise<void>;
  /**
   * Capture a screenshot of the given page (defaults to the main test page
   * the presentation was created with). Backwards-compatible — callers that
   * omit {@code targetPage} continue to snap the main page.
   *
   * Used for the "parallel set of screenshots that validate each step" the
   * user requested — pass {@code uploadPage} or any other Page when the
   * evidence should come from a secondary browser context (e.g. the bridge
   * admin upload UI).
   */
  evidence: (name: string, targetPage?: Page) => Promise<void>;
};

export function createDemoPresentation(
  page: Page,
  testInfo: TestInfo,
): DemoPresentation {
  const isVideo = isVideoProject(testInfo);

  return {
    isVideo,
    title: (title, subtitle, durationMs = 3000) =>
      showTitleCard(page, title, subtitle, durationMs, testInfo),
    step: (stepNumber, description, durationMs = 2000) =>
      showStepCard(page, stepNumber, description, durationMs, testInfo),
    scene: (label) => showSceneLabel(page, label, testInfo),
    pause: (ms) => videoPause(page, ms, testInfo),
    evidence: async (name: string, targetPage?: Page) => {
      if (!isVideo) return;
      const pageToSnap = targetPage ?? page;
      const screenshot = await pageToSnap.screenshot({ fullPage: true });
      // Attach to HTML report
      await testInfo.attach(name, {
        body: screenshot,
        contentType: "image/png",
      });
      // Also save as loose file for direct viewing
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
      const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "-");
      fs.writeFileSync(path.join(EVIDENCE_DIR, `${safeName}.png`), screenshot);
    },
  };
}
