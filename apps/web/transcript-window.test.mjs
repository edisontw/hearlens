import assert from "node:assert/strict";
import test from "node:test";

import {
  currentCaptionText,
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
