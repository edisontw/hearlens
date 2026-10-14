# M04-A — Earbud-local DSP and platform API feasibility (2026-10-12)

> **2026-10-14 current evidence update:** [M04-B0 desk downselect and software-first exit gate](./M04B0_SOFTWARE_FIRST_EXIT_AND_LOCAL_DSP_DOWSELECT_2026-10-14.md) verifies Nordic firmware/mono-platform constraints, public Qualcomm access uncertainty and Tympan Rev F official store **sold out** status. **No hardware procurement, live audio or firmware POC authorized.** The user-approved phone builtin mic→ordinary Bluetooth output remains the active software-first direction, contingent on physical acoustic and route tests.


> **2026-10-12 later user priority supersession:** Hardware POCs, ODM/SDK acquisition and custom ear-side prototype implementation are **deferred**. The active software-first plan is [M04_SOFTWARE_FIRST_CAPTURE_FEASIBILITY_2026-10-12.md](./M04_SOFTWARE_FIRST_CAPTURE_FEASIBILITY_2026-10-12.md), which evaluates phone DSP + Bluetooth audio and phone/earbud microphone capture. The technical findings below remain reference material, NOT an instruction to start hardware work.


**Decision type:** architecture evidence gate, desk research only. **Baseline `main`:** `bd488e4f498690a2cf214119b5eaf5a87a0c080d`. **No live hearing audio, microphone-to-ear runtime, device control, firmware changes or human testing were introduced in M04-A.**

This document is subordinate to [SAFETY.md](./SAFETY.md). Read with [WORK_HANDOFF_ARCHITECTURE_2026-10-12.md](./WORK_HANDOFF_ARCHITECTURE_2026-10-12.md) and [M04_BLUETOOTH_EVALUATION.md](./M04_BLUETOOTH_EVALUATION.md). The full Deep Research reports provided in the 2026-10-12 HearLens project context were inspected for framing and hypotheses; primary public specifications below are independently linked. Literature-derived latency estimates are **not measurements on a HearLens device**.

## Executive decision

**GO for architecture and vendor discovery:** phone-configured, **ear-side microphone → local low-delay DSP → open-fit/open-ear transducer**, with BLE/GATT or documented vendor companion protocol for configuration; retain Bluetooth for convenience, media/telephony and optional remote audio. No additional body-worn / remote microphone and no mandatory ear-canal seal.

**CONDITIONAL for implementation:** chipset/ODM access and documented firmware APIs must demonstrate *actual* microphone input, independent L/R frequency-dependent gain/WDRC, final calibrated acoustic output limiting, measurement access, and versioned authorization. A programmable DSP SoC alone does **not** prove all of these features.

**NO-GO as an architectural dependency:** arbitrary off-the-shelf AirPods/Galaxy Buds/Sony/Bose local transparency WDRC control through an ordinary third-party Android/iOS application. Public platform API documentation reviewed does not expose generic controls; manufacturer-controlled settings do not imply third-party privileges. Do not reverse-engineer private protocols as a safety-critical product strategy.

**CONDITIONAL, bench only:** native phone mic → native PCM DSP → Bluetooth headset. Useful to measure routing and physical latency, or for optional remote microphone scenarios; do not presume it can deliver transparent, face-to-face open-fit sound. Retain wired USB-C only as a laboratory latency reference, not as a user requirement.

**GO independently:** M01 captions, recent transcript and caption-only fail-safe.

## Evidence confidence key

- **VERIFIED/PUBLIC:** explicit capability or limit in vendor, platform or Bluetooth SIG documentation linked below.
- **VERIFIED/REPO:** state of our synthetic-only implementation from GitHub handoffs; not evidence of real hardware behavior.
- **INFERENCE:** architectural implication of source facts; must not be called measured performance.
- **UNKNOWN:** cannot be established without a particular firmware/version, licensed SDK or external measurement.

## Platform / profile / API capability matrix

