#!/usr/bin/env python3
"""Standalone offline M03 static-gain crossover research; no audio devices/sinks.

Requires NumPy and SciPy. Uses rounded G65 values from the 2026-11-19
CAMFIT/STFT comparison, not a clinical calibration or a CAMFIT implementation.
This is NOT a dynamic WDRC, per-ear MPO, Android benchmark or human-use DSP.
"""
import argparse
import json

import numpy as np
from scipy import signal

RATE = 48000
CENTERS_HZ = np.array([250, 500, 1000, 2000, 4000, 8000], dtype=float)
BOUNDARIES_HZ = np.sqrt(CENTERS_HZ[:-1] * CENTERS_HZ[1:])
# 65-coordinate gains rounded from the offline CAMFIT model, capped at 12 dB.
FIXTURE_G65_DB = {
    "left": (0.0, 0.0, 0.0, 1.947, 7.121, 2.272),
    "right": (0.0, 0.0, 5.694, 11.947, 12.0, 4.142),
}


def idealized_smooth_response(hz, gains_db):
    """STFT-style, log-octave raised-cosine amplitude weights; NOT FFT-bin parity."""
    hz = np.asarray(hz, dtype=float)
    amps = np.power(10.0, np.asarray(gains_db) / 20.0)
    if hz.ndim != 1 or not np.all(np.isfinite(hz)) or np.any(hz < 0):
        raise ValueError("frequency grid must be finite and nonnegative")
    out = amps[np.searchsorted(BOUNDARIES_HZ, hz, side="right")].copy()
    for band, boundary in enumerate(BOUNDARIES_HZ):
        active = (hz > 0) & (hz >= boundary * 2 ** -0.18) & (hz <= boundary * 2 ** 0.18)
        octaves = np.log2(hz[active] / boundary)
        t = (octaves + 0.18) / 0.36
        weight = 0.5 - 0.5 * np.cos(np.pi * t)
        out[active] = amps[band] * (1 - weight) + amps[band + 1] * weight
    return out


def evaluate(taps, ear):
    if taps not in (257, 513, 1025):
        raise ValueError("only tested odd-tap candidates are supported")
    gains = FIXTURE_G65_DB[ear]
    design_hz = np.linspace(0, RATE / 2, 4097)
    target = idealized_smooth_response(design_hz, gains)
    symmetric_fir = signal.firwin2(taps, design_hz, target, fs=RATE)
    kernel = signal.minimum_phase(symmetric_fir, method="homomorphic", half=False, n_fft=32768)
    f, transfer = signal.freqz(kernel, worN=16384, fs=RATE)
    reference = idealized_smooth_response(f, gains)
    error_db = 20 * np.log10(np.maximum(np.abs(transfer), 1e-15) / reference)
    sweep = (f >= 250) & (f <= 8000)
    at_centers = np.array([np.argmin(np.abs(f - center)) for center in CENTERS_HZ])
    energy_fraction = np.cumsum(kernel * kernel) / np.sum(kernel * kernel)
    phase = np.unwrap(np.angle(transfer))
    group_delay_samples = -np.gradient(phase, f) * RATE / (2 * np.pi)
    return {
        "ear": ear,
        "taps": taps,
        "static_only": True,
        "kernel_finite": bool(np.all(np.isfinite(kernel))),
        "max_center_gain_error_db": float(np.max(np.abs(error_db[at_centers]))),
        "max_250_8000_gain_error_db": float(np.max(np.abs(error_db[sweep]))),
        "rms_250_8000_gain_error_db": float(np.sqrt(np.mean(error_db[sweep] ** 2))),
        "impulse_energy_95_percent_sample_index": int(np.searchsorted(energy_fraction, 0.95)),
        "static_filter_group_delay_range_samples": [
            float(np.min(group_delay_samples[sweep])),
            float(np.max(group_delay_samples[sweep])),
        ],
        "theoretical_direct_fir_multiply_accumulates_per_second_per_ear": int(RATE * taps),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selfcheck", action="store_true", help="check candidate fixture, not clinical acceptance")
    args = parser.parse_args()
    results = [evaluate(taps, ear) for taps in (257, 513, 1025) for ear in ("left", "right")]
    if args.selfcheck:
        selected = [r for r in results if r["taps"] == 513]
        assert all(r["kernel_finite"] for r in results)
        assert all(r["max_center_gain_error_db"] < 0.05 for r in selected)
        assert all(r["max_250_8000_gain_error_db"] < 1.5 for r in selected)
    output = {
        "schema": "hearlens-m03-static-minphase-fir-spike-v1",
        "source_fixture": "2026-11-19 M03 synthetic G65 rounded anchors",
        "rate_hz": RATE,
        "scope": "offline static filter only; no WDRC, no output authorization",
        "interpretation": "Causal FIR uses past samples but its phase is non-linear; impulse energy indices are NOT acoustic latency or auditory-quality acceptance",
        "results": results,
        "selfcheck": "passed" if args.selfcheck else "not-requested",
    }
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
