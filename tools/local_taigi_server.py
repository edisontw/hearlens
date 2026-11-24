"""Loopback-only, in-memory ASR bridge for the HearLens local Taigi mode."""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
import os
from pathlib import Path
import sys
import threading
import wave


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL_PATH = REPO_ROOT / ".models" / "breeze-asr-26-ct2-int8"
MODEL_PATH = Path(os.environ.get("HEARLENS_TAIGI_MODEL", DEFAULT_MODEL_PATH)).resolve()
ALLOWED_ORIGINS = {
    item.strip().rstrip("/")
    for item in os.environ.get(
        "HEARLENS_ALLOWED_ORIGINS",
        "http://localhost:8080;http://127.0.0.1:8080",
    ).split(";")
    if item.strip()
}
CPU_THREADS = int(os.environ.get("HEARLENS_ASR_CPU_THREADS", "6"))
MAX_WAV_BYTES = 600_000
MAX_SECONDS = 16
MODEL_ID = "MediaTek-Research/Breeze-ASR-26"
MODEL_REVISION = "7b992682e7f5ceedd0a41ebec240f01ba469d19e"


class AudioFormatError(ValueError):
    pass


def decode_pcm16_wav(payload: bytes):
    """Validate a mono 16-kHz PCM WAV and return an in-memory float32 array."""
    import numpy as np

    try:
        with wave.open(BytesIO(payload), "rb") as source:
            if (source.getnchannels() != 1 or source.getsampwidth() != 2
                    or source.getframerate() != 16_000 or source.getcomptype() != "NONE"):
                raise AudioFormatError("Expected mono 16-kHz PCM16 WAV audio.")
            frame_count = source.getnframes()
            if not 0 < frame_count <= 16_000 * MAX_SECONDS:
                raise AudioFormatError("Audio clip duration is outside the supported range.")
            frames = source.readframes(frame_count)
            if len(frames) != frame_count * 2:
                raise AudioFormatError("WAV frame data is incomplete.")
    except (wave.Error, EOFError) as error:
        raise AudioFormatError("Malformed WAV audio.") from error
    return np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0


def load_model():
    if not MODEL_PATH.is_dir() or not (MODEL_PATH / "model.bin").is_file():
        raise FileNotFoundError(
            f"Local INT8 model not found at {MODEL_PATH}. "
            "Run tools/prepare-local-taigi.py first."
        )
    if not 1 <= CPU_THREADS <= 12:
        raise ValueError("HEARLENS_ASR_CPU_THREADS must be between 1 and 12.")
    from faster_whisper import WhisperModel

    return WhisperModel(
        str(MODEL_PATH), device="cpu", compute_type="int8", cpu_threads=CPU_THREADS,
    )


class LocalTaigiHandler(BaseHTTPRequestHandler):
    server_version = "HearLensLocalASR/1"
    protocol_version = "HTTP/1.1"

    def _cors_headers(self) -> dict[str, str]:
        origin = self.headers.get("Origin", "").rstrip("/")
        if not origin or origin not in ALLOWED_ORIGINS:
            return {}
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Private-Network": "true",
            "Access-Control-Max-Age": "600",
            "Vary": "Origin",
        }

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in self._cors_headers().items():
            self.send_header(key, value)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _json(self, status: int, payload: dict) -> None:
        self._send(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")

    def _origin_allowed(self) -> bool:
        origin = self.headers.get("Origin")
        return not origin or origin.rstrip("/") in ALLOWED_ORIGINS

    def do_OPTIONS(self) -> None:
        if not self._origin_allowed():
            self._send(403, b"", "text/plain; charset=utf-8")
            return
        self._send(204, b"", "text/plain; charset=utf-8")

    def do_GET(self) -> None:
        if not self._origin_allowed():
            self._json(403, {"detail": "Origin is not allowed."})
        elif self.path == "/v1/health":
            self._json(200, {
                "ready": True,
                "model": MODEL_ID,
                "revision": MODEL_REVISION,
                "device": "cpu",
                "compute_type": "int8",
            })
        else:
            self._json(404, {"detail": "Not found."})

    def do_POST(self) -> None:
        if not self._origin_allowed():
            self._json(403, {"detail": "Origin is not allowed."})
            return
        if self.path != "/v1/transcribe":
            self._json(404, {"detail": "Not found."})
            return
        if self.headers.get_content_type() != "audio/wav":
            self._json(415, {"detail": "Expected audio/wav."})
            return
        try:
            length = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            length = -1
        if not 44 < length <= MAX_WAV_BYTES:
            self._json(413, {"detail": "Audio clip exceeds the local size limit."})
            return

        self.connection.settimeout(10)
        payload = self.rfile.read(length)
        if len(payload) != length:
            self._json(400, {"detail": "Audio upload was incomplete."})
            return
        try:
            audio = decode_pcm16_wav(payload)
        except AudioFormatError as error:
            self._json(422, {"detail": str(error)})
            return

        try:
            with self.server.model_lock:
                segments, _info = self.server.model.transcribe(
                    audio,
                    language="zh",
                    task="transcribe",
                    beam_size=1,
                    vad_filter=True,
                    condition_on_previous_text=False,
                )
                text = "".join(segment.text for segment in segments).strip()
        except Exception:
            self._json(500, {"detail": "本機台語模型處理失敗。"})
            return
        self._json(200, {"text": text, "model": MODEL_ID, "language": "zh"})

    def log_message(self, format: str, *args) -> None:
        # Deliberately omit request bodies and transcript text from server logs.
        sys.stderr.write("local-asr %s %s\n" % (self.address_string(), format % args))


class LoopbackServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> int:
    model = load_model()
    server = LoopbackServer(("127.0.0.1", 8765), LocalTaigiHandler)
    server.model = model
    server.model_lock = threading.Lock()
    print(
        f"HearLens local Taigi model is ready at http://127.0.0.1:8765 "
        f"(CPU INT8, {CPU_THREADS} threads). Audio is processed in memory.",
        flush=True,
    )
    print("Allowed browser origins: " + ", ".join(sorted(ALLOWED_ORIGINS)), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Local Taigi service failed: {error}", file=sys.stderr)
        raise SystemExit(1)