| Platform, interface | Availability / privilege | What the public interface demonstrates | Ear-local transparency, per-ear multiband WDRC, calibrated MPO? | M04-A result |
|---|---|---|---|---|
| Android `BluetoothA2dp` / `BluetoothLeAudio` / `BluetoothHearingAid` | Public profile APIs; `BLUETOOTH_CONNECT` for relevant operations on modern Android; LE Audio support needs both actual endpoints | Connected devices, group/connection or audio profile state, not generic in-ear DSP fitting | **No documented generic setting API** | **NO-GO** for transparent local DSP; route/identity diagnostics **GO** |
| Android `AudioRecord`, `AudioTrack`, AAudio/Oboe | Public native audio APIs; real input/output routes must be observed, not merely requested | Phone-captured / phone-rendered PCM may be processed in app | App-side stereo DSP **yes**; headset-local ambient DSP **no**; acoustic MPO **no** | **CONDITIONAL** bench/remote mode only |
| Android BLE `BluetoothGatt` | Public BLE GATT client; e.g. `BLUETOOTH_CONNECT`; device must expose supported writable characteristic | Read/write documented characteristics of *that device* | **Only with manufacturer-owned, exposed characteristic + documented semantics**; cannot conjure unknown commands | **GO** for custom/partner configuration plane |
| Bluetooth LE Audio BAP + LC3 | Standards and coordinated audio transport; OS/firmware support hardware dependent | LC3 7.5/10 ms frames, timed streaming | **No** universal ambient mic → local DSP gain control | **GO** for streaming, **NO-GO** as local-DSP evidence or latency guarantee |
| Bluetooth HAP/HAS (hearing aid presets) | Standardized hearing-aid identity and optional preset controls; product/OS client support dependent | Client may select a hearing-aid-defined preset | **No** arbitrary EQ/WDRC prescription write or absolute acoustic limit API | **CONDITIONAL** preset selection UX, not clinical fitting |
| Bluetooth VCP/VCS, VOCS, AICS | Bluetooth services only when supported/exposed; OS GATT/permission constraints apply | Volume; VOCS per-output offset (can include left/right); AICS input control | **No** per-band WDRC or calibrated output MPO; left/right volume offset is not prescription fitting | **NO-GO** for local audiogram fitting |
| iOS `AVAudioSession`, `AVAudioEngine` | Public App PCM/routing/session APIs | Process the app's own media; choose session type; read route/latency estimates | **No** public AirPods local ambient WDRC API; iOS A2DP/HFP route policy may change input | **CONDITIONAL** native bench; no local DSP control |
| iOS `CoreBluetooth` / `ExternalAccessory` | Public BLE GATT for accessory-exposed services; MFi external accessory protocol requires supported accessory/protocol | Authorized companion-app device communication | Only via **documented manufacturer accessory protocol** | **GO** for self/partner device config, not any consumer earbud |
| Apple Accessibility hearing-device support API | Manufacturer-related `hearing.aid.app` entitlement / matching paired hearing devices | Check hearing-aid streaming preferences, ear status, paired identifiers, bidirectional capability | **No** advertised third-party arbitrary per-band fitting through this API | **NO-GO** for generic WDRC; conditional manufacturer companion integration |
| Apple `AudioAccessoryKit` | Manufacturer companion app; **customer app use currently geographically restricted to EU devices + EU Apple Account** in official documentation | Accessory state, on-head/placement and automatic switching (and supported capabilities) | **No** documented ear-local WDRC/transparency fitting control | **NO-GO** as HearLens fitting API; geographic restriction matters for Taiwan |
| Manufacturer app with own proprietary firmware | Specific models, first-party app, sometimes authorized license/NDA | Model-specific ambient settings may exist | **UNKNOWN** to HearLens until licensed SDK and exact permissions documented | **CONDITIONAL** procurement only |

**Important distinction:** App PCM L/R gain adjusts **what the phone streams**. It does not reprogram the headset's own external microphones/ANC/transparency pipeline. Hearing presets and volume controls are not equivalent to NAL/DSL-style per-ear multiband input/output targets. An `HAP_CLIENT` profile identifier alone is not evidence of an ordinary app-controlled local fitting API.

**iOS route caution:** Apple's `AVAudioSession.CategoryOptions.allowBluetoothA2DP` is A2DP output-oriented; choosing Bluetooth HFP may switch *both* input and output to the headset. Platform latency properties and codec frame size do **not** establish acoustic input→output E2E time.

### Key primary platform/standards sources

