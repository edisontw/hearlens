# First 12-round delivery review — 2026-11-02

**Scope:** the initial continuous-delivery policy reset and its first eleven completed PRs (#95–#105); this review is the twelfth round. **Evidence baseline:** GitHub `main` `a26152b23999f6ca5d3c639ac6eb79a15d898a33`, read afresh on 2026-11-02. This review changes work order, not acoustic evidence or authorization. [Active roadmap](./ROADMAP.md) remains authoritative.

## Delivered value (merged and traceable)

| Work | Merged PRs | Observable result / boundary |
| --- | --- | --- |
| Priority reset | [#95](https://github.com/edisontw/hearlens/pull/95) | Caption-first plan, bounded M04 evidence gates and roadmap link. |
| Caption lifecycle and cleanup | [#96](https://github.com/edisontw/hearlens/pull/96), [#98](https://github.com/edisontw/hearlens/pull/98) | Explicit Stop and failed-start/fatal cleanup fail closed; restart requires reload when microphone cleanup is uncertain. |
| Caption reading and accessibility | [#97](https://github.com/edisontw/hearlens/pull/97), [#99](https://github.com/edisontw/hearlens/pull/99), [#100](https://github.com/edisontw/hearlens/pull/100), [#101](https://github.com/edisontw/hearlens/pull/101), [#102](https://github.com/edisontw/hearlens/pull/102) | Review focus restoration, return-to-latest, focus restoration after jump, and stable scroll intent across font-size/focus-mode changes. Chromium coverage includes long text and portrait/landscape layouts. |
| Optional STT fatal interruption | [#103](https://github.com/edisontw/hearlens/pull/103), [#105](https://github.com/edisontw/hearlens/pull/105) | Google STT proxy disconnect and terminal Browser SpeechRecognition errors stop/release instead of silently continuing or endlessly retrying. No automatic microphone restart. |
| M04 offline analysis | [#104](https://github.com/edisontw/hearlens/pull/104) | Read-only six-chirp presence detector with synthetic positive/negative controls and CI integration; no AIR31 acoustic claim. |

**Balance:** 9 M01 code PRs, 1 M04 tool PR, 1 policy PR, and this review; **no M03 code delivery** in this window. The ~60/25/15 lane shares are guidance, not a reason to generate low-value commits. M03 gets the next ready *demonstrable* numerical/fail-closed gap; M04 remains parked when evidence is unavailable.

**Verified at baseline:** `main` CI [41388477325](https://github.com/edisontw/hearlens/actions/runs/41388477325), Chromium [41388477272](https://github.com/edisontw/hearlens/actions/runs/41388477272) and Pages [41388477343](https://github.com/edisontw/hearlens/actions/runs/41388477343) completed successfully for `a26152b2`. M04 Android bench [41383010166](https://github.com/edisontw/hearlens/actions/runs/41383010166) passed for `6b8e3c91`. These are software/build checks only. No Moto g62 real-use UX acceptance or AIR31 earbud acoustic detection was obtained.

## Avoidable work and what to stop

- #99–#102 formed four consecutive scroll/focus adjustments. Their regression coverage now exists; **do not keep revisiting this surface without a new reproducible defect**.
- Several PRs required cache-busted web asset/build-ID synchronization before CI passed. Treat version synchronization as part of each relevant web change and let existing consistency tests reject omissions. Do not open a standalone cosmetic version-only PR.
- #104 adds a detector, **not a new recorded signal**. Synthetic chirp PASS, Android accepted frames, A2DP route and playback cursor must not be counted as acoustic presence or latency. No repeated demand for a fresh WAV each hour.
- Historical unchecked roadmaps, SW1–SW4 tests and the old 24-run caption-distance matrix remain non-actionable for this phase.

## Reordered independently shippable queue

1. **A / highest ready value:** audit the primary Gemini 3.5 Transcribe Live + MN4 token-broker startup, token expiry, network loss and user-visible recovery path. Compare current code and existing tests first; implement only a reproducible unhandled case with a focused regression. Do **not** alter gain, model or capture preprocessing.
2. **A / combined acceptance gate:** ensure the existing tests collectively cover Start/Stop, last-final retention, recent/full review, focus/large text and interrupted restart. When a single high-information manual check becomes justified, propose **one** ~5-minute everyday-use caption session on existing Moto g62; no formal STT accuracy matrix or recording upload. Do not create duplicate tests in its place.
3. **C / next available offline slice:** inspect left/right independence, CAMFIT→WDRC synthetic bridge, malformed callback inputs, and final digital limiter. Fix only an evidenced numeric or fail-closed gap with deterministic regression; no live sink, acoustic MPO or clinical claim.
4. **B / conditional only:** audit existing D6.2 summaries and any *actually available* raw WAV/metadata with #104 presence/identity controls. If no original AIR31 output WAV exists, mark acoustic presence **UNVERIFIED** and work on A/C. A future off-ear L1 output-only check requires the documented readiness gate and bounded single session; no volume/cap increase or worn playback.
5. **D / overrides:** confirmed privacy, microphone fail-stop, output-safety or CI regression takes precedence over this order.

## Remaining hard gates

- **P0 hearing output:** no verified earbud-specific AIR31 acoustic signal, phone-mic→earbud acoustic latency, physical speaker-fallback protection or calibrated left/right ear SPL/MPO. Worn live amplification remains **BLOCKED**.
- **M01 product acceptance:** automated browser checks are not proof of intelligibility or comfortable everyday use on Moto g62. Keep captions usable as an independent product and defer the one manual acceptance until it answers a clear decision.
- **M03:** research-only numerical behavior, no physical calibration or hearing-aid efficacy claim.

**Next review:** after twelve more delivery rounds, assess *functional* outcomes and unproductive loops rather than counting commits. No test data, hardware readings, user authorization or real-world acceptance was created by this document.
