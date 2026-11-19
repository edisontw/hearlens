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



# Exact synthetic CAMFIT model anchors from the repository JS implementation;
# nominal 50/65/80 are NOT calibrated microphone/ear-level dB SPL.
CAMFIT_EXAMPLE_ANCHORS = {
    "left": np.array([[0,0,0],[0,0,0],[0,0,0],[1.9472054262667307]*3,
                      [7.11714853661015]*3,[9.783693510917363,2.274072925802951,0]]),
    "right": np.array([[0,0,0],[0,0,0],[5.694005637713971]*3,[11.94720542626673]*3,
                       [14.077006222739447,13.004447589867018,11.93188895699459],
                       [13.704568901060156,4.142316736998374,0]]),
}


def designed_kernel(taps, gains):
    hz = np.linspace(0, RATE / 2, 4097)
    linear = signal.firwin2(taps, hz, idealized_smooth_response(hz, gains), fs=RATE)
    return signal.minimum_phase(linear, method="homomorphic", half=False, n_fft=32768)


def static_gain_error(taps, gains):
    hz, transfer = signal.freqz(designed_kernel(taps, gains), worN=16384, fs=RATE)
    delta = 20 * np.log10(np.maximum(np.abs(transfer), 1e-12) / idealized_smooth_response(hz, gains))
    band = (hz >= 250) & (hz <= 8000)
    return float(np.max(np.abs(delta[band])))


def model_gains(ear, independent_levels):
    independent_levels = np.asarray(independent_levels, dtype=float)
    if independent_levels.shape != (6,) or not np.all(np.isfinite(independent_levels)) or np.any(independent_levels < 50) or np.any(independent_levels > 80):
        raise ValueError("six separate finite nominal input coordinates (50..80) required")
    return np.minimum(12, [np.interp(level, (50, 65, 80), CAMFIT_EXAMPLE_ANCHORS[ear][i])
                           for i, level in enumerate(independent_levels)])


def dynamic_design_screen():
    """Bounded synthetic design screen, NOT a working per-band level detector/WDRC."""
    rng = np.random.default_rng(1192026)
    scenarios = [np.full(6, v) for v in (50, 65, 80)]
    scenarios += [np.array([50,65,80,50,65,80]),np.array([80,50,65,80,50,65])]
    scenarios += [rng.uniform(50, 80, 6) for _ in range(40)]
    examples = {}
    for ear in ("left", "right"):
        errors = [static_gain_error(513, model_gains(ear, levels)) for levels in scenarios]
        examples[ear] = {"scenarios":len(errors),"max_error_db":max(errors)}

    # Intentional NON-CAMFIT shapes; tests generalization beyond 2 audiograms.
    rng = np.random.default_rng(1192026)
    arbitrary = rng.uniform(0, 12, (100, 6))
    general = {}
    for taps in (257, 513, 1025):
        errors = np.array([static_gain_error(taps, gains) for gains in arbitrary])
        general[str(taps)] = {
            "profiles":100,"worst_error_db":float(np.max(errors)),
            "p95_error_db":float(np.percentile(errors,95)),
            "stereo_steady_macs_per_second":int(2*RATE*taps),
            "stereo_two_fir_crossfade_macs_per_second":int(4*RATE*taps),
        }

    # Two parallel FIR outputs on the SAME past samples and a 50-ms coefficient
    # crossfade are algebraically equivalent, NOT evidence of no audible artifact.
    t = np.arange(RATE) / RATE
    pcm = 0.007*np.sin(2*np.pi*1000*t)+0.004*np.sin(2*np.pi*7000*t)
    progress = np.clip((np.arange(RATE)-16000)/2400,0,1)
    fraction = .5-.5*np.cos(np.pi*progress)
    transitions = {}
    for ear in ("left", "right"):
        before = designed_kernel(513, model_gains(ear,np.full(6,50)))
        after = designed_kernel(513, model_gains(ear,np.full(6,80)))
        y = (1-fraction)*signal.lfilter(before,[1],pcm)+fraction*signal.lfilter(after,[1],pcm)
        residuals = []
        for i in (16000,16120,17200,18300,19000):
            history = pcm[max(0,i-512):i+1][::-1]
            history = np.pad(history,(0,513-len(history)))
            coefficient = (1-fraction[i])*before+fraction[i]*after
            residuals.append(abs(y[i]-np.dot(coefficient,history)))
        transitions[ear] = {"fade_ms":50,"max_algebraic_residual":max(residuals),
                            "not_a_listening_or_audio_quality_test":True}
    return {"camfit_model_level_scenarios":examples,"independent_gain_shape_stress":general,
            "same_history_FIR_coefficient_crossfade":transitions,
            "not_measured":["real per-band level detection","compression accuracy", "coefficient-update artifacts", "Android callback CPU", "acoustic gain / MPO"]}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selfcheck", action="store_true", help="check candidate fixture, not clinical acceptance")
    parser.add_argument("--dynamic-design-screen", action="store_true", help="offline stress and FIR coefficient-crossfade identity only")
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
    if args.dynamic_design_screen:
        output["dynamic_design_screen"] = dynamic_design_screen()
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
