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
  assert.match(main, /if \(els\.caption\.textContent === text\) return/);
  assert.match(main, /updateCaptionDisplay\(nextText\)/);
  assert.match(main, /retainedCaptionText\(\s*displayFinals, lastDisplayFinal, interimText, lastInterimAt, now, ROLLING_WINDOW_MS\)/);
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
  const version = "20261015-stt-privacy1";
  assert.equal(build.buildId, version);
  assert(main.includes('./transcript-window.mjs?v=' + version));
  assert(html.includes('./main.js?v=' + version));
});


test("main live caption retains last confirmed final and manual clear never deletes session history", () => {
  assert.match(main, /displayFinals\.push\(item\)/);
  assert.match(main, /lastDisplayFinal = item/);
  assert.match(main, /function visibleDisplayTranscript\(now = Date\.now\(\)\)/);
  assert.match(main, /const combined = visibleDisplayTranscript\(now\)/);
  assert.match(main, /els\.clearCaption\?\.addEventListener\("click"/);
  assert.match(main, /displayFinals\.length = 0;\s*lastDisplayFinal = null;/);
  assert.match(main, /sessionFinals\.push\(item\)/);
  assert.match(main, /const retained = visibleDisplayTranscript\(\)/);
  assert.match(html, /id="clear-caption"[^>]*aria-label="清除主畫面字幕，不刪除本次完整字幕"/);
  assert.match(html, /即時字幕保留最後一段已確認內容/);
});


test("manual clear leaves main caption blank until another transcript arrives", () => {
  assert.match(main, /captionManuallyCleared = true;\s*updateCaptionDisplay\(""\)/);
  assert.match(main, /captionManuallyCleared \? "" : "正在聆聽…"/);
  assert.match(main, /if \(interimText\.trim\(\)\) captionManuallyCleared = false/);
  assert.match(main, /lastDisplayFinal = item;\s*captionManuallyCleared = false/);
  assert.doesNotMatch(main, /畫面已清除，等待新字幕|畫面已清除。/);
});
