#!/usr/bin/env python3
"""M04 mono-microphone chirp smoke kit. Offline generation/analysis only; never plays audio.

Separate recordings are NOT synchronized. All delays are computed WITHIN each
individual recording, between its direct speaker arrival and a later candidate.
A candidate is not automatically Bluetooth audio; controls and movement matter.
"""
import argparse
import hashlib
import json
import math
import pathlib
import wave

import numpy as np
from scipy.signal import fftconvolve, find_peaks

INTERVAL_S = 1.0
CHIRP_S = 0.040
START_HZ = 900
END_HZ = 3800
MAX_PCM = 0.018
AIR_SPEED_M_S = 343.0


def chirp(rate):
    n = round(rate * CHIRP_S)
    t = np.arange(n, dtype=np.float64) / rate
    phase = 2 * np.pi * (START_HZ * t + (END_HZ - START_HZ) * t * t / (2 * CHIRP_S))
    return np.sin(phase) * np.sin(np.pi * np.arange(n) / (n - 1)) ** 2


def write_source(path, events=24):
    if not 8 <= events <= 30:
        raise ValueError("Use 8–30 events")
    rate = 48000
    template = chirp(rate) * MAX_PCM
    total = int((events + 1.5) * rate)
    pcm = np.zeros(total, dtype=np.float64)
    for i in range(events):
        a = round((0.5 + i * INTERVAL_S) * rate)
        pcm[a:a + len(template)] += template
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes((np.clip(pcm, -1, 1) * 32767).astype("<i2").tobytes())
    return {"output": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "events": events, "rate_hz": rate, "interval_s": INTERVAL_S,
            "chirp_s": CHIRP_S, "band_hz": [START_HZ, END_HZ],
            "digital_peak_dbfs": round(20 * math.log10(MAX_PCM), 2),
            "warning": "No sound is played. Playback SPL is uncalibrated; this file is NOT safe output authorization."}


def read_mono(path):
    with wave.open(str(path), "rb") as wf:
        if wf.getnchannels() != 1 or wf.getsampwidth() != 2:
            raise ValueError(f"{path}: require mono PCM16 WAV; never combine independently recorded channels")
        rate = wf.getframerate()
        raw = np.frombuffer(wf.readframes(wf.getnframes()), dtype="<i2")
    if not 8000 <= rate <= 192000:
        raise ValueError(f"{path}: invalid sample rate")
    if np.any(np.abs(raw.astype(np.int32)) >= 32760):
        raise ValueError(f"{path}: near-clipping; reduce recording/playback level")
    data = raw.astype(np.float64) / 32768
    if np.sqrt(np.mean(data * data)) < 1e-6:
        raise ValueError(f"{path}: digital silence / possible all-zero input (SW4 observation)")
    return rate, data


def matched(data, rate):
    t = chirp(rate)
    # Signed delay-sensitive matched filter; absolute value tolerates phase inversion.
    dots = np.abs(fftconvolve(data, t[::-1], mode="valid"))
    return dots / np.sum(t * t)


def locate(score, rate, events):
    step = round(INTERVAL_S * rate)
    peak = float(score.max())
    if peak < 1e-5:
        raise ValueError("No recognizable chirp (digital silence or too low SNR)")
    gate = max(peak * 0.09, float(np.median(score)) * 12)
    peaks, _ = find_peaks(score, height=gate, prominence=gate * 0.4,
                          distance=max(1, round(0.006 * rate)))
    candidates = [int(p) for p in peaks if 0.05 * rate < p < 4.5 * rate]
    # Record first, then begin playing within ~3 s. Do not infer a direct path
    # from the largest late peak (which may be the earbud or room echo).
    for anchor in sorted(candidates):
        if anchor + (events - 1) * step + round(0.45 * rate) >= len(score):
            continue
        anchors = []
        good = 0
        for i in range(events):
            expected = anchor + i * step
            lo = max(0, expected - round(0.006 * rate))
            hi = min(len(score), expected + round(0.006 * rate) + 1)
            p = lo + int(np.argmax(score[lo:hi]))
            anchors.append(p)
            good += score[p] >= gate
        if good >= math.ceil(0.80 * events):
            return np.asarray(anchors, dtype=int)
    raise ValueError("No stable direct chirp train; check recording lead-in and 1 s spacing")


