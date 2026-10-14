/**
 * Chromium end-to-end regression for the standalone M03 audiogram editor.
 * Synthetic audiogram values only; no microphone access, audio output,
 * network service credentials or personal data.
 *
 * Run after staging the canonical module:
 *   cp packages/audiogram/audiogram.mjs apps/web/audiogram-domain.mjs
 *   node tools/test-audiogram-browser.mjs
 *
 * Requires the Playwright package and its matching Chromium binary.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright";

const siteRoot = resolve("apps/web");
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};
const errors = [];
const server = createServer(async (request, response) => {
  try {
    const relative = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = resolve(siteRoot, "." + relative);
    if (!file.startsWith(siteRoot + sep)) {
      response.writeHead(403).end();
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    const body = await readFile(file);
    response.writeHead(200, {
      "content-type": mimeTypes[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

await new Promise((resolveListen, rejectListen) => {
  server.once("error", rejectListen);
  server.listen(0, "127.0.0.1", resolveListen);
});
const origin = "http://127.0.0.1:" + server.address().port;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true, locale: "zh-TW" });
  const page = await context.newPage();
  page.on("pageerror", err => errors.push(err.message));
  page.on("requestfailed", request => errors.push("Request failed: " + request.url()));
  await page.route("**/*", route => {
    if (!route.request().url().startsWith(origin + "/")) {
      errors.push("Unexpected network request: " + route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(origin + "/audiogram.html", { waitUntil: "networkidle" });
  assert.match(await page.title(), /聽力圖/);
  assert.match(await page.locator("#profile-summary").innerText(), /尚未輸入資料/);

  // Actual Chromium event bindings and module imports, not structural regex tests.
  await page.locator("#right-500").fill("20");
  await page.locator("#left-2000").fill("65");
  await page.locator("#left-4000").fill("0");
  assert.match(await page.locator("#profile-status").innerText(), /尚未儲存變更/);
  assert.match(await page.locator("#profile-summary").innerText(), /共 3 個測量值/);
  assert.equal(await page.evaluate(() => localStorage.length), 0, "no implicit persistence");

  await page.locator("#profile-save").click();
  assert.match(await page.locator("#profile-status").innerText(), /已儲存/);
  const storageKey = "hearlens-audiogram-local-v1";
  assert.ok(await page.evaluate(key => localStorage.getItem(key), storageKey));
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator("#right-500").inputValue(), "20");
  assert.equal(await page.locator("#left-2000").inputValue(), "65");
  assert.equal(await page.locator("#left-4000").inputValue(), "0");
  assert.match(await page.locator("#profile-status").innerText(), /已載入/);

  const pendingDownload = page.waitForEvent("download");
  await page.locator("#profile-export").click();
  const download = await pendingDownload;
  assert.equal(download.suggestedFilename(), "hearlens-audiogram-v1.json");
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(exported.schema, "hearlens-audiogram-v1");
  assert.equal(exported.ears.right.thresholdsDbHL["500"], 20);
  assert.equal(exported.ears.left.thresholdsDbHL["2000"], 65);
  assert.equal(exported.ears.left.thresholdsDbHL["4000"], 0);
  assert.equal(exported.ears.right.thresholdsDbHL["1000"], null);

  // Unsaved edits must not be silently replaced by import.
  await page.locator("#right-500").fill("22"); // valid value needn't be a multiple of 5
  assert.match(await page.locator("#profile-status").innerText(), /尚未儲存變更/);
  const modified = structuredClone(exported);
  modified.ears.right.thresholdsDbHL["500"] = 30;
  const jsonFile = {
    name: "synthetic-hearlens-audiogram.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(modified)),
  };
  let cancelledImportPrompt = "";
  page.once("dialog", async dialog => {
    cancelledImportPrompt = dialog.message();
    await dialog.dismiss();
  });
  await page.locator("#profile-import").setInputFiles(jsonFile);
  assert.match(cancelledImportPrompt, /尚未儲存/);
  assert.equal(await page.locator("#right-500").inputValue(), "22");

  page.once("dialog", dialog => dialog.accept());
  await page.locator("#profile-import").setInputFiles(jsonFile);
  await page.waitForFunction(() => document.querySelector("#right-500").value === "30");
  assert.match(await page.locator("#profile-status").innerText(), /尚未儲存到此裝置/);
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator("#right-500").inputValue(), "20", "import must not auto-save");

  // Invalid JSON may neither mutate the form nor damage persisted data.
  await page.locator("#profile-import").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schema":"invalid","ears":{}}'),
  });
  await page.waitForFunction(() => document.querySelector("#profile-status").textContent.includes("匯入失敗"));
  assert.equal(await page.locator("#right-500").inputValue(), "20");
  assert.ok(await page.evaluate(key => localStorage.getItem(key), storageKey));

  page.once("dialog", dialog => dialog.accept());
  await page.locator("#profile-clear").click();
  assert.match(await page.locator("#profile-status").innerText(), /已清除/);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), null);
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator("#right-500").inputValue(), "");
  assert.equal(await page.locator("#left-2000").inputValue(), "");
  assert.match(await page.locator("#profile-summary").innerText(), /尚未輸入資料/);

  assert.deepEqual(errors, [], "browser page and module loads must have no errors");
  console.log("PASS M03 Chromium E2E: load, L/R + 0/missing, explicit save/reload, download, unsaved import guard, import-only, invalid JSON, delete/reload; no external requests.");
} finally {
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
