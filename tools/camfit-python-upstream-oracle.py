#!/usr/bin/env python3
"""Execute the UNMODIFIED pinned PyClarity CAMFIT function on M03 fixtures.

This script downloads two exact, commit-pinned upstream Python source files and
checks their Git blob object IDs BEFORE importing. It neither ships them with
HearLens nor changes its JavaScript model or enables output.

Requires Python 3.11+, numpy and scipy. Reports plain JSON on stdout.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from urllib.request import urlopen

COMMIT = "9df6486fb0bddc7619b3b99f1b3a5c72c109a3ec"
BASE = f"https://raw.githubusercontent.com/claritychallenge/clarity/{COMMIT}/"
PINNED_BLOBS = {
    "clarity/utils/audiogram.py": "59e7bd41beb5b2e3dd039094af052918673a690a",
    "clarity/enhancer/gha/gainrule_camfit.py":
        "5d6a0f374a6e46a9840738dade3ffcecfbabf519",
}
EXPECTED_FREQUENCIES = [250, 500, 1000, 2000, 4000, 8000]
EXPECTED_EDGES = [177, 354, 707, 1414, 2828, 5657, 11314]


def git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(f"blob {len(data)}".encode() + bytes([0]) + data).hexdigest()


def get_originals(directory: Path) -> None:
    for relative, expected in PINNED_BLOBS.items():
        with urlopen(BASE + relative, timeout=30) as response:
            data = response.read(100000)
        actual = git_blob_sha(data)
        if actual != expected:
            raise RuntimeError(
                f"Upstream source integrity failure {relative}: {actual}"
            )
        path = directory / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


def run_case(case, numpy, audiogram_cls, rule):
    assert case["frequenciesHz"] == EXPECTED_FREQUENCIES, "frequency grid changed"
    assert case["bandEdgesHz"] == EXPECTED_EDGES, "edge grid changed"
    levels = case["inputLevelsDbSPL"]
    assert isinstance(levels, list) and 1 <= len(levels) <= 16
    assert all(type(x) is int or type(x) is float for x in levels)
    for side in ("left", "right"):
        assert len(case["ears"][side]) == 6, "explicit bilateral oracle profiles only"
    freq = numpy.asarray(EXPECTED_FREQUENCIES)
    left = audiogram_cls(
        levels=numpy.asarray(case["ears"]["left"], dtype=float), frequencies=freq)
    right = audiogram_cls(
        levels=numpy.asarray(case["ears"]["right"], dtype=float), frequencies=freq)
    gains, noisegate, slopes = rule(
        left, right,
        {"frequencies": EXPECTED_FREQUENCIES,
         "levels": levels,
         "edge_frequencies": EXPECTED_EDGES},
        noisegatelevels=45, noisegateslope=1,
        level=0, max_output_level=100)
    assert tuple(gains.shape) == (len(levels), 6, 2)
    # Preserve full matrix and useful summary, no rounded precision.
    matrices = {
        side: [[float(gains[li, fi, ei]) for fi in range(6)]
               for li in range(len(levels))]
        for ei, side in enumerate(("left", "right"))
    }
    return {
        "id": case["id"],
        "gains": matrices,
        "noisegateLevels": noisegate.tolist(),
        "noisegateSlopes": slopes.tolist(),
    }


def main() -> None:
    request = json.load(sys.stdin)
    assert request["schema"] == "hearlens-m03-camfit-crosscheck-request-v1"
    cases = request["cases"]
    assert isinstance(cases, list) and 1 <= len(cases) <= 20
    with TemporaryDirectory(prefix="hearlens-pinned-pyclarity-") as directory:
        root = Path(directory)
        get_originals(root)
        sys.path.insert(0, str(root))
        # These imports execute the actual upstream module; NO stubbed gain
        # function, constants, reference tables or synthetic port are used.
        import numpy as np
        from clarity.utils.audiogram import Audiogram
        from clarity.enhancer.gha.gainrule_camfit import gainrule_camfit_compr

        reports = [run_case(case, np, Audiogram, gainrule_camfit_compr)
                   for case in cases]
    json.dump({
        "schema": "hearlens-m03-camfit-crosscheck-oracle-v1",
        "upstreamCommit": COMMIT,
        "verifiedBlobShas": PINNED_BLOBS,
        "cases": reports,
    }, sys.stdout, allow_nan=False)
    sys.stdout.write(chr(10))


if __name__ == "__main__":
    main()
