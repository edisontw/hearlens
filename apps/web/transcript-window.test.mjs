import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  currentCaptionText,
  retainedCaptionText,
  completeSessionTranscriptText,
  recentTranscriptItems,
  recentTranscriptText,
  relativeTranscriptTime,
} from "./transcript-window.mjs";

test("recent transcript keeps only non-empty items inside the rolling window", () => {
  const now = 100_000;
  const items = [
    { text: "太舊", time: 69_999 },
    { text: "第一段", time: 70_000 },
    { text: "第二段", time: 99_000 },
    { text: " ", time: 99_500 },
  ];

  assert.deepEqual(recentTranscriptItems(items, now, 30_000), [
    { text: "第一段", time: 70_000 },
    { text: "第二段", time: 99_000 },
  ]);
});

test("recent transcript text preserves segment boundaries", () => {
  assert.equal(
    recentTranscriptText([
      { text: "第一段" },
      { text: "第二段" },
    ]),
    "第一段\n第二段",
  );
});

test("relative labels are intentionally coarse and readable", () => {
  const now = 100_000;
  assert.equal(relativeTranscriptTime(98_000, now), "剛剛");
  assert.equal(relativeTranscriptTime(88_000, now), "12 秒前");
  assert.equal(relativeTranscriptTime(35_000, now), "1 分鐘前");
});

test("live main caption expires old final segments exactly after 30 seconds", () => {
  const now = 100_000;
  const items = [
    { text: "已過期", time: 69_999 },
    { text: "保留邊界", time: 70_000 },
    { text: "最新內容", time: 99_500 },
  ];
  const clone = JSON.stringify(items);
  assert.equal(currentCaptionText(items, "", null, now, 30_000),
    "保留邊界 最新內容");
  assert.equal(currentCaptionText(items, "", null, now + 501, 30_000),
    "最新內容");
  assert.equal(currentCaptionText(items, "", null, now + 30_001, 30_000),
    "");
  assert.equal(JSON.stringify(items), clone, "presentation must not alter report history");
});

test("interim speech remains fresh only for its own 30-second window", () => {
  const finals = [{ text: "已確認", time: 80_000 }];
  assert.equal(currentCaptionText(finals, "正在辨識", 90_000, 100_000),
    "已確認 正在辨識");
  assert.equal(currentCaptionText(finals, "正在辨識", 90_000, 120_000),
    "正在辨識");
  assert.equal(currentCaptionText(finals, "正在辨識", 90_000, 120_001),
    "");
  assert.equal(currentCaptionText([], "未標時間", null, 100_000), "");
  assert.equal(currentCaptionText([], "未來資料", 101_000, 100_000), "");
});


test("complete session opt-in text includes expired finals but never modifies the source array", () => {
  // The caller supplies finalized segments only; interim text is not part of it.
  const finals = [
    { text: "醫師說明檢查結果。", time: 1_000 },
    { text: "請兩週後再回診。", time: 95_000 },
    { text: " ", time: 95_001 },
  ];
  const before = JSON.stringify(finals);
  assert.equal(completeSessionTranscriptText(finals),
    "醫師說明檢查結果。\n請兩週後再回診。");
  assert.equal(JSON.stringify(finals), before);
  assert.equal(completeSessionTranscriptText([]), "");
});

test("full-session copy is explicit, disabled without finals, and reset at each new session", () => {
  const html = readFileSync("apps/web/index.html", "utf8");
  const main = readFileSync("apps/web/main.js", "utf8");
  assert.match(html, /id="copy-complete-transcript"[^>]*disabled/);
  assert.match(html, /文字僅暫存在這個分頁/);
  assert.match(main, /completeSessionTranscriptText\(sessionFinals\)/);
  assert.match(main, /sessionFinals\.push\(item\);\s*syncCompleteTranscriptCopyButton\(\)/);
  assert.match(main, /sessionFinals\.length = 0;\s*syncCompleteTranscriptCopyButton\(\)/);
  assert.match(main, /copyCompleteTranscript\.disabled = sessionFinals\.length === 0/);
  assert.match(main, /navigator\.clipboard\.writeText\(text\)/);
  assert.match(main, /els\.copyCompleteTranscript\?\.addEventListener\("click"/);
});


test("old confirmed caption remains visible indefinitely while recent finals expire", () => {
  const now = 100_000;
  const previous = { text: "請下週回診", time: 10_000 };
  const current = { text: "請記得帶報告", time: 95_000 };
  const recent = [previous, current];
  assert.equal(retainedCaptionText(recent, current, "", null, now),
    "請記得帶報告");
  assert.equal(retainedCaptionText(recent, current, "", null, now + 60_000),
    "請記得帶報告");
  assert.equal(retainedCaptionText([], current, "", null, now + 360_000),
    "請記得帶報告");
  assert.equal(retainedCaptionText([], null, "", null, now + 360_000), "");
});

test("new recognized speech updates visible finals without pinning stale partials", () => {
  const now = 100_000;
  const prior = { text: "上段已確認", time: 60_000 };
  const fresh = { text: "最新一段", time: 95_000 };
  assert.equal(retainedCaptionText([prior, fresh], fresh, "正在辨識", 99_000, now),
    "最新一段 正在辨識");
  assert.equal(retainedCaptionText([], prior, "未完成的片段", 99_000, now),
    "上段已確認 未完成的片段");
  assert.equal(retainedCaptionText([], prior, "已過期部分", 99_000, now + 30_001),
    "上段已確認");
  assert.equal(retainedCaptionText([], null, "已過期部分", 99_000, now + 30_001),
    "");
});

test("screen clear can remove display pointers without deleting source finals or recent history", () => {
  const old = { text: "主畫面原有文字", time: 90_000 };
  const recall = [old];
  const sessionFinals = [old];
  const displayed = [old];
  let pinned = old;
  displayed.length = 0;
  pinned = null;
  assert.equal(retainedCaptionText(displayed, pinned, "", null, 100_000), "");
  assert.equal(recentTranscriptText(recall), "主畫面原有文字");
  assert.equal(completeSessionTranscriptText(sessionFinals), "主畫面原有文字");
  displayed.push({ text: "清除後的新字幕", time: 100_010 });
  pinned = displayed[0];
  assert.equal(retainedCaptionText(displayed, pinned, "", null, 100_020),
    "清除後的新字幕");
});
