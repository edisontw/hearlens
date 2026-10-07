import assert from "node:assert/strict";
import test from "node:test";

import {
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
