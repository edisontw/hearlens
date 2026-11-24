"""Loopback API contract tests with synthetic PCM and a fake ASR model."""

from importlib.util import module_from_spec, spec_from_file_location
from io import BytesIO
from pathlib import Path
import json
import threading
import unittest
import wave
from urllib.error import HTTPError
from urllib.request import Request, urlopen


SERVER_PATH = Path(__file__).with_name("local_taigi_server.py")
SPEC = spec_from_file_location("local_taigi_server", SERVER_PATH)
SERVER = module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)


def make_wav(rate=16_000, channels=1, seconds=1):
    output = BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(channels)
        target.setsampwidth(2)
        target.setframerate(rate)
        target.writeframes(b"\0\0" * rate * seconds * channels)
    return output.getvalue()


class FakeSegment:
    text = " 合成台語字幕。"


class FakeModel:
    def __init__(self):
        self.calls = 0

    def transcribe(self, audio, **options):
        self.calls += 1
        self.options = options
        return iter([FakeSegment()]), object()


class LocalTaigiServerTests(unittest.TestCase):
    def setUp(self):
        self.model = FakeModel()
        self.server = SERVER.LoopbackServer(("127.0.0.1", 0), SERVER.LocalTaigiHandler)
        self.server.model = self.model
        self.server.model_lock = threading.Lock()
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        host, port = self.server.server_address
        self.base_url = f"http://{host}:{port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, path, *, method="GET", body=None, headers=None):
        request = Request(self.base_url + path, data=body, headers=headers or {}, method=method)
        with urlopen(request, timeout=3) as response:
            return response.status, response.headers, response.read()

    def test_health_reports_cpu_int8_and_model_id(self):
        status, _headers, body = self.request("/v1/health")
        data = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(data["model"], "MediaTek-Research/Breeze-ASR-26")
        self.assertEqual(data["device"], "cpu")
        self.assertEqual(data["compute_type"], "int8")

    def test_preflight_allows_only_development_origin_and_private_network(self):
        status, headers, _body = self.request(
            "/v1/transcribe",
            method="OPTIONS",
            headers={
                "Origin": "http://localhost:8080",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Private-Network": "true",
            },
        )
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "http://localhost:8080")
        self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")

    def test_transcription_accepts_pcm_and_keeps_audio_out_of_logs_and_response(self):
        wav = make_wav()
        status, _headers, body = self.request(
            "/v1/transcribe",
            method="POST",
            body=wav,
            headers={
                "Content-Type": "audio/wav",
                "Content-Length": str(len(wav)),
                "Origin": "http://localhost:8080",
            },
        )
        result = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(result["text"], "合成台語字幕。")
        self.assertEqual(self.model.calls, 1)
        self.assertEqual(self.model.options["language"], "zh")
        self.assertEqual(self.model.options["task"], "transcribe")
        self.assertNotIn("audio", result)

    def test_rejects_cloud_origins_and_non_wav_payloads(self):
        with self.assertRaises(HTTPError) as origin_error:
            self.request(
                "/v1/transcribe",
                method="POST",
                body=make_wav(),
                headers={
                    "Content-Type": "audio/wav",
                    "Content-Length": str(len(make_wav())),
                    "Origin": "https://untrusted.example",
                },
            )
        self.assertEqual(origin_error.exception.code, 403)
        self.assertEqual(self.model.calls, 0)

        with self.assertRaises(HTTPError) as content_error:
            self.request(
                "/v1/transcribe", method="POST", body=b"not audio",
                headers={"Content-Type": "audio/webm", "Content-Length": "9"},
            )
        self.assertEqual(content_error.exception.code, 415)

    def test_rejects_wrong_sample_rate_and_long_clips(self):
        for wav in (make_wav(rate=8_000), make_wav(seconds=17)):
            with self.assertRaises(HTTPError) as error:
                self.request(
                    "/v1/transcribe", method="POST", body=wav,
                    headers={"Content-Type": "audio/wav", "Content-Length": str(len(wav))},
                )
            self.assertEqual(error.exception.code, 422)
        self.assertEqual(self.model.calls, 0)


if __name__ == "__main__":
    unittest.main()
