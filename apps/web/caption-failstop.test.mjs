import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync("apps/web/main.js", "utf8");
const provider = readFileSync("apps/web/stt/providers/gemini-live-transcribe.js", "utf8");
const router = readFileSync("apps/web/stt/provider.js", "utf8");
const html = readFileSync("apps/web/index.html", "utf8");
const build = JSON.parse(readFileSync("apps/web/build.json", "utf8"));

test("fatal transport callback transitions current caption session to an error and re-enables start", () => {
  assert.match(main, /onError: \(\{ message, code, fatal \}\)/);
  assert.match(main, /fatal === true/);
  assert.match(main, /code === "gemini-closed"/);
  assert.match(main, /code === "gemini-socket-error"/);
  assert.match(main, /activeSessionId = 0; \/\/ immediately reject delayed partial/);
  assert.match(main, /await failedProvider\?\.dispose\?\.\(\)/);
  assert.match(main, /await releaseDiagnosticCapture\("未使用"\)/);
  assert.match(main, /"字幕已暫停，請重新開始"/);
  assert.match(main, /"麥克風已中斷，請重新開始"/);
  assert.match(main, /"字幕連線中斷，請重新開始"/);
  assert.match(main, /setStatus\(reasonLabel, "error"\)/);
  assert.match(main, /els\.start\.disabled = false/);
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
  const version = "20261015-stt-privacy1";
  assert.equal(build.buildId, version);
  assert.match(main, new RegExp('const BUILD_ID = "' + version + '"'));
  assert(main.includes("./stt/provider.js?v=" + version));
  assert(router.includes("./providers/gemini-live-transcribe.js?v=" + version));
  assert(html.includes("./main.js?v=" + version));
});
