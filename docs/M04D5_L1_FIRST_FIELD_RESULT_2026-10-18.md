# M04-D5 — first L1 off-ear bench: on4_l1.wav (2026-10-18)

## Measurement and outcome

Owner submitted `on4_l1.wav` after the M04-D5 v0.2.0 debug app ran at L1, using the same boosted 24×40-ms 900–3800-Hz iPhone chirp stimulus and the improved near-source Realtek geometry previously established in `direct_close.wav` and `on3.wav`.

**Independent physical Android runtime observations, from the submitted diagnostic log:**

| Report field | Observed value |
| --- | --- |
| Connected output and actual playback route | `AIR31`, `A2DP#358` |
| Actual input capture route | `BUILTIN_MIC#15` |
| Output tier | `L1_MEASURE`, gain 16, PCM16 digital sample cap ±768, AudioTrack scalar 0.25 |
| Android media-volume indicator | `3/15` (unconverted index, **not** dB SPL) |
| Source raw mic RMS / peak | **−84.1 / −39.3 dBFS** |
| Attempted pre-OS output PCM RMS / peak | **−64.1 / −32.6 dBFS** |
| Digitally capped/limited samples | **0.023%** |
| AudioRecord source frames obtained | **1,890,240** (=39.38 sec at 48 kHz) |
| Incomplete AudioTrack write events | **3** (count, not measured audible gap) |
| `missed_reads` | **14,000** nonblocking reads returning zero data. **Not** 14,000 lost audio packets or necessarily hardware underruns |
| Stop reason | `timeout_call_or_mic_watchdog`, after **40,100 ms** |

`on4_l1.wav` SHA256 `50efff469de655d76a12d5e1a8310ccd21c57225bd7388fecfebf8f7a4020d74`. PCM 16-bit mono / 48 kHz / duration **32.99 s**, fullband RMS **−44.73 dBFS**, peak **−35.84 dBFS**, no clipping. The iPhone direct-source matched chirp is clearly identifiable **24/24 times**, at approx **4.828–27.827 s** (one-second spacing). Matched-template positive normalized coefficient median **0.715** (vs ~0.453 in `on3.wav` and ~0.725 in near-source `direct_close.wav`); this indicates excellent **external iPhone→Realtek** source alignment, *not* successful Moto microphone or AIR31 output audibility.

## Delayed AIR31 candidate search

- For each direct chirp, find its local source matched-filter peak and align events to avoid interdevice clock drift. Search for an additional 900–3800-Hz chirp in **50–950 ms after** the direct chirp, checking repeated, consistent late matched-filter peaks; phase-inverted or strongly distorted earbud audio might evade this specific detector.
- There is **no stable reproducible late chirp** distinguishable from environmental/matched-filter background across 24 events. Max stacked late *positive* normalized matched correlation is ~**0.049** for on4 L1 (vs ~**0.053** for on3 baseline and ~**0.067** for direct_close without earbud playback). The differences are exploratory noise comparisons with different recording conditions and counts, **not** a validated detection significance test.
- Realtek 900–3800-Hz RMS: on3 **−65.98 dBFS**, on4 L1 **−65.64 dBFS** (**+0.34 dB** only); both contain a strong direct source. This does not demonstrate a second acoustic AIR31 signal after increased programmatic gain.
- Result: **ANDROID_ROUTE_PASS / DIRECT_CHIRP_PASS / AIR31_ACOUSTIC_PRESENCE_INCONCLUSIVE / A2DP_MIC_LOOP_P50_P95_JITTER_NOT_MEASURED**.
- We have not independently recorded physical phone-speaker fallback, worn-ear SPL, or earbud output. The L1 digital measurements cannot infer an ear-level loudness or a real transport-latency value.

## Interpretation and next efficient development decision

L1 produces a recorded attempted PCM signal, but Moto's `raw_rms_dbfs=-84.1` is extremely small (approximately **2 PCM16 least-significant units RMS**). After the track scalar 0.25, the *average* digital output would be about **−76 dBFS** before further unknown Android media-volume (3/15) and AIR31 acoustic transfer. It is therefore **premature to raise L2 blindly**: microphone signal may be too weak or sporadically gated, Android output may be inaudible at the Realtek, or both. The Android built-in microphone route being selected does not prove the chirp reached the capture stream at usable SNR.

**Next dev task (not yet implemented): add a clearly separate, short, off-ear `AIR31 output self-test` to the native bench**. It should feed a known, repeatable, amplitude-bounded digital chirp directly to the already-verified A2DP AudioTrack, bypassing the microphone. Keep the fixed safe tier limits, system media volume and all manual/automatic stop protections. A few seconds of test tone/chirps with the same Realtek placement are sufficient to verify whether that output stage is acoustically observable **independently** of the extremely low-level Moto microphone input. A successful output self-test does not measure whole phone-mic→AIR31 latency; it only isolates the fault.

If output self-test is acoustically observable, next investigate on-device raw microphone capture/digital-zero intervals and whether the iPhone chirp arrives at the Moto mic, *before* trying L2. If it is not acoustically observable at L1 with the same phone media-volume setting, diagnose output endpoint volume/path first; **do not** repeat another 24-event mic-loop `on/moved` pair.

No new data collection or user re-recording is requested by this documentation update. Preserve `on3.wav`, `on4_l1.wav`, `direct_close.wav` as previous evidence without committing original WAV recordings. Continue the owner-approved D3 nonhuman-off-ear residual speaker-leak risk distinction; human-worn hearing-output safety remains not validated.
