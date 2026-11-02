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

    // Changing capture presets or applying tuning reloads the page. Dismissing
    // the loss warning must retain the memory-only transcript and restore the
    // selected preset; no synthetic microphone is opened by this check.
    const settingsDialogs = [];
    historyPage.on("dialog", async dialog => {
      settingsDialogs.push(dialog.message());
      await dialog.dismiss();
    });
    const historyUrl = historyPage.url();
    await historyPage.locator("#quick-preset").selectOption("far-noisy");
    assert.equal(historyPage.url(), historyUrl);
    assert.equal(await historyPage.locator("#quick-preset").inputValue(), "auto");
    await historyPage.evaluate(() => document.querySelector("#apply-tuning").click());
    assert.equal(historyPage.url(), historyUrl);
    assert.equal(settingsDialogs.length, 2);
    assert(settingsDialogs.every(message => message.includes("複製完整字幕")));
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

  // A browser recognizer whose start() throws must fail closed once.
  // Without this guard the previous implementation retried forever at
  // 800-ms intervals while the screen could falsely claim to be listening.
  const failedStartContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await failedStartContext.addInitScript(() => {
      window.__failedStartAttempts = 0;
      Object.defineProperty(window, "AudioContext", { configurable: true, value: undefined });
      Object.defineProperty(window, "webkitAudioContext", { configurable: true, value: undefined });
      class BrokenRecognition {
        start() {
          window.__failedStartAttempts += 1;
          throw new Error("synthetic recognition startup rejection");
        }
        abort() { this.onend?.(); }
      }
      Object.defineProperty(window, "SpeechRecognition", {
        configurable: true, value: BrokenRecognition,
      });
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => {
          const track = { kind: "audio", label: "Synthetic microphone", stop() {} };
          return { getTracks: () => [track], getAudioTracks: () => [track] };
        },
      });
    });
    const failedPage = await failedStartContext.newPage();
    const failedErrors = [];
    failedPage.on("pageerror", error => failedErrors.push(error.message));
    await failedPage.route("**/*", route =>
      route.request().url().startsWith(origin + "/")
        ? route.continue()
        : route.abort());
    await failedPage.goto(origin + "/index.html?stt=browser", { waitUntil: "networkidle" });
    await failedPage.locator("#start").click();
    await failedPage.waitForFunction(() =>
      document.querySelector("#status")?.textContent?.includes("瀏覽器語音辨識啟動失敗"));
    assert.equal(await failedPage.locator("#start").isEnabled(), true);
    assert.equal(await failedPage.locator("#stop").isDisabled(), true);
    assert.equal(await failedPage.evaluate(() => window.__failedStartAttempts), 1);
    await failedPage.waitForTimeout(950);
    assert.equal(await failedPage.evaluate(() => window.__failedStartAttempts), 1,
      "terminal start failure must not schedule an 800-ms retry");
    assert.deepEqual(failedErrors, []);
    console.log("PASS: throwing Browser STT start fails closed without phantom listening/retry");
  } finally {
    await failedStartContext.close();
  }

  // A delayed build.json response must not reload after caption startup
  // begins: reload would discard in-memory text and the permission prompt.
  const buildContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await buildContext.addInitScript(() => {
      window.__pendingBuildMic = [];
      window.__buildMicStops = 0;
      Object.defineProperty(window, "SpeechRecognition", {
        configurable: true, value: class FakeSpeechRecognition {},
      });
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: () => new Promise(resolve => {
          const track = { kind: "audio", stop() { window.__buildMicStops += 1; } };
          window.__pendingBuildMic.push(() => resolve({
            getTracks: () => [track], getAudioTracks: () => [track],
          }));
        }),
      });
    });
    const buildPage = await buildContext.newPage();
    const buildErrors = [];
    buildPage.on("pageerror", error => buildErrors.push(error.message));
    let releaseBuild;
    const heldBuild = new Promise(resolve => { releaseBuild = resolve; });
    let markIntercepted;
    const intercepted = new Promise(resolve => { markIntercepted = resolve; });
    let markFulfilled;
    const fulfilled = new Promise(resolve => { markFulfilled = resolve; });
    await buildPage.route("**/*", async route => {
      const url = route.request().url();
      if (url.startsWith(origin + "/build.json")) {
        markIntercepted();
        await heldBuild;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ buildId: "synthetic-newer-build" }),
        });
        markFulfilled();
        return;
      }
      return url.startsWith(origin + "/") ? route.continue() : route.abort();
    });
    await buildPage.goto(origin + "/index.html?stt=browser", { waitUntil: "domcontentloaded" });
    await intercepted;
    let unexpectedNavigations = 0;
    buildPage.on("framenavigated", frame => {
      if (frame === buildPage.mainFrame()) unexpectedNavigations += 1;
    });
    await buildPage.locator("#start").click();
    await buildPage.waitForFunction(() => window.__pendingBuildMic.length === 1);
    releaseBuild();
    await fulfilled;
    await buildPage.waitForFunction(() =>
      document.querySelector("#diag-build")?.textContent?.includes("有新版"));
    assert.equal(unexpectedNavigations, 0, "stale build must not reload during caption startup");
    assert.equal(await buildPage.locator("#status").innerText(), "啟動中…");
    assert.equal(await buildPage.locator("#stop").innerText(), "取消啟動");
    await buildPage.locator("#stop").click();
    await buildPage.waitForFunction(() =>
      document.querySelector("#status")?.textContent === "已取消啟動");
    await buildPage.evaluate(() => window.__pendingBuildMic.shift()());
    await buildPage.waitForFunction(() => window.__buildMicStops === 1);
    assert.deepEqual(buildErrors, []);
    console.log("PASS: late build update defers reload and preserves pending caption cancellation");
  } finally {
    await buildContext.close();
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