def take_profile(score, anchors, rate, start_ms, stop_ms):
    lags = np.arange(start_ms, stop_ms + 1, dtype=int)
    normalized = np.zeros((len(anchors), len(lags)))
    positions = np.zeros_like(normalized, dtype=float)
    radius = max(1, round(0.0012 * rate))
    for i, direct in enumerate(anchors):
        reference = max(float(score[direct]), 1e-9)
        for j, lag in enumerate(lags):
            target = int(direct + round(lag * rate / 1000))
            lo = max(0, target - radius)
            hi = min(len(score), target + radius + 1)
            if hi <= lo:
                continue
            pos = lo + int(np.argmax(score[lo:hi]))
            normalized[i, j] = score[pos] / reference
            positions[i, j] = 1000 * (pos - direct) / rate
    return lags, normalized, positions


def load_condition(path, events, low_ms, high_ms):
    rate, data = read_mono(path)
    score = matched(data, rate)
    anchors = locate(score, rate, events)
    if anchors[-1] + round(high_ms * rate / 1000) >= len(score):
        raise ValueError(f"{path}: recording too short for late-output search")
    lags, ratios, positions = take_profile(score, anchors, rate, low_ms, high_ms)
    return {"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "rate": rate, "data": data, "score": score, "anchors": anchors,
            "lags": lags, "ratios": ratios, "positions": positions}


