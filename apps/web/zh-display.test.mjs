import assert from "node:assert/strict";
import test from "node:test";

import {
  installOpenCC,
  toTaiwanTraditional,
} from "./zh-display.js";

test("display conversion uses OpenCC cn to tw without phrase localization", () => {
  let options = null;

  installOpenCC({
    Converter(value) {
      options = value;
      return (text) => text
        .replaceAll("汉", "漢")
        .replaceAll("语", "語");
    },
  });

  assert.deepEqual(options, {
    from: "cn",
    to: "tw",
  });
  assert.equal(toTaiwanTraditional("汉语 OpenAI"), "漢語 OpenAI");
});
