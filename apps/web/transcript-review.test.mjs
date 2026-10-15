import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { SESSION_REVIEW_PAGE_SIZE, sessionReviewWindow } from "./transcript-review.mjs";

test("session review retains late finalized captions beyond recent 30-second buffer", () => {
  const final = Array.from({ length: 150 }, (_, i) => ({
    text: "第" + (i + 1) + "句", time: i * 1000, rawText: "raw " + i,
  }));
  const unchanged = JSON.stringify(final);
  const first = sessionReviewWindow(final);
  assert.equal(SESSION_REVIEW_PAGE_SIZE, 60);
  assert.equal(first.total, 150);
  assert.equal(first.hiddenCount, 90);
  assert.equal(first.items.length, 60);
  assert.equal(first.items[0].text, "第91句");
  assert.equal(first.items.at(-1).text, "第150句");
  const earlier = sessionReviewWindow(final, 120);
  assert.equal(earlier.hiddenCount, 30);
  assert.equal(earlier.items[0].text, "第31句");
  assert.equal(sessionReviewWindow(final, 180).hiddenCount, 0);
  assert.equal(JSON.stringify(final), unchanged, "read-only projection");
});

test("new session is isolated and empty review does not add provisional text", () => {
  const oldSession = [{ text: "上一段談話", time: 42 }];
  const nextSession = [];
  assert.equal(sessionReviewWindow(oldSession).total, 1);
  assert.deepEqual(sessionReviewWindow(nextSession), { items: [], total: 0, hiddenCount: 0 });
  assert.deepEqual(sessionReviewWindow(null), { items: [], total: 0, hiddenCount: 0 });
  assert.equal(sessionReviewWindow(oldSession, Number.NaN).items.length, 1);
});

test("session-only review is wired to finalized finals and manual paging controls", () => {
  const main = readFileSync("apps/web/main.js", "utf8");
  const html = readFileSync("apps/web/index.html", "utf8");
  const css = readFileSync("apps/web/styles.css", "utf8");
  assert.match(main, /sessionReviewWindow\(sessionFinals, reviewVisibleCount\)/);
  assert.match(main, /reviewVisibleCount \+= SESSION_REVIEW_PAGE_SIZE/);
  assert.match(main, /lastFullReviewSignature/);
  assert.match(main, /if \(signature === lastFullReviewSignature\) return/);
  assert.match(main, /recallView = "recent";/);
  assert.match(main, /sessionFinals\.length = 0;/);
  assert.match(main, /els\.recallComplete\?\.addEventListener\("click", \(\) => chooseRecallView\("session"\)\)/);
  assert.match(main, /els\.recallLoadEarlier\?\.addEventListener\("click", loadEarlierSessionCaptions\)/);
  assert.match(main, /text\.textContent = item\.text/);
  assert.match(main, /els\.recallList\.setAttribute\("aria-live", "off"\)/);
  assert.match(html, /id="recall-recent"[^>]*aria-pressed="true"/);
  assert.match(html, /id="recall-complete"[^>]*aria-pressed="false"/);
  assert.match(html, /id="recall-load-earlier"[^>]*hidden/);
  assert.match(css, /\.recall-list\.full-session-review/);
  assert.match(css, /max-height: min\(48dvh, 30rem\)/);
  assert.doesNotMatch(readFileSync("apps/web/transcript-review.mjs", "utf8"),
    /AudioContext|AudioTrack|AudioWorklet|fetch\(|localStorage|sessionStorage|innerHTML|\.play\(/);
});
