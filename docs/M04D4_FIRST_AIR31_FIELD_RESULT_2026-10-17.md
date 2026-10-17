# M04-D4 first real Moto g62 → AIR31 bench (2026-10-17): route observed, acoustic latency inconclusive

## Test materials, distinct evidence levels

The owner used **Moto g62 (Android 13)**, actual connected **AIR31 A2DP**, iPhone as fixed external chirp speaker, and Windows Realtek wired mono microphone. Submitted the debug-app text log for two sessions, plus `on.wav` (near earbud), `moved.wav` (earbud moved) and the earlier `direct2.wav` reference. Exact geometric distances for this pair were not yet supplied; do not assume the suggested diagram distances were measured.

**No raw microphone recordings are committed to GitHub** (privacy/storage); reproducibility relies on filenames, SHA-256 and summarized signal diagnostics.

### Android native log — actual route verification

| Metric | on session | moved session |
| --- | --- | --- |
| Session start/stop elapsed | 40,152 ms | 40,107 ms |
| Observed playback sink | `A2DP#285`, product AIR31 | `A2DP#285`, product AIR31 |
| Observed input | `BUILTIN_MIC#15` | `BUILTIN_MIC#15` |
| Digital gain, PCM16 cap, track scalar | `8x / ±384 / 0.15` | same |
| Source frames processed | 1,872,960 | 1,879,680 |
| Partial/noncompleted AudioTrack writes | 3 | 1 |
| Stop | `timeout_call_or_mic_watchdog` at ~40 s | same |

Both sessions reached actual observed playing-track A2DP route and a built-in phone microphone, rather than merely SW3's predicted route. The earlier unconfirmed checkboxes/permission attempts occurred before the successful run, not during it. There is **no evidence of a route-loss incident** in either run; physical BLE/A2DP disconnect speaker-fallback response remains untested. A `dropped_writes` count does not itself establish audible gap duration. Real hardware latency is not inferable from these software timestamps or frames.

### Recording QA and chirp matching

| WAV | SHA-256 | PCM format | Duration | Fullband RMS | Matched chirp train events (exploratory) |
| --- | --- | --- | ---: | ---: | ---: |
| `direct2.wav` | `fe50189ca76f8f4f039efd459b6e4ef87008ef75ff9c2c1614deeb9e6cff3c51` | 48 kHz mono PCM16 | 29.43 s | −45.23 dBFS | 22/24 |
| `on.wav` | `8021c5c0f1972377f81852f2be3c13dbf915e0310b4100965c100ebea04bd0aa` | same | 30.14 s | −43.60 dBFS | 0/24 |
| `moved.wav` | `523f925803ea39587eddb80c5705e418dcb7040373ba460b6ff7371bac82b9e0` | same | 34.52 s | −43.24 dBFS | 3/24; does not form a reliable sequence |

No clipping (`abs(pcm) >= 32760`) observed in any of these three files. All have a substantial constant low-frequency component near 60 Hz. Bandpass 900–3800 Hz and 40 ms energy folded at a 1-s period yields maximum contrast against the same recording's background of approximately **13.4%** in `direct2`, **2.6%** in `on` and **4.1%** in `moved`. A matched filter using the repository's 40 ms 900→3800 Hz Hann² chirp, the expected 24-event timing, and a heuristic per-event local/off-phase ratio greater than 1.3 yields the counts above; this heuristic is for **triage** rather than a standardized hypothesis-test threshold or SPL measurement.

**Acoustic decision: INCONCLUSIVE_NO_RELIABLE_DIRECT_CHIRP_REFERENCE_IN_ON_AND_MOVED.** The independently recorded `on` and `moved` lack a reliable direct iPhone chirp sequence. Thus their later candidate peaks cannot be confidently attributed to a moving AIR31 source or separated from room reflections. **No Bluetooth latency P50/P95/jitter was measured. Do not use the apparent first peaks or subtract timestamps across WAV sessions.**

