# HearLens architecture reassessment handoff — 2026-10-12

**Source of truth:** always fetch GitHub `main` and verify SHA/CI before changes. At drafting, `main` = `dee8a2c52166d80a5d4f6b24bb151bd53fc901af`, `web-static-check` PASS. This SHA is historical after this document is committed.

## Purpose and evidence boundary

This handoff incorporates the user's supplied summary of a Deep Research study, *Low-latency personalized hearing assistance and Bluetooth-headset architecture*, and the current repository records. The summary is available in the 2026-10-12 conversation; **the complete underlying research report was not independently inspected here**. Detailed study figures/API coverage must be validated against the full report and original technical sources before implementation claims or product requirements are frozen. Supplementary spot-check of official Android/Apple developer documentation shows that public Bluetooth profile/stream status APIs should not be confused with generic access to on-ear DSP.

References in repository:
- [M04_BLUETOOTH_EVALUATION.md](./M04_BLUETOOTH_EVALUATION.md) — existing Bluetooth-first plan, wired as *measurement control*, not default product
- [ROADMAP.md](./ROADMAP.md)
- [PRODUCT_VISION.md](./PRODUCT_VISION.md)
- [SAFETY.md](./SAFETY.md)
- [WORK_HANDOFF_M03L_2026-10-12.md](./WORK_HANDOFF_M03L_2026-10-12.md) — historical M03L implementation status; its wired-first next-step suggestion is superseded for *prioritization* by this decision and M04 Bluetooth-first record

Official API starting points:
- Android Bluetooth profiles: https://developer.android.com/reference/android/bluetooth/BluetoothProfile
- Android LE Audio: https://developer.android.com/develop/connectivity/bluetooth/ble-audio/overview
- Apple Hearing device support: https://developer.apple.com/documentation/accessibility/hearing-device-support
- Apple AudioAccessoryKit: https://developer.apple.com/documentation/audioaccessorykit

## Product constraints (priority, not optional extra hardware)

- Daily **face-to-face listening** in natural environments is the primary hearing-use scenario, with Mandarin/Taiwanese captions a separate valuable capability.
- Prefer everyday **Bluetooth earbuds/headphones** and open-fit/open-ear use as much as feasible; do not require sealed ear canal or extra/body-worn/remote microphone.
- Do not require routinely placing the phone next to the talker as a precondition for the primary daily-use hearing mode.
- Phone microphone is still available as an optional *remote-listening* aid (e.g. TV, distant talker), not an architecture that must always be used.
- No need to split into multiple apps: the eventual UX can offer distinct modes only after validated routes exist.

## Reassessment: direct sound + processing delay

Conventional hearing aids process ear-level microphone input locally at very low delay; open-fit designs may preserve the acoustically direct component, supplementing primarily the bands needing gain rather than amplifying all frequencies. A time-shifted processed copy and direct sound can interact (comb-filtering, unnatural own-voice and echo perception). A hypothetical `5 ms` path difference leads to `1 / 0.005 s = 200 Hz` peak/null periodicity in a simple equal-path two-copy model; the *audibility* depends on gain, bands, phase, fit and listener and cannot be inferred from the interval alone.

The current M03 offline `1024`-sample STFT / `256`-sample hop reports `768`-sample algorithmic lookahead (= `48 / 32 / 16 ms` at `16 / 24 / 48 kHz`). This is **not** measured microphone-to-ear delay; OS buffers, Bluetooth transport, codec, earpiece DSP and DAC can add delay. LE Audio support or an LC3 label does not demonstrate usable end-to-end delay. A phone DSP path should therefore not be assumed appropriate for continuous near-field hearing merely because its offline numerical DSP tests pass.

## Architecture candidates and current judgments

| Route | Primary use | Third-party controllability | Next decision |
| --- | --- | --- | --- |
| **A. Earbud microphone -> earbud-local transparency / DSP -> ear**; phone app may manage supported per-ear settings | Daily nearby conversation | **Unproven, likely vendor/model-specific.** No cross-brand public API for arbitrary local WDRC/EQ/transparency control is established. | **First:** verify capabilities via official APIs, SDKs, standards and named compatible devices; determine whether native app can set *genuine per-ear processing* with appropriate safety/permissions. |
| **B. Phone microphone -> native app DSP -> Bluetooth output** | TV, distance/selected settings; also an instrumented fallback POC | PCM processing is feasible as a software concept; end-to-end delay, exact input/output route, speaker fallback and acoustic safety are hardware/OS dependent. | **Second:** low-level bench measurement, not listening amplification on a person. Compare A2DP/LE Audio only if actual negotiated route can be confirmed. |
| **C. Caption/recall mode (existing M01)** | General communication and fail-safe when audio uncertain | Working browser/Gemini path, distinct from hearing output | Preserve independently, no unnecessary caption retest due to offline DSP changes. |
| Wired USB-C playback control | Controlled comparison instrument only | Known fixed test path can characterize route and processing | Keep as laboratory reference, **not** required consumer solution. |
| Custom earbud firmware/chipset / vendor companion SDK | Potential longer-term local-DSP path | Requires published SDK, partnership or hardware ownership | Evaluate as conditional route; do not assume generic AirPods controls or undocumented APIs. |

