# Product Vision

## Problem

Older adults may already own hearing aids but do not always wear them. HearLens explores a practical backup path using the phone already at hand.

The product is not defined as "a hearing aid in a browser." Its first job is to improve communication when hearing is difficult.

## Primary use cases

1. Open HearLens on a phone and obtain large, fast captions.
2. Move the phone closer to the talker or sound source when speech is unclear.
3. Review the last few seconds with a "What did they just say?" action.
4. When supported, optionally add conservative personalized sound processing through a known headset.

## Product hypothesis

A combination of:

- phone-near-talker capture,
- low-latency Taiwan Mandarin captions,
- recent-transcript recall,
- conservative audiogram-aware processing,

may improve speech understanding and reduce listening effort in real-world situations such as clinics, restaurants, TV viewing, cars and family conversations.

## Non-goals for MVP

- replacing a professionally fitted hearing aid,
- fitting severe/profound hearing loss,
- claiming medical-grade compensation on arbitrary phones/headphones,
- claiming universal low-latency or acoustically safe live hearing output on arbitrary Bluetooth earbuds; Bluetooth is the **preferred user-facing headset direction**, subject to device-specific latency, actual-route/no-speaker-fallback and per-ear calibration gates,
- requiring another person to wear a microphone,
- requiring account creation.

## UX principle

The older user's home screen should expose only the minimum actions:

- **Start**
- **What did they just say?**
- **Make text larger**
- optional simple "sound too soft / too loud" controls only after a supported hearing path exists.

Technical settings belong in family/admin/research mode.

## Headset direction (2026-10-12)

Prefer comfortable everyday **Bluetooth earbuds/headphones** in the eventual user experience. Start M04 with measured Bluetooth feasibility, prioritizing LE Audio-compatible Android phone/headset pairs where available, but do not equate LE Audio capability with proven low delay. Retain a fixed wired USB-C pair as a reference baseline, not an assumed product requirement. See [M04_BLUETOOTH_EVALUATION.md](./M04_BLUETOOTH_EVALUATION.md).

## Ear-local DSP feasibility update — M04-A (2026-10-12)

For **daily face-to-face listening**, prioritize a Bluetooth-controlled, open-fit/open-ear device with **its own built-in near-ear microphone and low-delay DSP**, rather than assuming a normal phone mic → Bluetooth stream can be transparent. Bluetooth convenience stays fundamental; separate phone-microphone remote listening can remain optional, and **neither another wearable microphone nor a sealed ear canal is mandatory**. Do not infer availability of local earbud fitting from AirPods/Galaxy first-party settings or generic LE Audio/HAP/VCP. See [M04-A decision and evidence](./M04A_EARBUD_LOCAL_DSP_FEASIBILITY_2026-10-12.md). Captions remain independent; all [safety gates](./SAFETY.md) remain blocking.

## Latest software-first scope — 2026-10-12 (supersedes the preceding POC priority)

**No custom hardware or ODM POC at this stage.** Explore to its practical limit **mic (phone or normal Bluetooth headset communication input) → mobile native DSP (per-ear EQ/WDRC, optional conservative enhancement, digital limiter) → normal Bluetooth output**. This can run without accessing earbuds' local transparency DSP; the latter remains manufacturer-controlled and should not be misrepresented as a generic App API. Also explore first-party earbud ambient/hearing settings together with independent HearLens captions. The older recommendation for ear-local firmware is parked, **not a user-approved next milestone**. See [M04 software-first capabilities and gates](./M04_SOFTWARE_FIRST_CAPTURE_FEASIBILITY_2026-10-12.md). Face-to-face natural conversation remains the target; phone placement near the talker, ear occlusion and extra microphones are not mandatory requirements. Phone→Bluetooth delay, mixed direct sound and per-ear acoustic safety remain unresolved; no live ear amplification.