1. Android `BluetoothLeAudio`: https://developer.android.com/reference/android/bluetooth/BluetoothLeAudio
2. Android `BluetoothHearingAid`: https://developer.android.com/reference/android/bluetooth/BluetoothHearingAid
3. Android `BluetoothGatt.writeCharacteristic`: https://developer.android.com/reference/android/bluetooth/BluetoothGatt
4. Android audio routing (`getPreferredDevice` is not guaranteed actual route; `getRoutedDevices` from API 36): https://developer.android.com/reference/android/media/AudioTrack
5. Apple hearing-device support & manufacturer matching entitlement: https://developer.apple.com/documentation/accessibility/hearing-device-support
6. Apple AudioAccessoryKit, restrictions and features: https://developer.apple.com/documentation/audioaccessorykit
7. Apple A2DP/HFP routing: https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/allowbluetootha2dp and https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/allowbluetooth
8. Bluetooth Hearing Access Service (HAS presets): https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/13249-HAS-html5/out/en/index-en.html
9. Bluetooth Hearing Access Profile: https://www.bluetooth.com/specifications/specs/hearing-access-profile-1-0-1/
10. Bluetooth Volume Control Profile / offset: https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/76878-VCP-html5/out/en/index-en.html and https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/78569-VOCS-html5/out/en/index-en.html
11. Bluetooth LC3 frame durations: https://www.bluetooth.com/specifications/specs/low-complexity-communication-codec-1-0-1/

## Concrete consumer earbud models and SDK/ODM candidates

| Candidate | VERIFIED / published | Not demonstrated for HearLens | Decision |
|---|---|---|---|
| **AirPods Pro 2 / Pro 3** | Apple's first-party Hearing Aid mode supports user audiogram import/test and amplification/balance/tone/Conversation Boost in supported regions; Apple says settings live on AirPods | No public ordinary third-party API for arbitrary local WDRC or bypassing Apple's fitting/safety control. User features are region-dependent. | **NO-GO** as programmable HearLens hardware; useful first-party product benchmark only |
| **Samsung Galaxy Buds3 Pro** | Samsung's first-party Galaxy Wearable App exposes ambient/ANC and **separate L/R ambient volume** sliders, voice boost / ambient noise controls | No confirmed published third-party programmable per-band local compressor/EQ or safety-calibrated MPO | **NO-GO** as general third-party dependency; first-party benchmark |
| **Sony/Bose consumer earbuds** | First-party consumer ambient/ANC modes may exist, model-specific | No verified general SDK allowing HearLens to install local transparency filterbank/WDRC | **NO-GO until written vendor proof** |
| **Qualcomm QCC5181 chipset / compatible ODM reference** | Chip described as programmable DSP for TWS and LE Audio; Qualcomm lists ADK, GAIA OEM client and audio calibration software | SDK access/license, mic bus topology, actual WDRC framework, dual-ear parameter storage, limiter control, acoustic latency and specific available ODM SKU **all unknown** | **CONDITIONAL procurement lead** — not a verified ready-to-buy HearLens earbud |
| **Tympan Rev F + Tympan_Library** | Open-source hearing-aid research development platform; code and hardware available, programmable audio experiments | Not a discreet consumer TWS/open-ear finished device; custom open-ear receiver, physical latency and acoustic output gates still required | **GO as transparent algorithm/route *bench* candidate**, not product |
| **Nordic nRF5340 Audio DK** | Publicly documented LE Audio dev board with programmable embedded application and Cirrus CS47L63 audio DSP, I/O connectors | DSP firmware/programming scope for *specific* CS47L63 local ANC/transparency chain, independently calibrated bilateral open-ear fit, <5 ms latency all **unknown** | **CONDITIONAL** SDK transport/hardware bench; not proof of real-time hearing path |
| **OpenEarable 2.0** | Open-source research earable firmware/hardware/sensing ecosystem | Raw ambient speech microphone → ultra-low-delay WDRC → open-ear output has not been established as a supported turnkey feature | **DISCOVERY only**, lower priority than hearing-focused Tympan / ODM |

Consumer first-party references:
- Apple hearing aid & region/model caveats: https://support.apple.com/en-la/120992
- Samsung hearing enhancements + ambient volume L/R: https://www.samsung.com/us/support/answer/ANS10003394/

SDK / hardware references:
- Qualcomm QCC5181 SoC: https://www.qualcomm.com/audio/products/qualcomm-s5-series/qcc5181
- Qualcomm ADK/GAIA/QACT access listing: https://www.qualcomm.com/audio/products/qualcomm-s5-series/qcc5181/software
- Qualcomm audio partner program (tools/ADK access): https://www.qualcomm.com/support/partner/audio
- Tympan Rev F: https://shop.tympan.org/ ; code: https://github.com/Tympan/Tympan_Library
- Nordic nRF5340 Audio DK: https://www.nordicsemi.com/Products/Development-hardware/nRF5340-Audio-DK/Download
- OpenEarable 2.0 source: https://github.com/OpenEarable/open-earable-2

