# HearLens continuous delivery and evidence gates — 2026-11-02

**Status:** active hourly work policy. [ROADMAP](./ROADMAP.md) remains the single current work-order index. This policy replaces *priority/order* assumptions in older handoffs and archived roadmaps; it does not erase historical evidence or relax [SAFETY](./SAFETY.md).

## Product outcome and non-negotiable boundaries

Deliver a useful **caption-first** everyday communication assistant while keeping Bluetooth hearing-path feasibility as a separate, bounded research question.

- Primary input: phone built-in microphone. Preferred future output: ordinary Bluetooth earphones. Existing equipment: Moto g62 / Android 13, AIR31 A2DP, iPhone source, Windows Realtek 3.5-mm microphone.
- No purchase, compulsory extra mic, ear-canal seal, wired-headphone migration, mandatory talker-side placement, SCO earbud-mic matrix, SDK/ODM procurement or repeated SW1–SW4 field trials.
- M01 Gemini 3.5 Transcribe Live / MN4 token broker and caption preprocessing are protected baselines. Do not change STT provider, capture gain, VAD or normalization without reproducible failure evidence and a focused regression gate.
- M03 audiogram, CAMFIT and WDRC remain **offline research only**. No audiogram dB HL → direct playback gain or unverified clinical prescription/real-ear benefit claims.
- M04 D3 permits only the existing low-level **off-ear** acoustic bench under its explicit bounds and fail-stop rules. It does **not** authorize worn live amplification, speaker fallback, acoustic MPO or a clinical hearing claim. Real-time worn hearing stays **BLOCKED**.

## Delivery lanes and rotation

Allocate effort by *valuable, ready-to-merge slices*, not mandatory quota or a fixed calendar:

| Lane | Approximate share | Deliverable and evidence |
| --- | ---: | --- |
| A — M01 usable captions | 60% | Foreground Start/Stop, large/focus view, recent/full-session review, interruption recovery, clear privacy/status; deterministic unit and mobile-viewport browser tests |
| B — M04 feasibility | 25% | Existing evidence audit, signal-presence/identity analysis, negative controls and bounded off-ear readiness; never infer acoustic output from A2DP routing, accepted frames or playback cursor |
| C — M03 offline DSP | 15% | Targeted regression on per-ear independence, malformed input, final digital limiter, deterministic CAMFIT/WDRC fixtures; no live sink |

A confirmed safety, privacy, data-loss or CI regression takes precedence over these shares. If B requires new physical evidence, **park B and work on A or C in the same round**; do not spend hours rewriting the same request for recordings. No change is preferable to cosmetic churn.

## Next independently shippable queue

1. **A1 — caption lifecycle acceptance:** audit current Start/Stop, permission cancellation, pagehide, muted/ended track and manual recovery paths against existing tests. Add a focused failing test and smallest safe fix only for a verified gap. No new real-phone recording required.
2. **A2 — accessible everyday use:** verify focus-mode Start/Stop visibility, font size, final-caption retention through silence, recent/complete review and user-initiated copy at mobile portrait/landscape widths. Use existing Playwright/Node tests; avoid duplicating already-tested features.
3. **A3 — observable failures:** ensure actionable, nonmisleading status and recovery messaging for token/network/permission interruption without auto-reopening the microphone. Preserve memory-only transcript and pre-capture cloud-STT disclosure.
4. **B1 — D6.2 measurability review:** reuse committed D4–D6.2 notes, metadata and available recordings; distinguish source landmarks from earbud-specific output, analyze event windows and negative controls before proposing any physical trial. The L1 nominal post-track digital cap is about **−44.6 dBFS before unknown OS/earbud transfer**, not ear SPL.
5. **B2 — conditional output-only trial:** only if B1 establishes a plausible detectable signal and clear one-session acceptance. Use six known chirps, AIR31 off ears, fixed near-mic geometry, existing L1 bounds and a live visibility check. Positive means six identifiable acoustic events absent from a silence control. If not observable, record `NOT_MEASURABLE_AT_CURRENT_SETTINGS`; at most one explicitly justified correction/retest, then park. No blind level escalation.
6. **B3 — conditional coarse architecture screen:** only after B2 acoustic presence. Use nonperiodic distinguishable source landmarks in one synchronized recording, with geometry and identity controls. Report uncertainty; no independent-WAV timestamp subtraction, validated P95/jitter or acoustic SPL claim.
7. **C1 — offline safety regressions:** choose one reproducible numerical or fail-closed gap in existing synthetic DSP tests; never connect DSP output to a real headset without separate physical safety and calibration gates.

