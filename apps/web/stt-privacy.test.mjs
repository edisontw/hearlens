import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { captionSttPrivacyNotice } from "./stt-privacy.mjs";

test("pre-start privacy notice identifies the true configured provider", () => {
  const gemini = captionSttPrivacyNotice("gemini-live-transcribe");
  assert.match(gemini, /Google Gemini/);
  assert.match(gemini, /聲音會傳送/);
  assert.match(gemini, /告知對話者/);
  const browser = captionSttPrivacyNotice("browser-speech");
  assert.match(browser, /瀏覽器/);
  assert.match(browser, /可能使用雲端/);
  assert.doesNotMatch(browser, /Google Gemini/);
  const google = captionSttPrivacyNotice("google-cloud-streaming");
  assert.match(google, /語音代理/);
  assert.match(google, /Google Cloud/);
  assert.doesNotMatch(google, /Google Gemini/);
  for (const unknown of [null, "", "future-provider"]) {
    assert.match(captionSttPrivacyNotice(unknown), /可能傳送至外部辨識服務/);
  }
});

test("notice is visible before Start and associated with the accessibility tree", () => {
  const html = readFileSync("apps/web/index.html", "utf8");
  const main = readFileSync("apps/web/main.js", "utf8");
  const css = readFileSync("apps/web/styles.css", "utf8");
  assert(html.indexOf('id="stt-privacy-notice"') < html.indexOf('id="start"'));
  assert.match(html, /id="stt-privacy-notice" class="stt-privacy-notice" role="note"/);
  assert.match(html, /id="start"[^>]*aria-describedby="stt-privacy-notice"/);
  assert.match(main, /captionSttPrivacyNotice\(runtimeSttConfig\.provider\)/);
  assert.match(main, /els\.sttPrivacyNotice\.textContent = captionSttPrivacyNotice/);
  assert.match(main, /\.\/stt-privacy\.mjs\?v=20261015-stt-privacy1/);
  assert.match(css, /\.stt-privacy-notice \{/);
  assert.doesNotMatch(css, /body\.caption-focus-mode \.stt-privacy-notice[^}]*display:\s*none/);
  assert.match(html, /辨識不清楚時，再把手機移近說話者/);
});

test("disclosure module is presentation-only and never triggers capture", () => {
  const module = readFileSync("apps/web/stt-privacy.mjs", "utf8");
  assert.doesNotMatch(module, /navigator\.mediaDevices|AudioContext|AudioTrack|fetch\(|new WebSocket|sessionStorage|localStorage/);
});
