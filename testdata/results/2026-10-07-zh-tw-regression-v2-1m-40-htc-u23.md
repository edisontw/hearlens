# HTC U23 1 m Auto vs Far/Noisy safety A/B — 2026-10-07

## Purpose

Check whether the stronger Android voice-processing path that helped at 2 m remains safe and useful at a normal 1 m conversation distance before considering any global Auto-policy change.

## Completed controlled metadata

The exported reports contain incomplete metadata. Per operator confirmation, record both runs as:

- Build: `20261007-device-gate1`
- Source: `zh-tw-regression-v2`
- Receiving device: **HTC U23**
- Distance: **1 m**
- Playback volume field: **40**
- Environment: **room**
- Input mode: adaptive
- Adaptive target: `-48 dBFS`
- Gain range: `1x–8x`

The raw exported reports are not rewritten. This result note completes the missing test metadata.

## A — Auto / raw

Runtime:

- preset: `auto`
- capture: `raw`
- actual echo cancellation: `false`
- actual noise suppression: `false`
- actual AGC: `false`
- sample rate: 48 kHz

Final transcript retained only two short fragments:

- `一段，今天天氣不錯，我們下午 3 點`
- `路段，請記得帶健保卡、手機和雨傘。`

Telemetry showed adaptive gain moving through its normal range with no retained limiter reduction and `0.00%` clipping.

## B — Far / Noisy / voice

Runtime:

- preset: `far-noisy`
- capture: `voice`
- actual echo cancellation: `true`
- actual noise suppression: `true`
- actual AGC: `true`
- sample rate: 48 kHz

The retained final transcript was substantially more continuous, covering:

- date/opening recognition,
- fixed-position / playback-volume instruction,
- the first daily-language sentence and 3 PM meeting,
- health card / phone / umbrella,
- start of the third instruction.

The run still did not retain the complete locked source, so it is not a formal accuracy benchmark.

Telemetry showed the voice path producing substantially stronger speech-active peaks, including some near about `-15 dBFS`, while retained limiter reduction remained `0.0 dB` and clipping remained `0.00%`.

## Decision

**PASS — HTC U23 1 m safety A/B.**

Voice capture did not show an obvious normal-distance penalty in this run and materially improved transcript continuity compared with Auto/raw.

Current product policy remains:

- `Auto = raw`
- `Far / Noisy = voice`

Reason: the evidence now supports the user-selectable voice preset on two device paths, but a global Auto change would apply to browser/device combinations whose EC/NS/AGC behavior has not been characterized.

No additional Near/Normal preset is justified. Stop repeating the same distance matrix unless a later processing change reopens the question.
