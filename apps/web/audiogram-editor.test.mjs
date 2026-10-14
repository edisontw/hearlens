import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  AUDIOGRAM_INPUT_FREQUENCIES,
  parseThreshold,
  profileFromFormData,
  formDataFromProfile,
  measurementCount,
} from "./audiogram-editor.mjs";
import {
  normalizeAudiogramProfile,
  serializeAudiogramProfile,
  deserializeAudiogramProfile,
} from "../../packages/audiogram/audiogram.mjs";

const inputs = () => ({
  left: {
    thresholds: ["", "0", "20", "", "65", "75"],
    source: "clinical-report", measuredOn: "2026-10-14",
  },
  right: {
    thresholds: ["", "", "15", "20", "", ""],
    source: "manual", measuredOn: "",
  },
});

test("form uses the six existing schema frequencies and never substitutes zero for missing", () => {
  assert.deepEqual(AUDIOGRAM_INPUT_FREQUENCIES, [250, 500, 1000, 2000, 4000, 8000]);
  const profile = normalizeAudiogramProfile(profileFromFormData(inputs()));
  assert.equal(profile.ears.left.thresholdsDbHL[250], null);
  assert.equal(profile.ears.left.thresholdsDbHL[500], 0);
  assert.equal(profile.ears.left.thresholdsDbHL[2000], null);
  assert.equal(profile.ears.right.thresholdsDbHL[1000], 15);
  assert.equal(profile.ears.right.provenance.measuredOn, null);
  assert.equal(measurementCount(profile), 6);
});

test("empty ear is null; opposite ear data is not copied or inferred", () => {
  const data = inputs();
  data.left.thresholds = ["", "", "", "", "", ""];
  const normalized = normalizeAudiogramProfile(profileFromFormData(data));
  assert.equal(normalized.ears.left, null);
  assert.equal(normalized.ears.right.thresholdsDbHL[2000], 20);
  assert.deepEqual(formDataFromProfile(normalized).left.thresholds, ["", "", "", "", "", ""]);
});

test("JSON import/export roundtrip uses the original M03 serializer unchanged", () => {
  const expected = normalizeAudiogramProfile(profileFromFormData(inputs()));
  const encoded = serializeAudiogramProfile(expected);
  const decoded = deserializeAudiogramProfile(encoded);
  const form = formDataFromProfile(decoded);
  assert.deepEqual(form, inputs());
  assert.equal(serializeAudiogramProfile(normalizeAudiogramProfile(profileFromFormData(form))), encoded);
  assert.equal(Object.keys(JSON.parse(encoded)), 2);
});

test("invalid, missing and coercible measurements fail closed", () => {
  assert.equal(parseThreshold(""), null);
  assert.equal(parseThreshold("0"), 0);
  assert.equal(parseThreshold("-20"), -20);
  assert.equal(parseThreshold("130"), 130);
  for (const value of ["  ", "Infinity", "NaN", "1e2", "abc", "131", "-21", "0x20", "15,5", "100%"]) {
    // Blank whitespace must not become zero or a measurement.
    assert.throws(() => parseThreshold(value), value);
  }
  for (const value of ["NaN", "200", "true"]) {
    const data = inputs();
    data.left.thresholds[1] = value;
    assert.throws(() => normalizeAudiogramProfile(profileFromFormData(data)));
  }
  for (const mutate of [
    d => { d.left.measuredOn = "2026-02-29"; },
    d => { d.left.source = "unknown"; },
    d => { d.left.thresholds.pop(); },
    d => { d.left.thresholds.fill(""); d.right.thresholds.fill(""); },
  ]) {
    const data = inputs();
    mutate(data);
    assert.throws(() => normalizeAudiogramProfile(profileFromFormData(data)));
  }
});

test("new profile route is reachable and never attaches to amplified PCM playback", () => {
  const home = readFileSync("apps/web/index.html", "utf8");
  const html = readFileSync("apps/web/audiogram.html", "utf8");
  const source = readFileSync("apps/web/audiogram-page.mjs", "utf8");
  const deploy = readFileSync(".github/workflows/pages.yml", "utf8");
  assert.match(home, /href="\.\/audiogram\.html"/);
  for (const name of ["profile-save", "profile-export", "profile-import", "profile-clear", "profile-chart"]) {
    assert(html.includes('id="' + name + '"'));
  }
  for (const ear of ["left", "right"]) for (const f of AUDIOGRAM_INPUT_FREQUENCIES) {
    assert(html.includes('id="' + ear + "-" + f + '"'));
  }
  assert.match(html, /localStorage/);
  assert.match(source, /deserializeAudiogramProfile/);
  assert.match(source, /serializeAudiogramProfile/);
  assert.match(source, /localStorage\.setItem/);
  assert.match(source, /localStorage\.removeItem/);
  assert.match(deploy, /cp packages\/audiogram\/audiogram\.mjs apps\/web\/audiogram-domain\.mjs/);
  assert.doesNotMatch(source, /AudioContext|AudioWorklet|AudioTrack|AudioRecord|mediaDevices|getUserMedia|\.play\(/);
  assert.doesNotMatch(html, /<audio|<video/);
});
