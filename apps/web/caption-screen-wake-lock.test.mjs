import assert from "node:assert/strict";
import test from "node:test";
import { createCaptionScreenWakeLock } from "./caption-screen-wake-lock.mjs";

function fakeSentinel() {
  const listeners = new Map();
  return {
    releases: 0,
    addEventListener(type, callback) { listeners.set(type, callback); },
    async release() {
      this.releases += 1;
      listeners.get("release")?.();
    },
    emitRelease() { listeners.get("release")?.(); },
  };
}

test("caption wake lock is optional on unsupported browsers", async () => {
  const states = [];
  const guard = createCaptionScreenWakeLock({ onState: (value) => states.push(value) });
  assert.equal(await guard.start(), "unsupported");
  guard.stop();
  assert.deepEqual(states, ["unsupported", "idle"]);
});

test("a granted lock is held only while captions are active; duplicate starts do not allocate", async () => {
  const lock = fakeSentinel();
  let calls = 0;
  const states = [];
  const guard = createCaptionScreenWakeLock({
    requestWakeLock: async (type) => {
      assert.equal(type, "screen");
      calls += 1;
      return lock;
    },
    onState: (value) => states.push(value),
  });
  assert.equal(await guard.start(), "held");
  assert.equal(await guard.start(), "held");
  assert.equal(calls, 1);
  guard.stop();
  await Promise.resolve();
  assert.equal(lock.releases, 1);
  assert.equal(guard.getState(), "idle");
  assert.deepEqual(states, ["requesting", "held", "idle"]);
});

test("Stop or pagehide while permission is pending immediately invalidates stale grant", async () => {
  let allow;
  const request = new Promise((resolve) => { allow = resolve; });
  const lock = fakeSentinel();
  const states = [];
  const guard = createCaptionScreenWakeLock({
    requestWakeLock: () => request,
    onState: (value) => states.push(value),
  });
  const pending = guard.start();
  guard.stop();
  allow(lock);
  assert.equal(await pending, "cancelled");
  assert.equal(lock.releases, 1);
  assert.equal(guard.getState(), "idle");
  assert.deepEqual(states, ["requesting", "idle"]);
});

test("older request cannot overwrite a newer caption session", async () => {
  const completions = [];
  const issued = [];
  const guard = createCaptionScreenWakeLock({
    requestWakeLock: () => new Promise((resolve) => { completions.push(resolve); }),
    onState: (state) => issued.push(state),
  });
  const old = guard.start();
  guard.stop();
  const current = guard.start();
  const oldLock = fakeSentinel();
  const newLock = fakeSentinel();
  completions[0](oldLock);
  assert.equal(await old, "cancelled");
  completions[1](newLock);
  assert.equal(await current, "held");
  assert.equal(oldLock.releases, 1);
  assert.equal(newLock.releases, 0);
  guard.stop();
  await Promise.resolve();
  assert.equal(newLock.releases, 1);
});

test("rejected or malformed wake lock never blocks captions and does not leak", async () => {
  const failures = [
    () => { throw new Error("SecurityError"); },
    async () => { throw new Error("NotAllowedError"); },
    async () => null,
  ];
  for (const requestWakeLock of failures) {
    const guard = createCaptionScreenWakeLock({ requestWakeLock });
    assert.equal(await guard.start(), "unavailable");
    assert.equal(guard.getState(), "unavailable");
    guard.stop();
    assert.equal(guard.getState(), "idle");
  }
});

test("OS-initiated release is reported without retry or auto-resume", async () => {
  const lock = fakeSentinel();
  let calls = 0;
  const guard = createCaptionScreenWakeLock({
    requestWakeLock: async () => { calls++; return lock; },
  });
  assert.equal(await guard.start(), "held");
  lock.emitRelease();
  assert.equal(guard.getState(), "released");
  assert.equal(await guard.start(), "released");
  assert.equal(calls, 1);
  guard.stop();
  assert.equal(lock.releases, 0);
});
