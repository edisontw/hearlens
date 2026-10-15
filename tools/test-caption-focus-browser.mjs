/**
 * Browser-level presentation test of M01 caption focus mode.
 * No microphone is started, no speech is sent, and no playback occurs.
 * Uses only the static site files staged in GitHub Pages.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";

const root = resolve("apps/web");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};
const errors = [];
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = resolve(root, "." + pathname);
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done, fail) => {
  server.once("error", fail);
  server.listen(0, "127.0.0.1", done);
});
const origin = "http://127.0.0.1:" + server.address().port;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  // The focus test must not contact the token broker, Gemini or third-party services.
  await page.route("**/*", route => {
    if (!route.request().url().startsWith(origin + "/")) return route.abort();
    return route.continue();
  });

  await page.goto(origin + "/index.html", { waitUntil: "networkidle" });
  await page.locator("#caption-focus-toggle").waitFor();
  assert.equal(await page.locator("#caption-focus-toggle").getAttribute("aria-pressed"), "false");
  const regularHeight = await page.locator("#caption").evaluate(el => el.getBoundingClientRect().height);
  assert(await page.locator(".hero").isVisible());
  assert(await page.locator(".research-panel").isVisible());
  assert(await page.locator("#quick-preset").isVisible());
  await page.locator("#caption").evaluate(el => { el.textContent = "這是一段測試字幕。"; });

  await page.locator("#caption-focus-toggle").click();
  assert.equal(await page.locator("#caption-focus-toggle").getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator("#caption-focus-toggle").innerText(), "返回一般畫面");
  assert.equal(await page.locator(".hero").isVisible(), false);
  assert.equal(await page.locator(".research-panel").isVisible(), false);
  assert.equal(await page.locator("#quick-preset").isVisible(), false);
  const focusHeight = await page.locator("#caption").evaluate(el => el.getBoundingClientRect().height);
  assert(focusHeight > regularHeight + 50,
    "focus must visibly enlarge the caption viewport on a portrait phone");
  assert.equal(await page.locator("#caption").innerText(), "這是一段測試字幕。");
  assert(await page.locator("#clear-caption").isVisible(), "clear remains available in focus mode");
  for (const id of ["start", "stop", "recall"]) {
    assert(await page.locator("#" + id).isVisible(), id + " remains visible");
  }
  assert.equal(await page.locator("#stop").isDisabled(), true);
  assert(await page.locator('[data-caption-size="xlarge"]').isVisible());
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  assert(horizontalOverflow <= 2, "portrait focus must not cause horizontal overflow");
  await page.locator('[data-caption-size="xlarge"]').click();
  assert.equal(await page.locator('[data-caption-size="xlarge"]').getAttribute("aria-pressed"), "true");
  await page.locator("#caption-focus-toggle").click();
  assert(await page.locator(".hero").isVisible());
  assert(await page.locator("#quick-preset").isVisible());
  assert.equal(await page.locator("#caption").innerText(), "這是一段測試字幕。");
  assert.equal(await page.locator('[data-caption-size="xlarge"]').getAttribute("aria-pressed"), "true");

  await page.setViewportSize({ width: 844, height: 390 });
  const landscapeRegular = await page.locator("#caption").evaluate(el => el.getBoundingClientRect().height);
  await page.locator("#caption-focus-toggle").click();
  const landscapeFocus = await page.locator("#caption").evaluate(el => el.getBoundingClientRect().height);
  assert(landscapeFocus > landscapeRegular,
    "focus mode must enlarge the landscape caption viewport");
  assert(await page.locator("#start").isVisible());
  assert(await page.locator("#recall").isVisible());
  assert(await page.locator('[data-caption-size="xlarge"]').isVisible());
  const landscapeOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  assert(landscapeOverflow <= 2, "landscape focus must not cause horizontal overflow");

  // Deliberately do not request mic permission. Clear the currently visible
  // synthetic caption and verify the display action responds in the browser.
  await page.locator("#clear-caption").click();
  assert.equal(await page.locator("#caption").innerText(), "", "manual clear must be visually blank");
  assert(await page.locator("#recall").isVisible());

  assert.deepEqual(errors, [], "static web page must have no unhandled script errors");
  console.log("PASS M01 Chromium: portrait + landscape focus toggle, enlarged caption, preserved essential controls, retained text/font, no horizontal overflow; no capture/playback.");
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
