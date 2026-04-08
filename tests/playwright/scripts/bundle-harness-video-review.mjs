#!/usr/bin/env node
/**
 * Collects all harness-demo-video Playwright result folders into one directory
 * with an index.html for reviewing every run's video (and trace) in one place.
 *
 * Usage (from tests/playwright):
 *   node scripts/bundle-harness-video-review.mjs
 *
 * Env:
 *   TEST_RESULTS   — path to test-results (default: ./test-results)
 *   OUT_DIR        — output bundle (default: ./test-results/harness-video-review-bundle)
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAYWRIGHT_ROOT = path.resolve(__dirname, "..");

const TEST_RESULTS = process.env.TEST_RESULTS
  ? path.resolve(process.env.TEST_RESULTS)
  : path.join(PLAYWRIGHT_ROOT, "test-results");
const OUT_DIR = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(PLAYWRIGHT_ROOT, "test-results", "harness-video-review-bundle");

const SUFFIX = "-harness-demo-video";

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function humanTitle(dirName) {
  if (!dirName.endsWith(SUFFIX)) return dirName;
  const bare = dirName.replace(/-full-E2E-flow-harness-demo-video$/, "");
  const afterPrefix = bare.replace(/^demo-harness-analyzer-demo-/i, "");
  const afterHash = afterPrefix.replace(/^[a-f0-9]+-/, "");
  return afterHash.replace(/-/g, " ").trim() || afterPrefix;
}

async function main() {
  const entries = await fs.readdir(TEST_RESULTS, { withFileTypes: true }).catch(() => []);
  const dirs = entries
    .filter((e) => e.isDirectory() && e.name.endsWith(SUFFIX))
    .map((e) => e.name)
    .sort();

  if (dirs.length === 0) {
    console.error(
      `No *${SUFFIX} folders under ${TEST_RESULTS}. Run harness-demo-video tests first.`,
    );
    process.exit(1);
  }

  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(path.join(OUT_DIR, "runs"), { recursive: true });

  const cards = [];

  for (let i = 0; i < dirs.length; i++) {
    const name = dirs[i];
    const src = path.join(TEST_RESULTS, name);
    const dest = path.join(OUT_DIR, "runs", String(i + 1).padStart(2, "0") + "-" + name);
    await fs.cp(src, dest, { recursive: true });

    const rel = path.join("runs", path.basename(dest));
    const videoRel = path.join(rel, "video.webm");
    const tracePath = path.join(dest, "trace.zip");
    let traceRel = null;
    try {
      await fs.stat(tracePath);
      traceRel = path.join(rel, "trace.zip");
    } catch {
      /* optional */
    }

    const title = humanTitle(name);
    cards.push({ title, name, videoRel, traceRel });
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Harness demo video — ${cards.length} runs</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 960px; margin: 24px auto; padding: 0 16px; color: #161616; background: #f4f4f4; }
    h1 { font-size: 1.25rem; }
    h2 { font-size: 1rem; margin: 1.5rem 0 0.5rem; border-bottom: 1px solid #c6c6c6; padding-bottom: 4px; }
    section { background: #fff; padding: 16px; margin-bottom: 16px; border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
    video { width: 100%; max-height: 480px; background: #000; }
    .meta { font-size: 0.75rem; color: #525252; padding: 8px 0; word-break: break-all; }
    a { color: #0f62fe; }
  </style>
</head>
<body>
  <h1>Harness demo video — ${cards.length} runs</h1>
  <p class="meta">Bundled from <code>${escapeHtml(TEST_RESULTS)}</code> at ${new Date().toISOString()}</p>
  <p>Open traces with: <code>npx playwright show-trace runs/&lt;folder&gt;/trace.zip</code></p>
${cards
  .map(
    (c, idx) => `  <section>
    <h2>${idx + 1}. ${escapeHtml(c.title)}</h2>
    <div class="meta">${escapeHtml(c.name)}</div>
    <video controls src="${escapeHtml(c.videoRel)}" playsinline></video>
    ${
      c.traceRel
        ? `<p><a href="${escapeHtml(c.traceRel)}">trace.zip</a> (download or use <code>playwright show-trace</code>)</p>`
        : ""
    }
  </section>`,
  )
  .join("\n")}
</body>
</html>
`;

  await fs.writeFile(path.join(OUT_DIR, "index.html"), html, "utf8");
  console.log(`Wrote ${cards.length} runs to ${OUT_DIR}`);
  console.log(`Open: file://${path.join(OUT_DIR, "index.html")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
