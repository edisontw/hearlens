/**
 * Synthetic Chromium regression for cancelling an unresolved mic permission.
 * No physical microphone, cloud request, raw audio or output playback.
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
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = resolve(root, "." + pathname);
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": mime[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
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
  await context.addInitScript(() => {
    window.__pendingMicGrants = [];
    window.__micStops = 0;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: () => new Promise(resolve => {
        const track = { kind: "audio", stop() { window.__micStops += 1; } };
        window.__pendingMicGrants.push(() => resolve({
          getTracks: () => [track],
          getAudioTracks: () => [track],
        }));
      }),
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route =>
    route.request().url().startsWith(origin + "/")
      ? route.continue()
      : route.abort());

  await page.goto(origin + "/index.html", { waitUntil: "networkidle" });
  await page.locator("#start").click();
  await page.waitForFunction(() => window.__pendingMicGrants.length === 1);
  assert.equal(await page.locator("#stop").isEnabled(), true,
    "cancel must be available while permission is pending");
  assert.equal(await page.locator("#stop").innerText(), "取消啟動");
  await page.locator("#stop").click();
  await page.waitForFunction(() =>
    document.querySelector("#status")?.textContent === "已取消啟動");
  assert.equal(await page.locator("#start").isEnabled(), true);
  assert.equal(await page.locator("#stop").isDisabled(), true);
  assert.equal(await page.locator("#stop").innerText(), "停止聆聽");

  // Retry before the old browser permission promise resolves. Its late
  // result must never attach to or overwrite the new caption session.
  await page.locator("#start").click();
  await page.waitForFunction(() => window.__pendingMicGrants.length === 2);
  await page.evaluate(() => window.__pendingMicGrants[0]());
  await page.waitForFunction(() => window.__micStops === 1);
  assert.equal(await page.locator("#status").innerText(), "啟動中…");
  assert.equal(await page.locator("#stop").innerText(), "取消啟動");

  await page.locator("#stop").click();
  await page.waitForFunction(() =>
    document.querySelector("#status")?.textContent === "已取消啟動");
  await page.evaluate(() => window.__pendingMicGrants[1]());
  await page.waitForFunction(() => window.__micStops === 2);
  assert.equal(await page.locator("#start").isEnabled(), true);
  assert.equal(await page.locator("#stop").isDisabled(), true);
  assert.equal(await page.locator("#status").innerText(), "已取消啟動");
  assert.deepEqual(errors, [], "cancellation must not cause page exceptions");
  console.log("PASS: permission cancellation, late track stop and retry isolation");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
