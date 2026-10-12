import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = 'apps/android-mic-probe';
const main = readFileSync(`${base}/app/src/main/java/org/hearlens/micprobe/MainActivity.java`, 'utf8');
const manifest = readFileSync(`${base}/app/src/main/AndroidManifest.xml`, 'utf8');

test('SW1 is an explicitly foreground, input-only, no-output probe', () => {
  for (const forbidden of [
    /new\s+AudioTrack\s*\(/,
    /AudioTrack\.Builder/,
    /\bMediaPlayer\s*\(/,
    /\bSoundPool\s*\(/,
    /\bAudioTrack\.write\s*\(/,
    /\bsetContentUri\s*\(/,
    /\bFileOutputStream\s*\(/,
    /\bHttpURLConnection\b/,
    /\bWebSocket\b/,
  ]) {
    assert.doesNotMatch(main, forbidden);
  }
  assert.match(main, /new AudioRecord\.Builder\(\)/);
  assert.match(main, /buffer\[i\] = 0;/);
  assert.match(main, /MAX_CAPTURE_MS\s*=\s*30_000L/);
  assert.match(main, /onPause\(\)[\s\S]*?stopCapture\("app_left_foreground"\)/);
  assert.match(main, /getRoutedDevice\(\)/);
  assert.match(main, /selected_input_route_changed/);
  assert.match(main, /selected_mic_unplugged/);
  assert.doesNotMatch(manifest, /android\.permission\.INTERNET/);
  assert.doesNotMatch(manifest, /<service\b/);
  assert.match(manifest, /android\.permission\.RECORD_AUDIO/);
  assert.match(manifest, /android\.permission\.BLUETOOTH_CONNECT/);
});

test('probe documents key acoustic and software uncertainty', () => {
  const guide = readFileSync(`${base}/README.md`, 'utf8');
  for (const term of ['UNPROCESSED', 'actual Bluetooth acoustic end-to-end latency',
      'no AudioTrack', 'no internet permission', 'calibrated MPO', 'not guarantees']) {
    assert.ok(guide.toLowerCase().includes(term.toLowerCase()), term);
  }
});

test('SW1 does not mislabel an expected stop-unblocked read as an input fault', () => {
  assert.match(main, /if \(size <= 0\)\s*\{[\s\S]*?finishReason = running\.get\(\) \? "read_error_" \+ size : "capture_stopped";/);
  assert.match(main, /if \(!running\.getAndSet\(false\)\) return;/);
  assert.match(main, /stop_requested=/);
});


test('SW3-Native only predicts future media/accessibility routing on Android API33+', () => {
  assert.match(main, /Build\.VERSION\.SDK_INT >= 33/);
  assert.match(main, /getAudioDevicesForAttributes\(mediaAttrs\)/);
  assert.match(main, /getAudioDevicesForAttributes\(accessAttrs\)/);
  assert.match(main, /AudioAttributes\.USAGE_MEDIA/);
  assert.match(main, /AudioAttributes\.USAGE_ASSISTANCE_ACCESSIBILITY/);
  assert.match(main, /SW3_OUTPUT_PREDICTION/);
  assert.match(main, /SW3_OUTPUT_ACTUAL_ROUTE=UNOBSERVABLE_NO_PLAYBACK/);
  assert.match(main, /speaker_fallback_prevention=NOT_VERIFIED/);
  assert.match(main, /SW3_COMMUNICATION_SELECTED_NOT_MEDIA_ROUTE/);
  assert.match(main, /UNAVAILABLE_API_BELOW_33/);
  assert.match(main, /inspectOutputRoute\("devices-added"\)/);
  assert.match(main, /inspectOutputRoute\("devices-removed"\)/);
  assert.match(main, /inspectOutputRoute\("activity-resumed"\)/);
  assert.match(main, /檢查媒體輸出預測（完全不播放）/);
  assert.doesNotMatch(main, /\bnew\s+AudioTrack\s*\(/);
  assert.doesNotMatch(main, /\bnew\s+MediaPlayer\s*\(/);
  assert.doesNotMatch(main, /\bAudioTrack\.Builder\s*\(/);
  assert.doesNotMatch(main, /\bgetPlaybackHeadPosition\s*\(/);
  assert.doesNotMatch(manifest, /android\.permission\.INTERNET/);
});

test('SW3-Native preserves input choice and restores audio mode even if headset route request was rejected', () => {
  assert.match(main, /int keepInput = previous == null \? -1 : previous\.id/);
  assert.match(main, /if \(choices\.get\(i\)\.id == keepInput\)/);
  assert.match(main, /communicationModeChanged = true/);
  assert.match(main, /if \(!communicationRequested && !communicationModeChanged\) return/);
  assert.match(main, /if \(communicationModeChanged\) manager\.setMode\(priorAudioMode\)/);
});