def report(inputs, events=24, low_ms=25, high_ms=400, on_distance=None,
           moved_distance=None, source_phone=None, source_recorder=None):
    if not 8 <= events <= 30 or not 10 <= low_ms < high_ms <= 700:
        raise ValueError("Require 8–30 events and 10 <= min-lag < max-lag <= 700 ms")
    conditions = {k: load_condition(p, events, low_ms, high_ms) for k, p in inputs.items()}
    rates = {c["rate"] for c in conditions.values()}
    if len(rates) != 1:
        raise ValueError("Recordings differ in sample rate; do not silently resample")
    direct = conditions["direct"]
    muted = conditions["muted"]
    on = conditions["on"]
    moved = conditions["moved"]
    # Independent-recording clocks are NEVER subtracted; lag references are
    # found anew in every recording using that recording's direct chirps.
    background = np.maximum(np.median(direct["ratios"], axis=0),
                            np.median(muted["ratios"], axis=0))
    on_med = np.median(on["ratios"], axis=0)
    moved_med = np.median(moved["ratios"], axis=0)
    # Candidate must emerge ABOVE direct/muted room-echo controls at the
    # SAME lag. Absolute normalized amplitude avoids "2nd correlation peak" fallacy.
    margin = on_med / np.maximum(background, 0.035)
    keep = (margin >= 3.0) & (on_med >= 0.15)
    peaks, _ = find_peaks(on_med, prominence=0.08, distance=4)
    choices = sorted((int(i) for i in peaks if keep[i]), key=lambda i: on_med[i], reverse=True)
    details = []
    selected = None
    selected_index = None
    selected_mask = None
    expected_shift = None
    if on_distance is not None and moved_distance is not None:
        if min(on_distance, moved_distance) < 0:
            raise ValueError("Earbud-microphone distances must be nonnegative")
        expected_shift = (moved_distance - on_distance) / AIR_SPEED_M_S * 1000
    for idx in choices:
        lag = int(on["lags"][idx])
        event_lags = on["positions"][:, idx]
        event_amplitude = on["ratios"][:, idx]
        valid = (event_amplitude >= max(0.15, background[idx] * 3)) & (
            np.abs(event_lags - lag) <= 2.3)
        count = int(valid.sum())
        # Shift must be verified at matching moved lag, not simply a change
        # in volume. Small position changes cannot prove source identity.
        if expected_shift is None:
            move_ok = False
            moved_lag = None
        else:
            moved_lag = lag + expected_shift
            new_idx = int(round(moved_lag - low_ms))
            move_ok = (abs(expected_shift) >= 2.5 and 0 <= new_idx < len(moved_med)
                       and moved_med[new_idx] >= max(0.15, 3 * background[new_idx])
                       and moved_med[new_idx] >= moved_med[idx] * 1.20)
        details.append({"candidate_ms": lag, "events_above_control": count,
                        "control_ratio": round(float(margin[idx]), 3),
                        "movement_expected_ms": expected_shift,
                        "movement_supported": bool(move_ok)})
        if count >= math.ceil(events * 0.75) and move_ok and selected is None:
            delays = event_lags[valid].astype(float)
            selected = delays
            selected_index = idx
            selected_mask = valid
            break
    status = ("EXPLORATORY_SOURCE_DISCRIMINATED_NOT_OUTPUT_SAFETY_PASS"
              if selected is not None else "INCONCLUSIVE_ROOM_ECHO_OR_OUTPUT_NOT_CONFIRMED")
    result = {
        "schema": "hearlens-m04-mono-smoke-v1",
        "status": status,
        "scope": "Nonhuman, uncalibrated mono-mic acoustic screening; no M04 live output authorization",
        "conditions": {name: {"wav": c["path"], "sha256": c["sha256"],
                               "detected_direct_events": len(c["anchors"])}
                       for name, c in conditions.items()},
        "events_expected": events, "sample_rate_hz": int(next(iter(rates))),
        "lag_search_ms": [low_ms, high_ms],
        "clock_rule": "Every lag is within its own mono WAV; never compare absolute times across recordings",
        "controls": "direct and muted fixed-echo profiles; on and physically moved-earbud comparisons",
        "candidate_checks": details[:12],
        "geometry": {"earbud_to_mic_m": on_distance, "moved_earbud_to_mic_m": moved_distance,
                     "speaker_to_phone_m": source_phone, "speaker_to_recorder_m": source_recorder,
                     "speed_of_sound_m_s": AIR_SPEED_M_S},
        "summary_ms": None,
        "not_proven": ["Bluetooth route identity or codec", "hardware no-speaker fallback",
                       "ear-level dB SPL/MPO", "daily open-fit comfort", "medical suitability"],
        "hard_block": "HearLens M04 live hearing output remains BLOCKED"
    }
    if selected is not None:
        result["event_results"] = [
            {"event": i + 1,
             "direct_arrival_s": round(float(direct_sample) / on["rate"], 5),
             "candidate_arrival_s": (round(float(direct_sample) / on["rate"] +
                                           float(on["positions"][i, selected_index]) / 1000, 5)
                                     if selected_mask[i] else None),
             "delay_ms": (round(float(on["positions"][i, selected_index]), 3)
                          if selected_mask[i] else None),
             "accepted": bool(selected_mask[i]),
             "reason": ("MATCHED_MOVED_EARBUD_CONTROL" if selected_mask[i]
                        else "WEAK_OR_INCONSISTENT_CANDIDATE")}
            for i, direct_sample in enumerate(on["anchors"])
        ]
        geometry_adjust = None
        if None not in (on_distance, source_phone, source_recorder):
            geometry_adjust = 1000 * (on_distance + source_phone - source_recorder) / AIR_SPEED_M_S
        result["summary_ms"] = {
            "count": int(len(selected)), "unresolved_count": int(events - len(selected)), "p50": round(float(np.percentile(selected, 50)), 3),
            "p95": round(float(np.percentile(selected, 95)), 3),
            "min": round(float(selected.min()), 3), "max": round(float(selected.max()), 3),
            "jitter_p95_minus_p50": round(float(np.percentile(selected, 95) - np.percentile(selected, 50)), 3),
            "air_path_correction_ms": geometry_adjust,
            "corrected_p50_estimate_ms": (round(float(np.median(selected) - geometry_adjust), 3)
                                          if geometry_adjust is not None else None),
            "individual_lags_ms": [round(float(x), 3) for x in selected]
        }
    if selected is None:
        result["event_results"] = [
            {"event": i + 1, "direct_arrival_s": round(float(sample) / on["rate"], 5),
             "candidate_arrival_s": None, "delay_ms": None, "accepted": False,
             "reason": "CANNOT_EXCLUDE_FIXED_ECHO_OR_MOVEMENT_NOT_VERIFIED"}
            for i, sample in enumerate(on["anchors"])
        ]
    return result, conditions, background, on_med, moved_med


