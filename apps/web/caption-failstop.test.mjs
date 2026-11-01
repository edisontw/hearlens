import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stopCaptionProviderSafely, disposeCaptionResourcesSafely } from "./caption-stop.mjs";

const main = readFileSync("apps/web/main.js", "utf8");
const provider = readFileSync("apps/web/stt/providers/gemini-live-transcribe.js", "utf8");
const router = readFileSync("apps/web/stt/provider.js", "utf8");
const html = readFileSync("apps/web/index.html", "utf8");
const build = JSON.parse(readFileSync("apps/web/build.json", "utf8"));

test("fatal transport callback permits retry only when all cleanup succeeds", () => {
  assert.match(main, /onError: \(\{ message, code, fatal \}\)/);
  assert.match(main, /fatal === true/);
  assert.match(main, /code === "gemini-closed"/);
  assert.match(main, /code === "gemini-socket-error"/);
  assert.match(main, /activeSessionId = 0; \/\/ immediately reject delayed partial/);
  assert.match(main, /const cleanupOk = await disposeCaptionResourcesSafely\(/);
  assert.match(main, /\(\) => releaseDiagnosticCapture\("未使用"\)/);
  assert.match(main, /"字幕已暫停，請重新開始"/);
  assert.match(main, /"麥克風已中斷，請重新開始"/);
  assert.match(main, /"字幕連線中斷，請重新開始"/);
  assert.match(main, /setStatus\(reasonLabel, "error"\)/);
  assert.match(main, /els\.start\.disabled = !cleanupOk/);
  assert.match(main, /setAdvancedTuningDisabled\(false\)/);
  assert.match(main, /sessionId !== activeSessionId/);
});

test("abnormal socket close stops capture; explicit stop still supports final drain", () => {
  assert.match(provider, /handleUnexpectedTransportFailure\(socket, code, message\)/);
  assert.match(provider, /this\.active = false/);
  assert.match(provider, /void this\.shutdownCapture\(\)\.catch/);
  assert.match(provider, /this\.fatalTransportHandled/);
  assert.match(provider, /this\.scheduleStopDrain\("turn-complete"\)/);
  assert.doesNotMatch(provider + main, /\bnew\s+AudioTrack\s*\(|\bnew\s+MediaPlayer\s*\(/);
});

test("fatal fix refreshes the browser's main, provider, and provider-implementation URLs", () => {
  const version = build.buildId;
  assert.match(version, /^\d{8}-[a-z0-9-]+$/);
  assert.match(main, new RegExp('const BUILD_ID = "' + version + '"'));
  assert(main.includes("./stt/provider.js?v=" + version));
  assert(router.includes("./providers/gemini-live-transcribe.js?v=" + version));
  assert(html.includes("./main.js?v=" + version));
});

test("successful explicit stop leaves the provider stopped without redundant dispose", async () => {
  let stopped = 0;
  let disposed = 0;
  const provider = {
    async stop() { stopped += 1; },
    async dispose() { disposed += 1; },
  };
  assert.equal(await stopCaptionProviderSafely(provider), true);
  assert.equal(stopped, 1);
  assert.equal(disposed, 0);
  assert.equal(await stopCaptionProviderSafely(null), true);
});

test("failed provider stop attempts dispose and reports failure without throwing", async () => {
  const phases = [];
  let disposed = 0;
  const provider = {
    async stop() { throw new Error("WebSocket send failed"); },
    async dispose() { disposed += 1; },
  };
  assert.equal(await stopCaptionProviderSafely(provider,
    (phase, error) => phases.push([phase, error.message])), false);
  assert.equal(disposed, 1);
  assert.deepEqual(phases, [["stop", "WebSocket send failed"]]);
});

test("failed fallback dispose still reports both errors and never claims clean stop", async () => {
  const phases = [];
  const provider = {
    async stop() { throw new Error("close failed"); },
    async dispose() { throw new Error("dispose failed"); },
  };
  assert.equal(await stopCaptionProviderSafely(provider,
    (phase, error) => phases.push([phase, error.message])), false);
  assert.deepEqual(phases, [
    ["stop", "close failed"], ["dispose", "dispose failed"],
  ]);
});

test("UI stop failure is fail-closed and requires a reload, not another capture", () => {
  assert.match(main, /const stoppingProvider = sttProvider;/);
  assert.match(main, /await stopCaptionProviderSafely\(stoppingProvider/);
  assert.match(main, /catch \(error\) \{\s*cleanStop = false;\s*appendSttLog\("S" \+ sessionId \+ " diagnostic-cleanup-error "/);
  assert.match(main, /els\.start\.disabled = !cleanStop;/);
  assert.match(main, /setStatus\(cleanStop \? "已停止" : "停止異常，請重新載入頁面"/);
  assert.match(main, /if \(!cleanStop\) \{\s*els\.diagStt\.textContent = "停止清理未完成；請重新載入頁面再開始。";/);
});

test("failed-start cleanup independently attempts both releases and blocks retry on either error", async () => {
  const events = [];
  const provider = { async dispose() { events.push("provider"); throw new Error("dispose rejected"); } };
  const clean = await disposeCaptionResourcesSafely(
    provider,
    async () => { events.push("diagnostic"); },
    (phase, error) => events.push(phase + ":" + error.message),
  );
  assert.equal(clean, false);
  assert.deepEqual(events, ["provider", "provider:dispose rejected", "diagnostic"]);
  assert.equal(await disposeCaptionResourcesSafely(null, async () => {}), true);
});

test("diagnostic close rejection is not swallowed and startup UI requires reload", async () => {
  const events = [];
  const clean = await disposeCaptionResourcesSafely(
    { async dispose() { events.push("provider"); } },
    async () => { events.push("diagnostic"); throw new Error("AudioContext close rejected"); },
    (phase) => events.push(phase + "-error"),
  );
  assert.equal(clean, false);
  assert.deepEqual(events, ["provider", "diagnostic", "diagnostic-error"]);
  assert.match(main, /const cleanupOk = await cleanupFailedStart\(error\)/);
  assert.match(main, /setStatus\(cleanupOk \? "無法啟動" : "啟動清理未完成，請重新載入頁面"/);
  assert.match(main, /els\.start\.disabled = !cleanupOk/);
  assert.match(main, /"字幕清理未完成，請重新載入頁面"/);
});

test("earlier diagnostic close failure remains a sticky no-retry condition", () => {
  assert.match(main, /let diagnosticCleanupFailed = false/);
  assert.match(main, /diagnosticCleanupFailed = true;/);
  assert.equal((main.match(/\)\) && !diagnosticCleanupFailed;/g) ?? []).length, 2);
  assert.match(main, /cleanupError \?\?= error/);
});