Specific checks before committing implementation:
1. Can *ordinary* Android/iOS third-party apps control the **earbud's own microphone -> transparency DSP** and per-ear WDRC/parametric gains? Distinguish discovery, GATT/HAP/VCP volume or presets, media streaming and true DSP control; enumerate exact privileges/entitlements and vendor model/firmware support.
2. Can headphones expose calibrated independent L/R gain and acoustic output bounds? Do not equate balance/volume with multiband audiogram fitting.
3. What minimum end-to-end measured latency/jitter and direct-plus-processed sound quality are *actually* delivered on target Android/earbud? Measure with external physical reference. Do not rely on theoretical codec latency or software timestamps.
4. Can a native route fail closed under disconnect, one-ear loss, focus/call, route switch, and background changes, **without any unintended physical phone-speaker output**? Preferred route APIs or callback notifications alone are insufficient.
5. Does a proposed mode need physically reproducible independent L/R coupler calibration and output/MPO limits? If yes and unavailable, it stays research-only without live human hearing output.

## Development sequence: change order before expanding M03

**M04-A: desk feasibility and API/vendor gate (next task, no hardware required).**
- Build Android/iOS/API/headset capability matrix with official references, OS version, developer permission tier, supported feature, whether ear-local WDRC/left-right processing is truly controlled, and explicit "unsupported / undocumented / requires manufacturer" markings.
- Survey candidate vendor SDK or partnership paths, with public downloadable documentation as evidence.
- Output 2–3 feasible POC architectures, effort/cost/risk, and **go/no-go on generic third-party local processing**.
- Confirm existing `M04_BLUETOOTH_EVALUATION.md`/roadmap remain consistent and update only where new, evidenced decisions warrant it.

**M04-B: physical controlled bench gate (after M04-A).**
- Fix one phone/Android version and actual Bluetooth model/firmware; add one USB-C control headset.
- Measure physical mic-to-output P50/P95/worst latency/jitter, route identity, phone-mic preservation, hard mute and phone-speaker leak, separately measured ear channels and reproducibility. Include direct-sound mixing conditions and power/thermal stability.
- Never turn on live patient/user hearing amplification until native enforced mute/no speaker fallback and calibrated per-ear output safety are verified.
- Use a nonhuman bench rig and recorded or instrumental test sources first. Define acceptance criteria before test; no arbitrary universal latency cutoff.

**Then choose M03M scope:** if local DSP programmable, prototype mobile configuration+caption UI and manufacturer-supported per-ear fitting controls. If it is not programmable, limit phone-DSP research to measured use cases where latency is tolerable, keeping M01 as stable product. Avoid optimizing a phone-STFT/WDRC algorithm into a dead-end hearing architecture.

## Current implementation / safety truth

- Latest completed offline slice at handoff: M03 Part L (guarded `processInto`, mock no-PCM route model, fail-stop tests, synthetic only). No microphone/real AudioTrack, no Bluetooth playback, no physical hard mute, no independent per-ear acoustic MPO, no proof of callback scheduling on target phone.
- M01 captions remain operational conceptually; do not reopen completed HTC 0.5/1/2 m STT engineering matrix solely for M04.
- **No live hearing amplification**, no claim of clinical fitting, no uncalibrated ear-level output; if route/calibration unknown, fail closed and allow captions.

## Next-chat checklist

1. Fetch the true latest `main` SHA and CI, read this document plus `M04_BLUETOOTH_EVALUATION.md`, `ROADMAP.md`, `SAFETY.md`, `PRODUCT_VISION.md`, `WORK_HANDOFF_M03L_2026-10-12.md`.
2. Obtain/check full Deep Research report if accessible; distinguish supplied summary, verified platform specs, measured results, and untested hypotheses.
3. Start **M04-A only**, with a standards/API/SDK capability matrix and architecture go/no-go; do not proceed to adding output or more M03 offline DSP until architectural viability is clear.
4. Preserve Bluetooth-first UX, no extra microphone, no forced ear occlusion, daily face-to-face usage. Keep wired strictly as comparative control.
