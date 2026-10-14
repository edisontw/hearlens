#!/usr/bin/env python3
"""M04: analyze a REAL synchronized stereo acoustic WAV; never generates or plays audio.

Ch 1: reference microphone beside phone mic. Ch 2: microphone at earbud/coupler.
The measurement is reference-acoustic -> output-acoustic arrival, including fixture
propagation. It is NOT automatically phone mic -> eardrum latency or calibrated SPL.

Requires Python 3 and numpy; reading a file has no audio-output side effects.
Example:
  python tools/analyze-m04-acoustic-wav.py bench.wav --events 1.0:1.3,2.0:2.3 \
    --min-delay-ms 0 --max-delay-ms 400 --json report.json
Events are reference-channel stimulus windows, at least 0.05 s apart from unrelated
stimuli; each output window extends by max-delay. Record BOTH channels on ONE ADC.
"""
import argparse
import hashlib
import json
import math
import pathlib
import sys
import wave

import numpy as np


def read_wav(path):
    with wave.open(str(path), "rb") as wav:
        channels, rate, width, frames = (wav.getnchannels(), wav.getframerate(),
                                          wav.getsampwidth(), wav.getnframes())
        if channels != 2 or width not in (2, 3, 4) or frames < 1:
            raise ValueError("Require stereo uncompressed 16/24/32-bit PCM WAV")
        data = wav.readframes(frames)
    if width == 3:
        raw = np.frombuffer(data, dtype=np.uint8).reshape(-1, 3)
        signed = (raw[:, 0].astype(np.int32)
                  | (raw[:, 1].astype(np.int32) << 8)
                  | (raw[:, 2].astype(np.int32) << 16))
        signed = (signed ^ 0x800000) - 0x800000
    else:
        signed = np.frombuffer(data, dtype="<i2" if width == 2 else "<i4").astype(np.int32)
    pcm = signed.reshape(-1, 2).astype(np.float64) / float(1 << (width * 8 - 1))
    if rate < 8000 or rate > 192000:
        raise ValueError("Unsupported recording sample rate")
    return rate, pcm


def quantile_linear(values, q):
    values = sorted(values)
    pos = (len(values) - 1) * q
    lo = math.floor(pos)
    return values[lo] + (values[math.ceil(pos)] - values[lo]) * (pos - lo)


