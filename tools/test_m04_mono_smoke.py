"""M04 mono chirp smoke regression: no device audio output or network."""
import importlib.util
import pathlib
import tempfile
import unittest
import wave

import numpy as np

SRC = pathlib.Path(__file__).with_name("m04_mono_smoke.py")
spec = importlib.util.spec_from_file_location("m04_mono_smoke", SRC)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def pcm_file(path, samples, rate=16000):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(samples, -1, .9999) * 32767).astype("<i2").tobytes())


def fixture(directory, *, add_output=True, moved_output=True, echo_as_output=False, base_lag=174, moved_lag=178):
    rate = 16000
    n = 12
    t = m.chirp(rate)
    files = {}
    for kind in ("direct", "muted", "on", "moved"):
        x = np.random.default_rng(1234).normal(0, 0.00015, int((n + 1.6) * rate))
        for i in range(n):
            start = round((.5 + i) * rate)
            x[start:start + len(t)] += .31 * t
            for lag, amount in ((52, .052), (122, .040)):
                a = start + round(lag * rate / 1000)
                x[a:a + len(t)] += amount * t
            if echo_as_output:
                a = start + round(base_lag * rate / 1000)
                x[a:a + len(t)] += .18 * t
            elif kind == "on" and add_output:
                a = start + round(base_lag * rate / 1000)
                x[a:a + len(t)] += .22 * t
            elif kind == "moved" and moved_output:
                a = start + round(moved_lag * rate / 1000)
                x[a:a + len(t)] += .22 * t
        f = pathlib.Path(directory) / (kind + ".wav")
        pcm_file(f, x, rate)
        files[kind] = f
    return files


class MonoSmokeTests(unittest.TestCase):
    def test_source_is_low_level_mono_reproducible(self):
        with tempfile.TemporaryDirectory() as temp:
            file = pathlib.Path(temp) / "source.wav"
            first = m.write_source(file, 24)
            self.assertLessEqual(first["digital_peak_dbfs"], -30)
            rate, audio = m.read_mono(file)
            self.assertEqual(rate, 48000)
            self.assertEqual(audio.ndim, 1)
            self.assertEqual(first["sha256"], m.write_source(file, 24)["sha256"])

    def test_accepts_only_control_separated_physically_moved_candidate(self):
        with tempfile.TemporaryDirectory() as temp:
            f = fixture(temp)
            # 1.372 m displacement corresponds to +4.0 ms in air.
            result, _, _, _, _ = m.report(f, events=12, on_distance=.15,
                                          moved_distance=1.522,
                                          source_phone=.6, source_recorder=.45)
            self.assertEqual(result["status"],
                             "EXPLORATORY_SOURCE_DISCRIMINATED_NOT_OUTPUT_SAFETY_PASS")
            self.assertAlmostEqual(result["summary_ms"]["p50"], 174, delta=1.5)
            self.assertGreaterEqual(result["summary_ms"]["count"], 9)
            self.assertIsNotNone(result["summary_ms"]["corrected_p50_estimate_ms"])
            self.assertIn("BLOCKED", result["hard_block"])

    def test_candidate_below_20ms_is_in_search_window(self):
        with tempfile.TemporaryDirectory() as temp:
            f = fixture(temp, base_lag=18, moved_lag=22)
            r, _, _, _, _ = m.report(f, events=12, low_ms=10,
                                      on_distance=.15, moved_distance=1.522)
            self.assertEqual(r["status"],
                             "EXPLORATORY_SOURCE_DISCRIMINATED_NOT_OUTPUT_SAFETY_PASS")
            self.assertAlmostEqual(r["summary_ms"]["p50"], 18, delta=1.5)
            self.assertEqual(len(r["event_results"]), 12)

    def test_room_echo_cannot_be_called_bluetooth(self):
        with tempfile.TemporaryDirectory() as temp:
            f = fixture(temp, add_output=False, moved_output=False, echo_as_output=True)
            result, _, _, _, _ = m.report(f, events=12, on_distance=.15, moved_distance=1.522)
            self.assertTrue(result["status"].startswith("INCONCLUSIVE"))
            self.assertIsNone(result["summary_ms"])

    def test_missing_movement_geometry_is_not_a_pass(self):
        with tempfile.TemporaryDirectory() as temp:
            f = fixture(temp)
            result, _, _, _, _ = m.report(f, events=12)
            self.assertTrue(result["status"].startswith("INCONCLUSIVE"))
            self.assertIsNone(result["summary_ms"])

    def test_silence_and_clipping_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            f = pathlib.Path(temp) / "bad.wav"
            pcm_file(f, np.zeros(16000))
            with self.assertRaisesRegex(ValueError, "digital silence"):
                m.read_mono(f)
            s = np.zeros(16000)
            s[10] = 1
            pcm_file(f, s)
            with self.assertRaisesRegex(ValueError, "near-clipping"):
                m.read_mono(f)


if __name__ == "__main__":
    unittest.main()
