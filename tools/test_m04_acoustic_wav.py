"""Focused safety regression for the read-only M04 WAV parser and lag estimator."""
import json
import pathlib
import runpy
import subprocess
import sys
import tempfile
import unittest
import wave

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROGRAM = ROOT / "tools/analyze-m04-acoustic-wav.py"
module = runpy.run_path(str(PROGRAM))


def write_stereo_pcm16(path, data, rate=8000):
    signal = (np.clip(data, -0.999, 0.999) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as out:
        out.setnchannels(2)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(signal.tobytes())


class M04AcousticReaderTests(unittest.TestCase):
    def fixture(self):
        rate = 8000
        samples = np.zeros((rate * 3, 2), dtype=np.float64)
        segment = np.random.default_rng(4604).uniform(-0.3, 0.3, 480)
        for start in (int(0.4 * rate), int(1.4 * rate)):
            samples[start:start + len(segment), 0] = segment
            samples[start + 1200:start + 1200 + len(segment), 1] = segment * 0.7
        return rate, samples

    def test_recovers_known_candidate_without_playback(self):
        rate, pcm = self.fixture()
        result = module["one_event"](pcm, rate, 0.4, 0.46, 0, 3200)
        self.assertAlmostEqual(result["delay_ms"], 150, places=3)
        self.assertGreater(result["absolute_correlation"], 0.98)
        self.assertIn("NOT verifiable", result["warning"])

    def test_rejects_silence_clipping_and_lag_boundary(self):
        rate, pcm = self.fixture()
        with self.assertRaisesRegex(ValueError, "silent"):
            module["one_event"](np.zeros_like(pcm), rate, 0.4, 0.46, 0, 3200)
        clipped = pcm.copy()
        clipped[int(0.4 * rate), 0] = 1.0
        with self.assertRaisesRegex(ValueError, "Clipped"):
            module["one_event"](clipped, rate, 0.4, 0.46, 0, 3200)
        at_zero = pcm.copy()
        at_zero[:, 1] = at_zero[:, 0]
        with self.assertRaisesRegex(ValueError, "lag-window edge"):
            module["one_event"](at_zero, rate, 0.4, 0.46, 0, 3200)

    def test_reads_signed_24_bit_stereo(self):
        values = [-8388608, 8388607, -1, 0, 123456, -123456]
        raw = b"".join((v & 0xFFFFFF).to_bytes(3, "little") for v in values)
        with tempfile.TemporaryDirectory() as td:
            file = pathlib.Path(td) / "signed24.wav"
            with wave.open(str(file), "wb") as out:
                out.setnchannels(2)
                out.setsampwidth(3)
                out.setframerate(48000)
                out.writeframes(raw)
            rate, pcm = module["read_wav"](file)
            self.assertEqual(rate, 48000)
            np.testing.assert_allclose(
                pcm.reshape(-1), np.array(values) / float(1 << 23),
                rtol=0, atol=0
            )

    def test_cli_writes_explicitly_provisional_report(self):
        rate, pcm = self.fixture()
        with tempfile.TemporaryDirectory() as td:
            wav = pathlib.Path(td) / "bench.wav"
            report = pathlib.Path(td) / "report.json"
            write_stereo_pcm16(wav, pcm, rate)
            base = [sys.executable, str(PROGRAM), str(wav),
                    "--min-delay-ms", "0", "--max-delay-ms", "400",
                    "--json", str(report)]
            good = subprocess.run(
                base + ["--events", "0.4:0.46,1.4:1.46"], capture_output=True,
                text=True, timeout=30,
            )
            self.assertEqual(good.returncode, 0, good.stderr)
            obj = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(len(obj["events"]), 2)
            self.assertAlmostEqual(obj["summary_ms"]["p95"], 150, delta=0.2)
            self.assertIn("PROVISIONAL", obj["status"])
            self.assertEqual(len(obj["source_sha256"]), 64)
            self.assertIn("direct-leakage", str(obj["requires_review"]))
            overlapping = subprocess.run(
                base + ["--events", "0.4:0.46,0.5:0.56"],
                capture_output=True, text=True, timeout=30,
            )
            self.assertNotEqual(overlapping.returncode, 0)
            self.assertIn("Overlapping", overlapping.stderr)


if __name__ == "__main__":
    unittest.main()
