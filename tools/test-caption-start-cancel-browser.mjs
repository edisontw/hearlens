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
  
  // An explicitly selected but unavailable optional STT backend must fail
  // before requesting microphone permission, not show a fake listening state.
  const unsupportedContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await unsupportedContext.addInitScript(() => {
      window.__unexpectedMicRequests = 0;
      Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: undefined });
      Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: undefined });
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: () => {
          window.__unexpectedMicRequests += 1;
          return Promise.reject(new Error("unsupported backend must not open mic"));
        },
      });
    });
    const unsupportedPage = await unsupportedContext.newPage();
    const unsupportedErrors = [];
    unsupportedPage.on("pageerror", error => unsupportedErrors.push(error.message));
    await unsupportedPage.route("**/*", route =>
      route.request().url().startsWith(origin + "/")
        ? route.continue()
        : route.abort());
    await unsupportedPage.goto(origin + "/index.html?stt=browser", { waitUntil: "networkidle" });
    await unsupportedPage.locator("#start").click();
    await unsupportedPage.waitForFunction(() =>
      document.querySelector("#status")?.textContent === "無法啟動");
    assert.match(await unsupportedPage.locator("#caption").innerText(),
      /不支援 Browser 語音辨識/);
    assert.equal(await unsupportedPage.evaluate(() => window.__unexpectedMicRequests), 0,
      "unsupported browser STT must not request microphone permission");
    assert.equal(await unsupportedPage.locator("#start").isEnabled(), true);
    assert.equal(await unsupportedPage.locator("#stop").isDisabled(), true);
    assert.deepEqual(unsupportedErrors, []);
    console.log("PASS: unsupported browser STT fails before mic permission without false listening");

    // AUTO must disclose the effective backend, and unsupported AUTO/unknown
    // choices must never ask for microphone permission.
    await unsupportedPage.goto(origin + "/index.html?stt=auto", { waitUntil: "networkidle" });
    assert.match(await unsupportedPage.locator("#stt-privacy-notice").innerText(), /Google Gemini/);
    await unsupportedPage.goto(origin + "/index.html?stt=auto&token=%20", { waitUntil: "networkidle" });
    assert.match(await unsupportedPage.locator("#stt-privacy-notice").innerText(), /瀏覽器/);
    await unsupportedPage.locator("#start").click();
    await unsupportedPage.waitForFunction(() => document.querySelector("#status")?.textContent === "無法啟動");
    assert.equal(await unsupportedPage.evaluate(() => window.__unexpectedMicRequests), 0);
    await unsupportedPage.goto(origin + "/index.html?stt=not-a-provider", { waitUntil: "networkidle" });
    await unsupportedPage.locator("#start").click();
    await unsupportedPage.waitForFunction(() => document.querySelector("#status")?.textContent === "無法啟動");
    assert.match(await unsupportedPage.locator("#caption").innerText(), /不支援的語音辨識選項/);
    assert.equal(await unsupportedPage.evaluate(() => window.__unexpectedMicRequests), 0);
    assert.deepEqual(unsupportedErrors, []);
    console.log("PASS: AUTO disclosure and unknown provider fail before mic permission");
  } finally {
    await unsupportedContext.close();
  }

  // A failed or cancelled restart must not destroy the last confirmed
  // conversation. A successful restart still creates a fresh transcript.
  const historyContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await historyContext.addInitScript(() => {
      window.__historyMicMode = "grant";
      window.__pendingHistoryMic = [];
      window.__recognizers = [];
      Object.defineProperty(window, "AudioContext", { configurable: true, value: undefined });
      Object.defineProperty(window, "webkitAudioContext", { configurable: true, value: undefined });
      class FakeSpeechRecognition {
        start() {
          window.__recognizers.push(this);
          this.onstart?.();
        }
        stop() { this.onend?.(); }
        abort() { this.onend?.(); }
      }
      Object.defineProperty(window, "SpeechRecognition", {
        configurable: true, value: FakeSpeechRecognition,
      });
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: () => {
          const mockStream = {
            getTracks: () => [{ kind: "audio", label: "Synthetic microphone", stop() {} }],
            getAudioTracks: () => [{ kind: "audio", label: "Synthetic microphone", stop() {} }],
          };
          if (window.__historyMicMode === "reject") {
            return Promise.reject(new Error("synthetic permission failure"));
          }
          if (window.__historyMicMode === "pending") {
            return new Promise(resolve => window.__pendingHistoryMic.push(() => resolve(mockStream)));
          }
          return Promise.resolve(mockStream);
        },
      });
    });
    const historyPage = await historyContext.newPage();
    const historyErrors = [];
    historyPage.on("pageerror", error => historyErrors.push(error.message));
    await historyPage.route("**/*", route =>
      route.request().url().startsWith(origin + "/")
        ? route.continue()
        : route.abort());
    await historyPage.goto(origin + "/index.html?stt=browser", { waitUntil: "networkidle" });
    await historyPage.locator("#start").click();
    await historyPage.waitForFunction(() =>
      document.querySelector("#status")?.textContent === "正在聆聽");
    await historyPage.evaluate(() => {
      const final = [{ transcript: "上一段完整字幕" }];
      final.isFinal = true;
      window.__recognizers.at(-1).onresult({ resultIndex: 0, results: [final] });
    });
    await historyPage.locator("#stop").click();
    await historyPage.waitForFunction(() =>
      document.querySelector("#status")?.textContent === "已停止");
    await historyPage.locator("#recall").click();
    await historyPage.locator("#recall-complete").click();
    assert.match(await historyPage.locator("#recall-list").innerText(), /上一段完整字幕/);
    assert.equal(await historyPage.locator("#copy-complete-transcript").isEnabled(), true);

    await historyPage.evaluate(() => { window.__historyMicMode = "reject"; });
    await historyPage.locator("#start").click();
    await historyPage.waitForFunction(() =>
      document.querySelector("#status")?.textContent === "無法啟動");
    assert.match(await historyPage.locator("#caption").innerText(), /上一段完整字幕/);
    assert.match(await historyPage.locator("#recall-list").innerText(), /上一段完整字幕/);
    assert.equal(await historyPage.locator("#copy-complete-transcript").isEnabled(), true);

    await historyPage.evaluate(() => { window.__historyMicMode = "pending"; });
    await historyPage.locator("#start").click();
    await historyPage.waitForFunction(() => window.__pendingHistoryMic.length === 1);
    assert.match(await historyPage.locator("#recall-list").innerText(), /上一段完整字幕/);
    assert.equal(await historyPage.locator("#copy-complete-transcript").isEnabled(), true,
      "previous complete transcript must remain copyable during pending restart");
    await historyPage.locator("#stop").click();
    await historyPage.waitForFunction(() =>
      document.querySelector("#status")?.textContent === "已取消啟動");
    await historyPage.evaluate(() => window.__pendingHistoryMic.shift()());
    assert.match(await historyPage.locator("#caption").innerText(), /上一段完整字幕/);
    assert.match(await historyPage.locator("#recall-list").innerText(), /上一段完整字幕/);

    await historyPage.evaluate(() => { window.__historyMicMode = "grant"; });
    await historyPage.locator("#start").click();
    await historyPage.waitForFunction(() =>
      document.querySelector("#status")?.textContent === "正在聆聽");
    assert.doesNotMatch(await historyPage.locator("#caption").innerText(), /上一段完整字幕/);
    assert.doesNotMatch(await historyPage.locator("#recall-list").innerText(), /上一段完整字幕/);
    assert.equal(await historyPage.locator("#copy-complete-transcript").isDisabled(), true);
    await historyPage.locator("#stop").click();
    await historyPage.waitForFunction(() =>
      document.querySelector("#status")?.textContent === "已停止");
    assert.deepEqual(historyErrors, []);
    console.log("PASS: failed/cancelled restart retains previous finals; successful restart resets");
  } finally {
    await historyContext.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