Potential explanations include a missed/incorrect iPhone source playback within recording, changed source→Realtek microphone geometry/orientation, inadequate source level compared with recording noise, incorrect Windows input/level, or insufficient AIR31 output; **the available WAVs do not distinguish them**. The existing digital cap and volume are deliberately very low and may make AIR31 acoustically inconspicuous, but absence of the direct iPhone chirp prohibits attributing the whole failure to earbud volume. Do not raise hearing-path gain blindly.

## Next owner action: only ONE controlled check before repeating either AIR31 position

1. Leave iPhone, Moto g62 and Realtek PC microphone **stationary** in the new setup. Confirm Audacity is capturing **Microphone (Realtek(R) Audio)** (48 kHz, mono PCM16) and its input indicator responds near the PC mic. Verify iPhone speaker is the active source output and the original **25.5-s, 24-chirp WAV** is actually played while Audacity records.
2. With the AIR31 **not playing**, record **one** same-geometry `direct_current.wav` if the prior `direct2.wav` was made before changing positions or volume. Keep this exact geometry thereafter. This is **not** a new `muted.wav` requirement.
3. If the 24 direct chirps are clearly recovered, do **one** new near-earbud `on2.wav` with existing M04-D4 debug APK, AIR31 on table/off ears, same fixed positions, low Android media volume and 40 s window. Do **not** repeat moved until on2 yields identifiable moving-earbud candidate. If silent/no candidate, inspect app log and acoustic levels before any gain increase.
4. Upload the single check and, if attempted, on2 plus app diagnostic. Record actual speaker→Moto, speaker→Realtek, earbud-near→Realtek and earbud-moved→Realtek distances when a credible source chirp exists. Do not require SW1–SW4 repeats.

**Roadmap:** Android actual A2DP and builtin microphone route on the phone = first field PASS. Acoustic chirp capture in `on/moved` = NOT VERIFIED. Bluetooth mic→ear acoustic latency, receiver loudness/feedback and worn-assistance safety = NOT VERIFIED. Owner-approved nonhuman low-output testing policy from M04-D3 is unchanged.

## Follow-up correction and on2 capture (2026-10-17)

**Owner clarification:** The first `on.wav` was deliberately recorded **without playing the iPhone Chirp file**, because the previous instructions were ambiguous. Therefore absence of periodic chirps in that recording is **expected**, not proof of Realtek failure or a Bluetooth transport fault. Do not ask to repeat SW1/SW3 or investigate a false negative caused by an absent stimulus. The `moved.wav` source-playback state was not separately confirmed.

The next manual attempt (logged as `on2.wav`) again produced a working **physical Android runtime output route**:
- Actual track `AIR31 A2DP#311`, actual capture `BUILTIN_MIC#15`; start `913761090`, route confirmation `913761609`; stop `913801197` after **40,107 ms** from user start; 1,887,360 source frames; 3 partial nonblocking writes; `stop=timeout_call_or_mic_watchdog`.
- `on2.wav`: SHA-256 `a86382f8b6e74848a69215a2fdc01c86ccb9ab0e0fc7388f55cf8defd2ccfbea`, **32.73 s**, 48-kHz mono PCM16, RMS **−44.84 dBFS**, no PCM clipping. Dominant stationary ≈60 Hz background remains.
- The 40-ms 900–3800 Hz chirp detector **did not recover a credible one-second-spaced 24-event source**. The best 24-event 40-ms-window **in-band energy / +0.40 s displaced background power** ratio is about **1.09** in on2, compared with **1.32** in previously accepted direct2. This is a heuristic signal-presence screen, **not** statistical proof that iPhone playback did/did not occur.
- Thus `on2` also cannot establish a physical AIR31 arrival, P50/P95, or jitter. A missing direct-source acoustic landmark prevents distinguishing weak earbud PCM output from room/environmental noise.

**Likely confound discovered:** The canonical generated external iPhone chirp WAV has a digital peak of just **−34.9 dBFS** (about 0.018 full scale), *before* the iPhone's physical volume setting and speaker response. It may be too weak at the current distance over the recorded ~60 Hz background. This is **not** evidence to increase real-time earbud gain or override app protections.

