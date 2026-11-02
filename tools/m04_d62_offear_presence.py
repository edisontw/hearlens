#!/usr/bin/env python3
"""Read-only M04-D6.2 output-only six-chirp presence screen (not latency or SPL).

Use a 48-kHz mono PCM16 Realtek recording of the off-ear OUTPUT_SELF_TEST.
The template follows BenchSelfTestSignal (six 160-ms 900->3800 Hz sweeps
spaced 800 ms) and the L1 PCM limiter. Recording start is not synchronized
with Android; candidate onset timestamps are LOCAL to this WAV.

An independent silent-AIR31 control is optional. Without it, even a strong
six-event pattern is only a candidate. With it, pattern separation is still
NOT proof of AIR31 acoustic identity (phone-speaker leakage is possible).
No microphone capture, playback, network or hearing-output authorization.
"""
import argparse
import hashlib
import json
import math
import pathlib
import sys
import wave

import numpy as np
from scipy.signal import butter, fftconvolve, find_peaks, sosfiltfilt

RATE = 48_000
EVENTS = 6
PERIOD = 0.8
DURATION = 0.160


def read_mono_pcm16(path):
    with wave.open(str(path), "rb") as w:
        if w.getnchannels() != 1 or w.getsampwidth() != 2 or w.getframerate() != RATE:
            raise ValueError("Require 48-kHz mono PCM16 WAV (no resampling)")
        samples = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64) / 32768
    if len(samples) < int(4.6 * RATE):
        raise ValueError("Recording too short for six 800-ms-spaced chirps")
    if np.max(np.abs(samples)) >= 0.995:
        raise ValueError("Near-clipping recording; cannot assess pattern reliably")
    return samples


def output_template():
    """Deterministic Java sampleAt() waveform after L1 gain/cap (no OS volume)."""
    n = np.arange(round(DURATION * RATE), dtype=np.float64)
    t = n / RATE
    phase = 2 * np.pi * (900 * t + 0.5 * (3800 - 900) * t * t / DURATION)
    window = 0.5 * (1 - np.cos(2 * np.pi * n / (len(n) - 1)))
    raw = np.floor(64 * window * np.sin(phase) + 0.5)  # Java Math.round
    return np.clip(raw * 16, -768, 768) / 768.0


def correlation_score(audio):
    # 60-Hz mains interference dominated older Realtek captures. Filtering
    # removes it without claiming acoustic calibration or changing raw WAVs.
    sos = butter(4, [700, 4300], btype="bandpass", fs=RATE, output="sos")
    x = sosfiltfilt(sos, audio)
    template = sosfiltfilt(sos, output_template())
    norm = float(np.linalg.norm(template))
    dot = fftconvolve(x, template[::-1], mode="valid")
    energy = np.r_[0.0, np.cumsum(x * x)]
    power = np.maximum(energy[len(template):] - energy[:-len(template)], 1e-24)
    return np.clip(np.abs(dot) / (norm * np.sqrt(power)), 0.0, 1.0)


def detect(audio):
    score = correlation_score(audio)
    # A 0.8-s event period and 160-ms sweeps distinguish D6.1/D6.2 from
    # the older 1-s/40-ms external iPhone stimulus.
    peaks, _ = find_peaks(score, height=0.32, prominence=0.15,
                          distance=round(0.55 * RATE))
    radius = round(0.012 * RATE)
    step = round(PERIOD * RATE)
    best = None
    for anchor in peaks:
        if anchor + (EVENTS - 1) * step + radius >= len(score):
            continue
        events = []
        for i in range(EVENTS):
            expected = anchor + i * step
            lo, hi = max(0, expected - radius), min(len(score), expected + radius + 1)
            pos = lo + int(np.argmax(score[lo:hi]))
            controls = []
            for offset in (0.29, 0.46):
                center = expected + round(offset * RATE)
                a, b = center - radius, center + radius + 1
                if b > len(score):
                    controls.append(1.0)
                else:
                    controls.append(float(np.max(score[a:b])))
            contrast = float(score[pos]) / max(0.05, *controls)
            events.append({"onset_s": round(pos / RATE, 5),
                           "correlation": round(float(score[pos]), 4),
                           "offphase_ratio": round(contrast, 3),
                           "supported": bool(score[pos] >= 0.35 and contrast >= 2.5)})
        count = sum(e["supported"] for e in events)
        median_corr = float(np.median([e["correlation"] for e in events]))
        if count < 5 or median_corr < 0.45:
            continue
        candidate = {"events_supported": count, "median_correlation": round(median_corr, 4),
                     "events": events}
        if best is None or (count, median_corr) > (best["events_supported"], best["median_correlation"]):
            best = candidate
    return best


def report(recording, control=None):
    audio = read_mono_pcm16(recording)
    pattern = detect(audio)
    control_pattern = detect(read_mono_pcm16(control)) if control else None
    if pattern is None:
        status = "NO_RELIABLE_SIX_EVENT_PATTERN"
    elif control is None:
        status = "CANDIDATE_NEEDS_INDEPENDENT_SILENCE_CONTROL"
    elif control_pattern is not None:
        status = "INCONCLUSIVE_PATTERN_ALSO_IN_CONTROL"
    else:
        status = "PATTERN_SEPARATED_FROM_CONTROL_SOURCE_NOT_PROVEN"
    return {
        "schema": "hearlens-m04-d62-offear-presence-v1",
        "status": status,
        "recording": str(recording),
        "sha256": hashlib.sha256(recording.read_bytes()).hexdigest(),
        "control": ({"path": str(control), "sha256": hashlib.sha256(control.read_bytes()).hexdigest(),
                     "six_event_pattern": control_pattern is not None} if control else None),
        "pattern": pattern,
        "scope": "Exploratory six-chirp acoustic-pattern screen; not validated source identification",
        "template": {"source": "BenchSelfTestSignal D6.1/D6.2 OUTPUT_SELF_TEST L1",
                     "chirps": EVENTS, "duration_ms": 160, "spacing_ms": 800,
                     "frequency_hz": [900, 3800]},
        "not_proven": ["AIR31-specific acoustic source or absence of phone-speaker fallback",
                       "phone microphone to earbud acoustic latency or jitter",
                       "ear-level SPL/MPO", "physical route safety", "worn hearing suitability"],
        "hard_block": "Worn live hearing amplification remains BLOCKED"
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("recording", type=pathlib.Path)
    parser.add_argument("--control", type=pathlib.Path,
                        help="Independent same-geometry no-output/silence WAV; never subtract WAV timestamps")
    parser.add_argument("--json", type=pathlib.Path, help="Write metadata report, never raw audio")
    args = parser.parse_args()
    try:
        result = report(args.recording, args.control)
        data = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
        if args.json:
            args.json.write_text(data, encoding="utf-8")
        else:
            print(data, end="")
    except (ValueError, OSError, wave.Error) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
