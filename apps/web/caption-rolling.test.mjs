import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const main = fs.readFileSync("apps/web/main.js", "utf8");
const recent = fs.readFileSync("apps/web/transcript-window.mjs", "utf8");
const html = fs.readFileSync("apps/web/index.html", "utf8");
const build = JSON.parse(fs.readFileSync("apps/web/build.json", "utf8"));

test("rolling window refresh is bounded and has an explicit shutdown path", () => {
  assert.match(main, /const CAPTION_REFRESH_MS = 1_000/);
  assert.match(main, /window\.setInterval\(refreshCaptionWindow, CAPTION_REFRESH_MS\)/);
  assert.match(main, /window\.clearInterval\(captionRefreshTimer\)/);
  assert.match(main, /recentTranscriptItems\(transcript, now, ROLLING_WINDOW_MS\)/);
  assert.match(main, /function refreshCaptionWindow\(\)/);
  assert.match(main, /if \(els\.recallPanel && !els\.recallPanel\.hidden\) renderRecall\(\)/);
});

test("live captions update text only on changes without re-announcing every second", () => {
  assert.match(main, /if \(els\.caption\.textContent !== nextText\) els\.caption\.textContent = nextText/);
  assert.match(main, /currentCaptionText\(\s*transcript, interimText, lastInterimAt, now, ROLLING_WINDOW_MS\)/);
  assert.match(main, /lastInterimAt = interimText\.trim\(\) \? Date\.now\(\) : null/);
  assert.match(main, /const fallback = liveInterim\(now\) \|\| recentRecognizedText\(now\)/);
  assert.match(main, /recentTranscriptText\(items\) \|\|\s*liveInterim\(\)/);
});

test("session reports keep full finals despite rolling display expiration", () => {
  assert.match(main, /sessionFinals\.push\(item\)/);
  assert.match(main, /finalTranscript: sessionFinals\.map/);
  assert.match(main, /transcript\.length = 0;/);
  assert.doesNotMatch(recent, /\.splice\(|\.shift\(|\.pop\(/);
  assert.match(main, /captionStopRequested = false;\s*syncCaptionRefreshTimer\(\)/);
});

test("rolling caption version is consistent across browser assets", () => {
  const version = "20261013-rolling-caption1";
  assert.equal(build.buildId, version);
  assert(main.includes('./transcript-window.mjs?v=' + version));
  assert(html.includes('./main.js?v=' + version));
});