**Procurement gate (minimum written answers):** exact part/firmware; licensing and binary/source SDK availability; internal mic-to-speaker local data path; true bandwise/levelwise L/R WDRC parameters; per-ear calibration and maximum-output/limiter ownership; acoustic E2E measurements and conditions; transparent/open-ear feedback handling; OTA/rollback and persistent profile validity; supported Android/iOS GATT/control transport; battery and physical fit. Lack of any mandatory answer means **NO-GO for hearing output**, even if audio streaming demos work.

## Architecture comparison and explicit disposition

| Architecture | Face-to-face natural/open ear | Time control / direct+delayed risk | Per-ear fitting & safe MPO ownership | Verdict |
|---|---|---|---|---|
| **A. Earbud mic → earbud local DSP → open-ear receiver; phone BLE settings and captions** | Best architectural fit without external microphone or sealing | Short local path *possible*, but needs actual acoustic E2E, feedback and direct-mix tests | Only with OEM/open firmware and physical calibration | **GO to POC planning; CONDITIONAL for live output** |
| **B. Qualcomm/ODM existing TWS with authorized local DSP SDK** | Attractive form factor if ear-local transparency is programmable | Vendor firmware must expose/control timing and signal chain | Contractual and verifiable SDK must own true fitting and limiter | **CONDITIONAL** |
| **C. Phone mic → native DSP → consumer LE Audio earbuds** | Everyday BLE convenient, but phone placement/SNR and direct-path echo can interfere | LC3 7.5/10 ms is **only a codec frame**, not E2E; OS/sink buffers unknown | App PCM L/R yes, local DSP no; calibrated MPO requires fixed device/volume and physical tests | **CONDITIONAL: nonhuman measurement / optional remote mic**, **NO-GO as presently demonstrated for daily open-fit hearing** |
| **D. Phone mic → classic A2DP earbuds** | Same spatial problems, often worse buffering | Cannot assume adequate low delay; evidence from physical device measurements absent | Same safety blockers | **NO-GO primary hearing loop**, metadata/compatibility only |
| **E. Phone mic → USB-C wired control receiver** | Not preferred everyday consumer solution | Useful to separate OS/DSP delay from wireless path, still direct-mix risks | Test rig calibrated separately | **GO as lab reference only** |
| **F. Caption-only** | Visual independent aid | Does not create direct/processed acoustic overlap | No ear-output limiter needed | **GO existing M01** |

No benchmark millisecond values from LC3, Nordic community posts, studies of other hearing aids or app audio timestamps are promoted to **HearLens measured** values. The 2026-10-12 Deep Research recommends **≤5 ms for open-ear local paths (ideally lower)** and treats **≤20 ms as a remote-mic boundary**, but those are *research-informed internal design gates*, not universally accepted psychoacoustic limits, protocol guarantees or evidence that a specific configuration passes. The preferred measurable metric is synchronously observed **acoustic input onset to acoustic receiver output** with median, P95, tails and changes after 1+ hour.

### Why open-ear makes latency more important

With direct sound `x(t)` and amplified copy `g x(t-τ)`, `y(t) = x(t) + g x(t-τ)`; matched-level tonal comb spacing is `1/τ`. This simplified linear model is **not** a prediction of what a given listener hears: real ear seal/leakage, group delay, gain by band, hearing loss and head transfer functions matter. Prioritize low-frequency direct acoustic audibility when feasible and focus local supplementation on needed speech bands, but do not call high-frequency-only phone Bluetooth playback an automatic echo cure.

### Current repo DSP interaction

M03H–L synthetic STFT uses `1024` samples and `256` hop (lookahead `768` samples: **16 ms at 48 kHz**). That is an offline algorithmic latency, not measured microphone→ear latency, and already consumes significant open-ear timing budget *before* wireless/OS buffers. **Do not make M03M a further generic offline-STFT optimization project while ear-local hardware/API capability remains unproven.** Preserve current golden tests, safety modeling and caption features. If an OEM local path emerges, port/configure only necessary proven processing; an embedded low-delay minimum-phase/IIR or multirate filterbank is a candidate, not yet validated.

## Selected POC directions (M04-B prerequisites)

### POC 1 — Ear-side local processing discovery on open research hardware (priority 1)

- **Vehicle:** obtain specifications/availability for Tympan Rev F as a *bench* research platform; in parallel request written QCC5181 ODM/ADK permissions. Prefer the smallest documented platform with controllable raw microphone and safe local output; do not require wearer sealed ear tip.
- **Scope first:** paper/API firmware capability checklist and **synthetic or nonhuman bench** chain for one side; inspect actual mic/ADC → local filter/compressor → DAC topology; ensure a control GATT or documented interface can set bounded L/R parameters when a stereo/bilateral fixture exists.
- **Measurement gate:** independent channels; common-clock external acoustic reference; direct+processed open-fit spectrum/own-voice artifact model; measured frequency response, hard mute, calibration and max output before any human use.
- **Pass only if:** actual local DSP control is demonstrated, documented, firmware stable and acoustically calibrated; otherwise stop or revise target hardware. Stereo product readiness is **not** implied by a mono dev board.

