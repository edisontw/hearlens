"""Download and make a pinned CPU INT8 CTranslate2 copy of Breeze-ASR-26."""

from pathlib import Path
import subprocess
import sys

from huggingface_hub import snapshot_download
from transformers import AutoTokenizer


REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_REPOSITORY = "MediaTek-Research/Breeze-ASR-26"
MODEL_REVISION = "7b992682e7f5ceedd0a41ebec240f01ba469d19e"
MODEL_CACHE = REPO_ROOT / ".models"
SOURCE_DIR = MODEL_CACHE / "breeze-asr-26-transformers"
TARGET_DIR = MODEL_CACHE / "breeze-asr-26-ct2-int8"
STAGING_DIR = MODEL_CACHE / "breeze-asr-26-ct2-int8.staging"

MODEL_FILES = [
    "added_tokens.json",
    "config.json",
    "generation_config.json",
    "merges.txt",
    "model-00001-of-00002.safetensors",
    "model-00002-of-00002.safetensors",
    "model.safetensors.index.json",
    "normalizer.json",
    "preprocessor_config.json",
    "special_tokens_map.json",
    "tokenizer_config.json",
    "vocab.json",
]


def main() -> int:
    if TARGET_DIR.exists():
        print(f"Model is already prepared at {TARGET_DIR}")
        return 0
    if STAGING_DIR.exists():
        raise RuntimeError(
            f"A previous conversion left {STAGING_DIR}. Inspect it before continuing; "
            "the preparation tool will not delete model files."
        )

    MODEL_CACHE.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {MODEL_REPOSITORY} at pinned revision {MODEL_REVISION}.", flush=True)
    snapshot_download(
        repo_id=MODEL_REPOSITORY,
        revision=MODEL_REVISION,
        local_dir=str(SOURCE_DIR),
        allow_patterns=MODEL_FILES,
    )

    tokenizer = AutoTokenizer.from_pretrained(
        str(SOURCE_DIR), use_fast=True, trust_remote_code=False,
    )
    tokenizer.save_pretrained(str(SOURCE_DIR))
    tokenizer_file = SOURCE_DIR / "tokenizer.json"
    if not tokenizer_file.is_file():
        raise RuntimeError("Transformers did not create the tokenizer.json required by faster-whisper.")

    command = [
        "ct2-transformers-converter",
        "--model", str(SOURCE_DIR),
        "--output_dir", str(STAGING_DIR),
        "--copy_files", "tokenizer.json", "preprocessor_config.json",
        "--quantization", "int8",
    ]
    print("Converting the model to CPU INT8; this step can take several minutes.", flush=True)
    subprocess.run(command, cwd=REPO_ROOT, check=True)
    for required in ("model.bin", "config.json", "tokenizer.json"):
        if not (STAGING_DIR / required).is_file():
            raise RuntimeError(f"CTranslate2 conversion did not produce {required}.")
    STAGING_DIR.replace(TARGET_DIR)
    print(f"Prepared local model at {TARGET_DIR}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Local Taigi model setup failed: {error}", file=sys.stderr)
        raise SystemExit(1)