def one_event(pcm, rate, start, stop, min_lag, max_lag):
    a, b = round(start * rate), round(stop * rate)
    if a < 0 or b <= a or b + max_lag > len(pcm):
        raise ValueError("Event window or maximum lag extends beyond WAV")
    if b - a < round(0.01 * rate):
        raise ValueError("Reference event shorter than 10 ms")
    if np.max(np.abs(pcm[a:b, 0])) >= 0.995 or np.max(np.abs(pcm[a + min_lag:b + max_lag, 1])) >= 0.995:
        raise ValueError("Clipped/near-full-scale recording: no trustworthy acoustic lag")
    ref = pcm[a:b, 0].copy()
    # DC removal avoids a false peak from offset and steady microphone bias.
    ref -= np.mean(ref)
    norm_ref = np.linalg.norm(ref)
    if norm_ref < 1e-6:
        raise ValueError("Reference event is silent: cannot estimate delay")
    out = pcm[a + min_lag:b + max_lag, 1].copy()
    out -= np.mean(out)
    # Sliding normalized correlation; denominator accounts for receiver level.
    # FFT convolution yields valid dot-products for all candidate delays.
    fft_size = 1 << (len(out) + len(ref) - 2).bit_length()
    dot = np.fft.irfft(np.fft.rfft(out, fft_size) *
                        np.fft.rfft(ref[::-1], fft_size), fft_size)
    dots = dot[len(ref) - 1:len(out)]
    power = np.r_[0., np.cumsum(out * out)]
    energy = power[len(ref):] - power[:-len(ref)]
    score = np.abs(dots) / (norm_ref * np.sqrt(np.maximum(energy, 1e-24)))
    index = int(np.argmax(score))
    coefficient = float(score[index])
    lag = min_lag + index
    if not math.isfinite(coefficient) or coefficient < 0.35:
        raise ValueError("Weak correlation: check channel identity, noise and stimulus")
    # Correlation near the search boundaries cannot exclude a peak just outside.
    if index <= max(1, round(0.002 * rate)) or index >= len(score) - 1 - max(1, round(0.002 * rate)):
        raise ValueError("Correlation peak at lag-window edge; widen delay range")
    return {"reference_start_s": start, "reference_end_s": stop,
            "delay_ms": 1000 * lag / rate, "absolute_correlation": coefficient,
            "warning": ("Near-zero arrival may be direct-room sound/crosstalk, NOT Bluetooth output"
                        if 1000 * lag / rate < 10 else
                        "Output-source identity is NOT verifiable from two WAV channels alone")}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("wav", type=pathlib.Path)
    ap.add_argument("--events", required=True, help="comma-separated reference windows in seconds: 1:1.2,3:3.2")
    ap.add_argument("--min-delay-ms", type=float, default=0)
    ap.add_argument("--max-delay-ms", type=float, default=400)
    ap.add_argument("--json", type=pathlib.Path)
    args = ap.parse_args()
    rate, pcm = read_wav(args.wav)
    if not (0 <= args.min_delay_ms < args.max_delay_ms <= 2000):
        ap.error("Require 0 <= min-delay-ms < max-delay-ms <= 2000")
    if not np.isfinite(pcm).all():
        ap.error("Nonfinite recording")
    min_lag = math.ceil(rate * args.min_delay_ms / 1000)
    max_lag = math.floor(rate * args.max_delay_ms / 1000)
    if max_lag <= min_lag:
        ap.error("Lag range shorter than one sample")
    specs = []
    try:
        for part in args.events.split(","):
            start, stop = (float(v) for v in part.split(":"))
            if not (math.isfinite(start) and math.isfinite(stop) and 0 <= start < stop):
                raise ValueError("Event times must be finite, nonnegative, and increasing")
            specs.append((start, stop))
        for previous, following in zip(specs, specs[1:]):
            if following[0] < previous[1] + max_lag / rate:
                raise ValueError("Overlapping event/output search windows: choose isolated stimuli")
        events = [one_event(pcm, rate, start, stop, min_lag, max_lag)
                  for start, stop in specs]
    except (ValueError, ZeroDivisionError) as exc:
        ap.error(str(exc))
    if not events:
        ap.error("At least one event required")
    delays = [v["delay_ms"] for v in events]
    result = {
        "type": "M04_UNCALIBRATED_NONHUMAN_ACOUSTIC_ARRIVAL_DIFFERENCE",
        "status": "PROVISIONAL_LAG_CANDIDATES_ONLY_NOT_SAFETY_OR_BLUETOOTH_VALIDATION",
        "source": str(args.wav), "source_sha256": hashlib.sha256(args.wav.read_bytes()).hexdigest(),
        "sample_rate_hz": rate,
        "measurement": "reference mic acoustic arrival -> receiver mic acoustic arrival",
        "not_proven": ["phone microphone ADC latency", "ear canal SPL/MPO",
                       "speaker fallback protection", "direct sound cancellation",
                       "route identity", "safe human amplification"],
        "requires_review": ["independent direct-leakage/no-output control",
                            "physical confirmation receiver channel originates from earbud",
                            "independent physical hard mute", "fixture propagation correction",
                            "reference/receiver mic crosstalk", "speaker-leakage monitoring",
                            "separate left/right calibrated coupler measurements"],
        "events": events,
        "summary_ms": {"median": quantile_linear(delays, 0.5),
                       "p95": quantile_linear(delays, 0.95),
                       "max": max(delays),
                       "p95_minus_p50": quantile_linear(delays, 0.95) - quantile_linear(delays, 0.5)}
    }
    output = json.dumps(result, ensure_ascii=False, indent=2)
    if args.json:
        args.json.write_text(output + "\n", encoding="utf-8")
    else:
        print(output)


if __name__ == "__main__":
    try:
        main()
    except (OSError, wave.Error, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(2)
