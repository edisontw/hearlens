import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const css = readFileSync("apps/web/styles.css", "utf8");
const html = readFileSync("apps/web/index.html", "utf8");
const main = readFileSync("apps/web/main.js", "utf8");
const build = JSON.parse(readFileSync("apps/web/build.json", "utf8"));

test("long-caption area wraps and scrolls internally without losing keyboard access", () => {
  const baseCaption = css.split(".caption {")[1]?.split("\n}")[0] ?? "";
  assert.match(baseCaption, /display: block/);
  assert.match(baseCaption, /overflow-y: auto/);
  assert.match(baseCaption, /overflow-wrap: anywhere/);
  assert.match(baseCaption, /word-break: normal/);
  assert.match(baseCaption, /white-space: pre-wrap/);
  assert.match(html, /id="caption" class="caption" tabindex="0"/);
  assert.match(html, /role="log"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-relevant="text">字幕會顯示在這裡。<\/div>/);
  assert.match(css, /\.caption:focus-visible/);
});

test("phone portrait retains two main controls and three size controls in compact rows", () => {
  const phone = css.split("/* Phone portrait:")[1]?.split("/* Short-height landscape")[0] ?? "";
  assert.match(phone, /@media \(max-width: 540px\)/);
  // The compact two-column control grid is defined in the first phone
  // breakpoint; the final phone block refines touch/spacing properties.
  const initialPhone = css.split("@media (max-width: 540px) {")[1]
    ?.split("@media (prefers-color-scheme: dark)")[0] ?? "";
  assert.match(initialPhone, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(initialPhone, /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1\.6fr\)/);
  assert.match(phone, /min-height: 48px/);
  assert.match(phone, /height: clamp\(10rem, 34dvh, 19rem\)/);
  assert.match(phone, /safe-area-inset-left/);
  assert.match(phone, /safe-area-inset-right/);
  assert.match(html, /role="group" aria-label="字幕大小"/);
});

test("short landscape viewport prioritizes caption over decorative header", () => {
  const landscape = css.split("/* Short-height landscape")[1] ?? "";
  assert.match(landscape, /@media \(orientation: landscape\) and \(max-height: 560px\)/);
  assert.match(landscape, /\.hero \.eyebrow,[\s\S]*?\.hero \.lead \{\s*display: none/);
  assert.match(landscape, /height: clamp\(6\.5rem, 34dvh, 12rem\)/);
  assert.match(landscape, /\.actions \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(landscape, /\.primary-panel \{[^}]*display:\s*none/);
});

test("caption update follows near-bottom while keeping manual reread position", () => {
  assert.match(main, /function updateCaptionDisplay\(text\)/);
  assert.match(main, /if \(els\.caption\.textContent === text\) return/);
  assert.match(main, /shouldFollowCaptionScroll\(/);
  assert.match(main, /if \(follow\) els\.caption\.scrollTop = els\.caption\.scrollHeight/);
  assert.match(main, /updateCaptionDisplay\(nextText\)/);
  assert.match(main, /updateCaptionDisplay\(recent \|\| "字幕會顯示在這裡。"\)/);
});

test("responsive asset version has browser cache bust and no hearing playback", () => {
  const version = "20261014-caption-wake1";
  assert.equal(build.buildId, version);
  assert(main.includes('./caption-scroll.mjs?v=' + version));
  assert(html.includes('./styles.css?v=' + version));
  assert(html.includes('./main.js?v=' + version));
  assert.match(html, /id="screen-awake-status"[^>]*aria-live="polite"/);
  assert.match(main, /captionScreenWakeLock[.]stop[(][)]/);
  assert.match(main, /captionScreenWakeLock[.]start[(][)]/);
  assert.doesNotMatch(main, /\bnew\s+AudioTrack\s*\(/);
});