### POC 2 — Android route-only Bluetooth latency/routing characterization (priority 2)

- **Vehicle:** one fixed Android phone/OS, explicitly identified LE Audio earbud/firmware if actually available, one A2DP comparator and one USB-C **control**.
- **Scope first:** native probe **without creating live mic→ear playback**; log declared audio routes/codec where supported, capture source, `getRoutedDevice` / `getRoutedDevices` by API level, interruptions, call/focus, disconnect and one-ear events. Acquire a **nonhuman physical** acoustic bench with independent low-level bounded stimulus before any physical output testing. Do not assume that `setPreferredDevice` prevents reroute to phone speaker.
- **If approved for instrumented nonhuman playback:** acoustic click/chirp reference mic and receiver/coupler mic on one clock, P50/P95/max/jitter repeated, direct+processed mixing simulations; measure volume/fit mode, ANC/ambient state and phone-mic preservation; test **physical speaker leakage**, not only Android event callbacks.
- **Stop:** live listening/real-ear amplification remains forbidden until measured per-ear acoustic MPO, final non-bypassable limiter, hard mute with proof of no speaker fallback, conservative start/reconnect ramp and interruption tests all pass.

## Validation evidence ledger (not yet performed)

| Claim | Evidence state as of 2026-10-12 | Required next evidence |
|---|---|---|
| Third-party app configures arbitrary AirPods/Galaxy local band WDRC | **NOT SUPPORTED by reviewed public APIs** | Explicit vendor SDK/matching entitlement + confirmed model/firmware |
| AirPods/Samsung first-party app has user sound adjustment | **VERIFIED published manufacturer UX** | Does not transfer programming privilege to HearLens |
| Ear-side local programmable DSP chips/research hardware exist | **VERIFIED hardware/SDK catalog entries** | Writable signal topology, licensed docs, firmware prototype |
| Generic HAP/VCP provides audiogram target control | **FALSE as generalized claim** | Device proprietary profile or firmware control needed |
| ≤5 ms is achieved with HearLens open-ear configuration | **UNKNOWN** | Physically measured acoustic E2E on actual receiver/fit |
| Phone → LC3 Bluetooth E2E is ≤20 ms | **UNKNOWN** | Physical latency by actual negotiated device pair, no extrapolation from 7.5 ms frame |
| Current M03L ensures hardware silence/MPO | **NO — synthetic no-PCM route mock only** | Native enforced halt/mute + measured speaker leak and ear SPL |
| Independent captions work while output path blocked | **VERIFIED/REPO M01 functional design** | Preserve existing regression; no STT retesting needed for M04-A |

## Action order / next decision gates

1. **M04-A complete = documentation/research review only.** Get SDK/docs and written answers from one chipset/ODM lead; compare with Tympan Rev F and Nordic as fallback research vehicles. No purchase or live patient amplification implied.
2. **M04-B1 bench preparation:** precise supported-device/firmware table, acquisition quote/availability, external two-channel acoustic measurement, calibration fixture, predeclared limits, and native hard-mute/route-fail-stop test plan.
3. **M04-B2 bench-only implementation, conditional on B1:** hardware local path proof and/or route/latency-only native probe. No arbitrary TWS microphone extraction or private protocol commands.
4. **M03M deferred / scope changed:** only when M04-B confirms a viable controlled signal path; then evaluate porting/modifying offline DSP to on-device firmware or a separately measured phone remote-mic research path. Avoid more synthetic STFT work until this gate.
5. **M01 unchanged:** captions and transcript recall remain user-visible capability, independent of route/device readiness.

## Core safety/non-goals preserved

- No actual hearing amplifier in the browser or native phone, no acoustic output from the M03L mock, no real-ear testing and no medical/audiogram fitting claims.
- Fail closed when route or calibration identity unknown; no amplified microphone auto-fallback to phone speaker; one-ear disconnect must block hearing path pending separate per-ear assurance.
- Manufacturer acoustic gain/exposure limits must be understood and independently validated; a digital dBFS limiter alone cannot certify real-ear SPL.
- User preference: Bluetooth, everyday nearby conversation, no extra microphone and no mandatory sealed canal. Device-integrated mics are acceptable, but must actually be available to local firmware.