These are candidates, not instructions to create duplicate tests. Before each slice inspect the latest code and mark already-covered cases as complete. The M01 formal 24-run accuracy matrix remains deferred until the processing pipeline is frozen; it is **not** a prerequisite for everyday UX progress.

## Hourly execution contract

1. Re-fetch live GitHub `main` SHA, recent commits, open PR/issues, relevant CI and Pages workflow status. Read README, ROADMAP, SAFETY, D6.2 evidence reset and TEST_PROTOCOL before touching code; inspect relevant source and tests. Never reuse a prior hour's SHA.
2. Select **one** small, reversible, independently verifiable slice with a concrete user outcome and a failing test or clear acceptance condition. Avoid speculative tuning and rework of accepted hardware tests.
3. Create a feature branch, make the smallest relevant change, run available focused tests and full applicable checks, then open a reviewable PR. Record commands/results honestly; remote CI is distinct from local test success.
4. Merge autonomously only for low-risk, reversible changes with required CI successful and no unresolved safety or review gate. Re-fetch merged `main` SHA and its checks. On write/permission rejection, do **not** bypass or repeatedly retry; leave an auditable blocker and switch to another independent slice.
5. Record a short Traditional-Chinese outcome: starting/ending SHA, files, PR/commit, verified tests/CI, unresolved P0 blockers and next slice. Use `NO_CHANGE` if nothing defensible was delivered.

Every **12 rounds**, review merged functional outcomes, open failures, unproductive loops and remaining manual gates; reorder this queue based on evidence, not the number of commits. A documentation-only round is justified for this one-time priority reset or a material safety/evidence decision, not as a routine substitute for implementation.

## Acceptance and stop rules

- **M01 software acceptance:** focused unit + existing Node suite and applicable browser/mobile-viewport CI pass; user-facing Start/Stop/review/status flows remain intact. A future single ~5-minute real-use session may validate UX, but is not formal STT accuracy or a demand for uploads.
- **M04 acoustic gate:** source playback/drain/route counters alone never satisfy earbud acoustic presence. Without a distinguishable recorded output and negative control, do not attempt mic-to-ear latency. The lack of data is an explicit `UNVERIFIED` or `NOT_MEASURABLE_AT_CURRENT_SETTINGS`, not a pass or a measured delay.
- **M03 gate:** offline numerical consistency and digital clipping limits do not establish calibrated per-ear MPO, physical speaker isolation or human benefit.
- **Hard stop:** no worn amplified output, arbitrary output cap/volume increase, or new clinical performance claim. See [SAFETY](./SAFETY.md) and [D6.2 evidence reset](./M04D62_DIAGNOSTICS_AND_PROGRESS_RESET_2026-10-22.md).

## Baseline at reset

Checked 2026-11-02 against live `main` `294c10d2b8b787ee727a1ec9b733b4b536dfaef1`: no open PR/issues returned; CI and Android M04 off-ear APK workflows completed successfully for that SHA. Those are **software/build checks only**. No D6.2 physical acoustic PASS, validated phone-mic→AIR31 delay, ear SPL or worn safety approval is established. The Pages deployment endpoint could not be independently queried in this reset; the repository's `.github/workflows/pages.yml` remains the deploy specification, and docs-only edits do not trigger that workflow.
