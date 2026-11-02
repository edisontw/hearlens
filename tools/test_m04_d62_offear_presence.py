"""Read-only M04-D6.2 six-chirp output-presence regression; synthetic PCM only."""
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
import wave

import numpy as np

PROGRAM = pathlib.Path(__file__).with_name("m04_d62_offear_presence.py")
spec = importlib.util.spec_from_file_location("m04_d62_offear_presence", PROGRAM)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def write_wav(path, signal):
    pcm = (np.clip(signal, -0.999, 0.999) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(m.RATE)
        w.writeframes(pcm.tobytes())


def fixture(first=1.0, period=0.8, events=6, with_chirps=True):
    rng = np.random.default_rng(2601102)
    n = 8 * m.RATE
    t = np.arange(n) / m.RATE
    # Strong 60-Hz mains hum, plus broadband recording noise.
    audio = 0.005 * np.sin(2 * np.pi * 60 * t)
    audio += rng.normal(0, 0.00015, n)
    if with_chirps:
        template = m.output_template()
        for i in range(events):
            start = round((first + i * period) * m.RATE)
            audio[start:start + len(template)] += 0.004 * template
    return audio


class OffearPresenceTests(unittest.TestCase):
    def test_template_is_bounded_and_matches_six_chirp_geometry(self):
        template = m.output_template()
        self.assertEqual(len(template), 7680)
        self.assertLessEqual(np.max(np.abs(template)), 1.0)
        self.assertGreater(np.max(np.abs(template)), 0.95)

    def test_six_chirps_detected_against_hum_and_independent_silence(self):
        with tempfile.TemporaryDirectory() as td:
            on = pathlib.Path(td) / "on.wav"
            control = pathlib.Path(td) / "silence.wav"
            write_wav(on, fixture())
            write_wav(control, fixture(with_chirps=False))
            result = m.report(on, control)
            self.assertEqual(result["status"], "PATTERN_SEPARATED_FROM_CONTROL_SOURCE_NOT_PROVEN")
            self.assertEqual(result["pattern"]["events_supported"], 6)
            self.assertAlmostEqual(result["pattern"]["events"][0]["onset_s"], 1.0, delta=.02)
            self.assertFalse(result["control"]["six_event_pattern"])
            self.assertIn("BLOCKED", result["hard_block"])
            self.assertIn("source", result["status"].lower())

    def test_silence_tone_single_chirp_and_wrong_period_never_pass(self):
        hum = fixture(with_chirps=False)
        self.assertIsNone(m.detect(hum))
        self.assertIsNone(m.detect(fixture(events=1)))
        self.assertIsNone(m.detect(fixture(period=1.0)))
        t = np.arange(len(hum)) / m.RATE
        self.assertIsNone(m.detect(hum + .004 * np.sin(2 * np.pi * 1200 * t)))

    def test_matching_control_does_not_establish_air31_source(self):
        with tempfile.TemporaryDirectory() as td:
            on = pathlib.Path(td) / "on.wav"
            control = pathlib.Path(td) / "control.wav"
            write_wav(on, fixture())
            write_wav(control, fixture(first=1.2))
            self.assertEqual(m.report(on, control)["status"], "INCONCLUSIVE_PATTERN_ALSO_IN_CONTROL")
            self.assertEqual(m.report(on)["status"], "CANDIDATE_NEEDS_INDEPENDENT_SILENCE_CONTROL")

    def test_invalid_wav_rejected_and_cli_reports_no_latency(self):
        with tempfile.TemporaryDirectory() as td:
            td = pathlib.Path(td)
            on = td / "on.wav"
            report = td / "report.json"
            write_wav(on, fixture())
            cmd = [sys.executable, str(PROGRAM), str(on), "--json", str(report)]
            completed = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            obj = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(obj["status"], "CANDIDATE_NEEDS_INDEPENDENT_SILENCE_CONTROL")
            self.assertNotIn("latency_ms", obj)
            self.assertEqual(len(obj["sha256"]), 64)
            self.assertIsNone(obj["control"])
            with wave.open(str(on), "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(44100)
                w.writeframes(np.zeros(44100, dtype="<i2").tobytes())
            failed = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            self.assertNotEqual(failed.returncode, 0)
            self.assertIn("48-kHz mono PCM16", failed.stderr)


if __name__ == "__main__":
    unittest.main()
