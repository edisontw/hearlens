import assert from "node:assert/strict";
import test from "node:test";
import { LocalTaigiProvider } from "./local-taigi.js";

test("local Taigi captions stay in source audio order when inference replies finish out of order", () => {
  const texts = [];
  const provider = new LocalTaigiProvider({ onFinal: item => texts.push(item.text) });

  provider.completeSegment(2, "第二段");
  assert.deepEqual(texts, []);
  provider.completeSegment(1, "第一段");
  assert.deepEqual(texts, ["第一段", "第二段"]);
});

test("empty local Taigi results advance the ordered caption sequence", () => {
  const texts = [];
  const provider = new LocalTaigiProvider({ onFinal: item => texts.push(item.text) });

  provider.completeSegment(1, "");
  provider.completeSegment(2, "第二段");
  assert.deepEqual(texts, ["第二段"]);
});
