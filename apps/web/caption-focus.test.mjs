import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createCaptionFocusMode } from "./caption-focus.mjs";

function fixture() {
  const classes = new Set();
  const attributes = new Map();
  let click = null;
  const body = {
    classList: {
      contains: value => classes.has(value),
      toggle(value, enabled) {
        if (enabled) classes.add(value);
        else classes.delete(value);
      },
    },
  };
  const button = {
    textContent: "",
    setAttribute(key, value) { attributes.set(key, value); },
    addEventListener(event, handler) {
      assert.equal(event, "click");
      click = handler;
    },
  };
  const focus = createCaptionFocusMode({ body, button });
  return { focus, button, attributes, click: () => click() };
}

test("caption focus defaults off and toggles reversibly via accessible pressed state", () => {
  const ui = fixture();
  assert.equal(ui.focus.enabled(), false);
  assert.equal(ui.attributes.get("aria-pressed"), "false");
  assert.equal(ui.button.textContent, "專注閱讀");
  ui.click();
  assert.equal(ui.focus.enabled(), true);
  assert.equal(ui.attributes.get("aria-pressed"), "true");
  assert.equal(ui.button.textContent, "返回一般畫面");
  ui.click();
  assert.equal(ui.focus.enabled(), false);
  assert.equal(ui.attributes.get("aria-pressed"), "false");
});

test("explicit focus setter is idempotent and input requirements fail closed", () => {
  const ui = fixture();
  assert.equal(ui.focus.setEnabled(true), true);
  assert.equal(ui.focus.setEnabled(true), true);
  assert.equal(ui.focus.setEnabled(false), false);
  assert.throws(() => createCaptionFocusMode({ body: null, button: ui.button }));
  assert.throws(() => createCaptionFocusMode({ body: {}, button: ui.button }));
});

test("focus mode hides only secondary content, preserves essential caption controls", () => {
  const css = readFileSync("apps/web/styles.css", "utf8");
  const html = readFileSync("apps/web/index.html", "utf8");
  const main = readFileSync("apps/web/main.js", "utf8");
  assert.match(html, /id="caption-focus-toggle"[^>]*aria-pressed="false"/);
  assert.match(html, /class="panel research-panel"/);
  assert.match(css, /body\.caption-focus-mode \.research-panel/);
  assert.match(css, /body\.caption-focus-mode \.hero/);
  assert.match(css, /body\.caption-focus-mode \.quick-profile/);
  assert.match(css, /body\.caption-focus-mode \.caption \{[\s\S]*?height: clamp\(13rem, 53dvh, 38rem\)/);
  for (const name of ["start", "stop", "recall", "caption"]) {
    assert(html.includes('id="' + name + '"'), name);
    assert.doesNotMatch(css, new RegExp("body\\.caption-focus-mode\\s+#" + name + "\\s*\\{[^}]*display: none"));
  }
  assert.match(main, /createCaptionFocusMode\(\{ body: document\.body, button: els\.captionFocusToggle \}\)/);
  assert.doesNotMatch(readFileSync("apps/web/caption-focus.mjs", "utf8"),
    /AudioContext|AudioTrack|AudioWorklet|navigator\.mediaDevices|fetch\(|localStorage|sessionStorage|\.play\(/);
});
