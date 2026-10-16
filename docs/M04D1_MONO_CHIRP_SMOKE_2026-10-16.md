# M04-D1 — Zero-purchase mono-microphone chirp smoke kit (2026-10-16)

**Reference main before work:** `02bc25fd82ea13a170649ed3c66f176c6e4f179b` (PR #81). This delivers an **offline WAV generator and analyzer**, NOT a HearLens microphone→DSP→AIR31 player, Bluetooth timing result, output permission, calibrated SPL measurement, or approval to wear AIR31 during test.

## What was verified / reused

- `tools/analyze-m04-acoustic-wav.py` already analyzes a **simultaneous, common-ADC stereo pair** (reference phone-position and earbud-position microphones). Keep it unchanged: the available Realtek 3.5-mm microphone is one recorder, not two common-clock channels.
- M03 and SW2 DSP only produce offline/synthetic samples; M03L Port has no physical PCM output. Android SW4 v0.4.0 is strictly input-only. SW4 clock continuity passed on Moto g62 Android 13 (26 available timestamps, 25 stable consecutive). **20/26 level windows were all-zero digital PCM during ambient-only capture**: do not call them acoustic latency, do not compensate with gain; retain as a possible input-amplitude confound for future controlled tests.
- AIR31 A2DP appeared as a *predicted* media sink in SW3, not an actual routed playing output. Physical disconnect-to-speaker failure, drain of already queued PCM, left/right calibration and ear-level MPO are unverified. **M04 real hearing output remains BLOCKED** under `docs/SAFETY.md`. SW1/SW3/SW4 need not be repeated.

## New tools (do not play any sound themselves)

`tools/m04_mono_smoke.py generate` writes a deterministic 48-kHz mono PCM16 WAV: **24 chirps, 40 ms each, 900–3800 Hz, 1.0 s apart**, starting 0.5 s into the file, digitally limited to approximately **−34.9 dBFS peak** (0.018 full scale, prior to playback-device volume). These are **digital specifications only**: there is no acoustic dB SPL guarantee. Keep source at low volume, start the recording first, and stop if any unexpected noise occurs. The tool never sends audio to any physical device.

`baseline` checks one mono file (`direct.wav`), with optional extra `muted.wav`, locates the repeated direct chirps and records candidate fixed room echoes; outputs an explicit **NO BLUETOOTH LATENCY MEASURED** JSON. This part can be done before any HearLens hearing-output authorization.

`analyze` (future, **only after a separate safeguarded nonhuman output path has been designed and verified**) compares `direct.wav`, `on.wav`, `moved.wav` as **three independently recorded mono files**, optionally adding `muted.wav`. Within **each recording independently**, it matches the known chirp, establishes the direct arrival and profiles later peaks (default +10 to +400 ms). Direct chirp echoes form a control envelope (optionally augmented by a muted recording) at the **same relative lag**, not simply the second-largest correlation peak. A candidate needs sufficiently stronger on-signal, recurrence across ≥75% of events and a moved-earbud peak shifted in accordance with **measured geometry**. Missing controlled geometry, weak/overlapping arrivals, low SNR or non-isolated room echoes mean **INCONCLUSIVE**. No result is called PASS or medical-grade. A route-specific leak test and physical output safety are still separate requirements.

If a candidate passes this screening, the per-event acoustic arrival difference is reported with count, P50, P95, minimum, maximum, P95–P50 raw per-event delays, each direct-arrival and candidate-arrival time (when accepted), and unresolved-event reasons. Optional air-path correction:

```text
observed_lag = phone_capture_to_earbud_output_path
               + (speaker→phone mic + earbud→PC mic − speaker→PC mic)/343 m/s
estimated_processing_path_lag = observed_lag − above geometric component
```

**This is approximate**: the phone microphone's physical pickup point, reflectivity, chirp matching through WDRC/EQ, and output positioning add uncertainty. Measuring `on` and `moved` with different unsynchronized WAV start times is valid only because each condition uses *its own direct arrival* as a local reference.

## Step A — executable now, input-only baseline

1. On Windows, use the existing functional **Realtek 3.5-mm microphone**. Place it stably on a table. Use another phone/computer as the fixed source speaker; do not use Moto g62 or AIR31 as the playback source. Keep the source and Realtek microphone positions unchanged for every take. No headset on any person.
2. Install Python 3 with `numpy` and `scipy` (the project already pins these in `tools/requirements-camfit-oracle.txt`):

   ```powershell
   python -m pip install -r tools/requirements-camfit-oracle.txt
   python tools/m04_mono_smoke.py generate m04_chirp.wav
   ```

3. In Audacity or another WAV recorder choose **Microphone (Realtek(R) Audio)**. Record uncompressed **mono PCM16**, preferably 48 kHz, in a quiet room. Start recording ~1–2 s before playing `m04_chirp.wav` once from the separate source device. Stop after all 24 chirps. Export `direct.wav`.
4. **Do not repeat a second "muted" recording by default.** One clean, stationary reference establishes the ordinary speaker-to-Realtek room-echo profile. A distinct optional `muted.wav` is only worth recording when additional controls are needed under changed room/earbud position; it must itself contain the repeated source chirps to be valid.
5. Run:

   ```powershell
   python tools/m04_mono_smoke.py baseline --direct direct.wav --json baseline.json
   ```

   If the tool cannot find 24 stable direct arrivals, inspect whether the recording has too little input signal, clipping, a long delay before playback, a sample-rate mismatch, or missing chirps. Do not turn up a hearing output. Existing SW4 ambient digital zeros do **not** require repeating its accepted timestamp experiment.

**Upload only `baseline.json` for initial review**, or the direct WAV if alignment/noise troubleshooting is specifically needed. There is no need to record real voices.

## Step B — future nonhuman output comparison; still prohibited in current build

Proceed **only if** there is a separately verified, limited, manually stoppable Moto g62 mic → HearLens DSP → AIR31 route with correct *actual* output route monitoring, prompt fail-closed mute and a physical speaker-fallback/leakage test. Keep AIR31 off the ears throughout, and do not attempt ad-hoc browser media playback as a workaround.

Use the same fixed source and Realtek mic. Record `on.wav` with a protected output path, and `moved.wav` after moving **only the earbud** by a measured distance (preferably shifting earbud→PC mic distance by ≥0.9 m, giving ~2.6 ms expected acoustic shift). Avoid moving the source/PC microphone/phone and avoid placing earbud close to phone input (feedback). If geometry cannot be reliably controlled, the result is inconclusive; do not force a PASS.

```powershell
python tools/m04_mono_smoke.py analyze --direct direct.wav --on on.wav --moved moved.wav --events 24 --on-earbud-m 0.15 --moved-earbud-m 1.15 --speaker-phone-m 0.60 --speaker-recorder-m 0.45 --json results.json --plot analysis.png
```

The example distances are **illustrations only**: replace all four with **measured values**. `--plot` requires optional `matplotlib` and creates waveform, matched-chirp correlation profile, and delay-distribution panels; omit it if matplotlib is unavailable. The three required (plus optional muted) WAV files must be from the **same Realtek microphone and sample rate**, recorded in separate sessions. Do not combine phone and PC captures into fake stereo.

### Decision semantics

| Result | Meaning | Next action |
| --- | --- | --- |
| `DIRECT_REFERENCE_VALID_NO_BLUETOOTH_LATENCY_MEASURED` | Fixed source and mono input baseline are usable | Leave M04 output BLOCKED |
| `INCONCLUSIVE_ROOM_ECHO_OR_OUTPUT_NOT_CONFIRMED` | Cannot isolate a genuine moved-earbud component | Do not quote Bluetooth latency |
| `EXPLORATORY_SOURCE_DISCRIMINATED_NOT_OUTPUT_SAFETY_PASS` | A candidate is acoustically separable from measured fixed echoes | Review raw evidence/geometry; **still no human testing or hearing-output safety PASS** |

If exploratory P50/P95 is ~100–200 ms, the ordinary Bluetooth live-assist route is likely unattractive; 30–100 ms raises direct-sound interference concerns; ≤20 ms merits a more precise bench. These are provisional architecture triage ranges, **not safety or clinical performance thresholds**.

## Reuse / reproducibility fields

Keep `m04_chirp.wav` SHA-256, source speaker model/volume, room, measured speaker→phone/Realtek and earbud→Realtek distances for both positions, Realtek recording sample rate/channel settings, phone/Android version, AIR31 version/codec if confirmed, HearLens main SHA/build, DSP mode, limiter settings, source/output levels (uncalibrated), and any interruptions/dropouts. Record any observed input all-zero spans as missing data rather than treating absence of sound as latency. Do not commit user speech or original environmental WAVs.

**Gate:** This PR contributes tooling and deterministic unit tests only; it must never import an audio playback module or change Android input-only, M03/M04 DSP safety or public web hearing output.

## 2026-10-16 iPhone field recording follow-up

- Source: iPhone internal speaker playing the canonical chirp. Mono Realtek 48 kHz PCM16 recordings: `direct.wav`, `muted.wav`, and louder `direct2.wav` supplied by owner. Do not commit their raw WAVs without explicit owner approval.
- Independent offline inspection of `direct2.wav`: 29.43 s, no near clipping or all-zero PCM; periodic chirp-like arrivals roughly 3.66–26.66 s. Twenty-three of 24 event windows have a local matched-filter peak at least 1.3× the median of phase-shifted control windows; 60 Hz interference dominates wideband RMS. Raising playback volume did not materially raise the matched chirp response relative to `direct.wav`. This is an **exploratory direct-reference observation**, not an end-to-end latency or room-echo identity PASS.
- Original `muted.wav` did not yield a credible periodic chirp train, so it should **not** be passed as a validated secondary reflection control. Do not request re-recording merely to satisfy a CLI argument.
- The previous absolute threshold (`median matched score ×12`) rejected this kind of real weak but repeated chirp. The revised fallback requires 24-event periodic timing and off-phase noise contrast; it rejects unsupported random/hum backgrounds. This does not relax the much stricter actual earbud-candidate movement and no-speaker-fallback safety gates.
