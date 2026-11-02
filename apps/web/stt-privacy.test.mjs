import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { captionSttPrivacyNotice } from "./stt-privacy.mjs";
import { resolveSttProviderId } from "./stt/provider.js";

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
  const build = JSON.parse(readFileSync("apps/web/build.json", "utf8"));
  assert(main.includes("./stt-privacy.mjs?v=" + build.buildId));
  assert.match(css, /\.stt-privacy-notice \{/);
  assert.doesNotMatch(css, /body\.caption-focus-mode \.stt-privacy-notice[^}]*display:\s*none/);
  assert.match(html, /辨識不清楚時，再把手機移近說話者/);
});

test("disclosure module is presentation-only and never triggers capture", () => {
  const module = readFileSync("apps/web/stt-privacy.mjs", "utf8");
  assert.doesNotMatch(module, /navigator\.mediaDevices|AudioContext|AudioTrack|fetch\(|new WebSocket|sessionStorage|localStorage/);
});


test("AUTO resolves before microphone permission and names the actual cloud provider", () => {
  const token = "https://example.test/token";
  assert.equal(resolveSttProviderId("auto", token), "gemini-live-transcribe");
  assert.equal(resolveSttProviderId("auto", ""), "browser-speech");
  assert.equal(resolveSttProviderId("google-cloud-streaming", token), "google-cloud-streaming");
  assert.equal(resolveSttProviderId("unknown", token), "unknown");
  assert.match(captionSttPrivacyNotice(resolveSttProviderId("auto", token)), /Google Gemini/);
  assert.match(captionSttPrivacyNotice(resolveSttProviderId("auto", "")), /瀏覽器/);
  const main = readFileSync("apps/web/main.js", "utf8");
  assert.match(main, /provider: resolveSttProviderId\(provider, tokenUrl\)/);
  assert(main.indexOf("不支援的語音辨識選項") < main.indexOf("const diagnosticStream = await navigator.mediaDevices.getUserMedia"));
});