For a minimal next check, retain fixed phones/PC microphone positions and make a derived **same 24×40 ms 48-kHz PCM16 chirp** rescaled to **−20.0 dBFS peak** (≈14.9 dB digital boost, with identical chirp onset intervals and frequency sweep; no clipping). The user-facing artifact was prepared in the conversation under filename `HearLens_M04_Chirp_24x40ms_48k_Boosted_-20dBFS.wav`, SHA-256 `9c735564a15ea689fe3caccd97ffd80ed37f65358ef4d542f2a2a1ed8cd14d16`; this binary is **not** checked into GitHub. Begin with iPhone output volume low, verify physical speaker is selected, and keep AIR31 off ears. First record **only** an iPhone-to-Realtek `direct_boosted.wav` baseline, with the Android app NOT playing; check the 24-event train before any more Bluetooth-position tests. Once that direct acoustic reference is convincingly measurable, then (and only then) repeat one near-earbud session using the **same** boosted source; repeat moved-earbud only if that is interpretable. The original `direct2.wav` source gain differs from boosted, so it cannot be treated as a same-source-level room-echo control without caveats. No `muted.wav` required.

Do not interpret passing CI, low-level Android loop execution or a boosted source WAV as proof of safe **worn** hearing amplification.

## Booster reference follow-up — direct_boosted.wav (2026-10-17)

The user submitted `direct_boosted.wav` after playing the revised 24 × 40 ms 900–3800 Hz WAV with its peak raised from −34.9 to −20 dBFS. The **original WAV stimulus** and **actual Realtek capture** must be distinguished; boosted digital source level does not guarantee a louder recorded acoustic signal.

- Submitted recording SHA-256: `1fc3079692aa3913f5b679174e2c986e560d5b0b433f8d2350e6ffd2695bd79a`.
- Format: **48 kHz, mono, PCM16**, duration **28.61 s**, fullband RMS **−44.30 dBFS**, peak **0.02847 full scale**, no PCM16 clipping.
- Dominant recording interference: **60 Hz**, with 900–3800 Hz band RMS **−66.55 dBFS** (vs ~−66.79 dBFS on the prior `direct2.wav`, a change of only ~0.24 dB).
- Chirp time-frequency sweep+1 Hz-period check: weak best **24-event event-minus-offphase mean contrast ~0.038**, compared with **~0.122 for prior direct2**, using the same exploratory normalized time-frequency method. Only ~4/24 boosted candidate positions cleared a strict ~0.10 normalized contrast, versus ~16/24 for earlier direct2. This is an exploratory *signal-presence screen*, not an acoustics-standard detection method or ground-truth count.
- **Disposition: INCONCLUSIVE / NO RELIABLE DIRECT-SOURCE CHIRP TRAIN.** Raising digital source amplitude by ~15 dB did not yield the expected recognizable direct-source chirp signature in the submitted Realtek recording. Do **not** claim Air31 latency, acoustic delay/jitter or no sound output based on this check.

**Troubleshooting priority has shifted to the physical capture chain (without repeating an entire 24-chirp BT suite):**
1. In Windows Audacity select the real **Microphone (Realtek(R) Audio)** input (not loopback, Stereo Mix, another microphone or a silently routed source). Verify a brief nonrecorded tap/voice at the mic causes a *visible live recording-meter response*; if not, inspect jack, Windows input choice/permissions and Audacity gain.
2. Confirm the iPhone audio playback destination is its **built-in speaker**, not Bluetooth/AirPlay/earpiece; try an ordinary short, recognizable audio source at comfortable volume and check that Audacity's live input meter responds. Do not increase AIR31 app PCM gain to fix an absent direct iPhone landmark.
3. Once the input meter can distinguish actual iPhone sound from the stationary 60 Hz interference, play the *same boosted chirps* and inspect a few seconds of the live waveform (or submit one **short** confirmation WAV). Only after a clear repeating stimulus is demonstrated should the user repeat **one** near-earbud `on` clip and later `moved`. No `muted`, SW1–SW4 or extra iPhone volume trial required yet.

The Android Moto g62 `AudioTrack.getRoutedDevice() == AIR31 A2DP` / BUILTIN_MIC field result remains independently PASS. It is **not** invalidated by external PC audio-capture SNR failure.