def plots(path, conditions, background, on_med, moved_med, summary):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(3, 1, figsize=(11, 11))
    on = conditions["on"]
    sr = on["rate"]
    first = on["anchors"][0]
    a = max(0, first - round(.05 * sr))
    b = min(len(on["data"]), first + round(.48 * sr))
    axes[0].plot((np.arange(a, b) - first) / sr * 1000, on["data"][a:b])
    axes[0].set(title="ON recording: mono waveform (first event)", xlabel="Time from direct peak (ms)", ylabel="PCM")
    lags = on["lags"]
    axes[1].plot(lags, background, label="max(direct, muted) room-echo control")
    axes[1].plot(lags, on_med, label="earbud on")
    axes[1].plot(lags, moved_med, label="earbud moved")
    axes[1].set(title="Matched-chirp correlation relative to direct peak", xlabel="Relative lag (ms)", ylabel="Normalized matched amplitude")
    axes[1].legend()
    dist = summary.get("individual_lags_ms", []) if summary else []
    if dist:
        axes[2].hist(dist, bins=min(12, max(4, len(dist) // 2)))
    else:
        axes[2].text(.5, .5, "INCONCLUSIVE: no verified candidate", ha="center", transform=axes[2].transAxes)
    axes[2].set(title="Accepted per-event candidate delays (exploratory only)", xlabel="Relative lag (ms)", ylabel="Count")
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("generate", help="Create a quiet digital mono chirp WAV; does not play it")
    g.add_argument("output", type=pathlib.Path)
    g.add_argument("--events", type=int, default=24)
    b = sub.add_parser("baseline", help="Safe controls-only check: no hearing output needed")
    b.add_argument("--direct", type=pathlib.Path, required=True)
    b.add_argument("--muted", type=pathlib.Path, required=True)
    b.add_argument("--events", type=int, default=24)
    b.add_argument("--min-lag-ms", type=int, default=10)
    b.add_argument("--max-lag-ms", type=int, default=400)
    b.add_argument("--json", type=pathlib.Path, required=True)
    a = sub.add_parser("analyze", help="Compare FOUR separate mono PCM16 recordings")
    for name in ("direct", "muted", "on", "moved"):
        a.add_argument("--" + name, type=pathlib.Path, required=True)
    a.add_argument("--events", type=int, default=24)
    a.add_argument("--min-lag-ms", type=int, default=10)
    a.add_argument("--max-lag-ms", type=int, default=400)
    a.add_argument("--on-earbud-m", type=float)
    a.add_argument("--moved-earbud-m", type=float)
    a.add_argument("--speaker-phone-m", type=float)
    a.add_argument("--speaker-recorder-m", type=float)
    a.add_argument("--json", type=pathlib.Path, required=True)
    a.add_argument("--plot", type=pathlib.Path, help="PNG graph; optional matplotlib dependency")
    args = p.parse_args()
    try:
        if args.cmd == "generate":
            args.output.parent.mkdir(parents=True, exist_ok=True)
            result = write_source(args.output, args.events)
        elif args.cmd == "baseline":
            if not 8 <= args.events <= 30 or not 10 <= args.min_lag_ms < args.max_lag_ms <= 700:
                raise ValueError("Require 8–30 events and 10 <= min-lag < max-lag <= 700 ms")
            direct = load_condition(args.direct, args.events, args.min_lag_ms, args.max_lag_ms)
            muted = load_condition(args.muted, args.events, args.min_lag_ms, args.max_lag_ms)
            if direct["rate"] != muted["rate"]:
                raise ValueError("Recordings have different sample rates")
            background = np.maximum(np.median(direct["ratios"], axis=0),
                                    np.median(muted["ratios"], axis=0))
            echo_peaks, _ = find_peaks(background, prominence=0.08, distance=4)
            echoes = sorted(echo_peaks, key=lambda i: background[i], reverse=True)
            result = {
                "schema": "hearlens-m04-mono-baseline-v1",
                "status": "CONTROL_RECORDING_VALID_NO_BLUETOOTH_LATENCY_MEASURED",
                "direct_wav_sha256": direct["sha256"], "muted_wav_sha256": muted["sha256"],
                "events_detected": {"direct": len(direct["anchors"]), "muted": len(muted["anchors"])},
                "sample_rate_hz": direct["rate"],
                "room_echo_lags_ms": [int(direct["lags"][i]) for i in echoes[:12]],
                "not_proven": ["AIR31 actual output", "Bluetooth end-to-end delay",
                               "hardware mute", "ear SPL safety"],
                "hard_block": "HearLens M04 live hearing output remains BLOCKED"
            }
            args.json.parent.mkdir(parents=True, exist_ok=True)
            args.json.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        else:
            inputs = {k: getattr(args, k) for k in ("direct", "muted", "on", "moved")}
            result, conditions, baseline, on_med, moved_med = report(
                inputs, args.events, args.min_lag_ms, args.max_lag_ms,
                args.on_earbud_m, args.moved_earbud_m,
                args.speaker_phone_m, args.speaker_recorder_m)
            args.json.parent.mkdir(parents=True, exist_ok=True)
            args.json.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            if args.plot:
                args.plot.parent.mkdir(parents=True, exist_ok=True)
                plots(args.plot, conditions, baseline, on_med, moved_med, result["summary_ms"])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    except (OSError, ValueError, ImportError, wave.Error) as exc:
        p.error(str(exc))


if __name__ == "__main__":
    main()
