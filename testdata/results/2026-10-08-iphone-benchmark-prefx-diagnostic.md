# iPhone formal-benchmark intake — pre-fix diagnostic — 2026-10-08

## Status

**Do not count these runs as the final M01 benchmark set.**

The operator supplied a batch described in this intended order:

1. Auto 0.5 m ×2
2. Auto 1 m ×2
3. Auto 2 m ×2
4. Far/Noisy 2 m ×2
5. Far/Noisy 1 m ×2
6. Far/Noisy 0.5 m ×2

The pasted attachment contains only **11 report headers**. Cross-checking each report's runtime preset / capture mode / distance shows that **Auto / 1 m repeat 2 is missing from the attachment**. The raw reports also omit receiving-device model, source-volume field, and notes, so this intake is diagnostic rather than a complete formal metadata set.

All received reports use build `20261008-caption-latency1`, Gemini Live, adaptive normalization, target `-48 dBFS`, gain range `1–8x`.

## Locked scorer results

Scores use the version-controlled `zh-tw-regression-v2` benchmark definition and strict CER scorer.

| Received run | Condition | Repeat | CER | Key fields | Utterance anchors | First partial* | First final* |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | Auto / 0.5 m | 1 | 52.7% | 5/6 | 4/9 | 3.833 s | 20.642 s |
| 2 | Auto / 0.5 m | 2 | 59.0% | 4/6 | 3/9 | 4.079 s | 16.161 s |
| 3 | Auto / 1 m | 1 | 70.7% | 4/6 | 4/9 | 15.138 s | 17.109 s |
| — | Auto / 1 m | 2 | **missing** | — | — | — | — |
| 4 | Auto / 2 m | 1 | 93.6% | 1/6 | 1/9 | 25.120 s | 27.132 s |
| 5 | Auto / 2 m | 2 | 80.9% | 1/6 | 2/9 | 13.953 s | 16.033 s |
| 6 | Far/Noisy / 2 m | 1 | 79.3% | 3/6 | 2/9 | 13.813 s | 18.394 s |
| 7 | Far/Noisy / 2 m | 2 | 67.0% | 3/6 | 3/9 | 12.562 s | 20.974 s |
| 8 | Far/Noisy / 1 m | 1 | 54.8% | 3/6 | 4/9 | 5.534 s | 8.490 s |
| 9 | Far/Noisy / 1 m | 2 | 48.9% | 5/6 | 4/9 | 4.602 s | 16.023 s |
| 10 | Far/Noisy / 0.5 m | 1 | 55.9% | 4/6 | 4/9 | 2.127 s | 26.893 s |
| 11 | Far/Noisy / 0.5 m | 2 | 48.9% | 5/6 | 4/9 | 2.745 s | 27.804 s |

* Client-observed from first audio chunk; not formal acoustic speech-onset latency.

### Two-repeat cell summaries

| Condition | n | Median CER | CER range | Median key-field accuracy | Median utterance coverage |
| --- | ---: | ---: | ---: | ---: | ---: |
| Auto / 0.5 m | 2 | 55.9% | 52.7–59.0% | 75.0% | 38.9% |
| Auto / 1 m | 1 | 70.7% | single run | 66.7% | 44.4% |
| Auto / 2 m | 2 | 87.2% | 80.9–93.6% | 16.7% | 16.7% |
| Far/Noisy / 2 m | 2 | 73.1% | 67.0–79.3% | 50.0% | 27.8% |
| Far/Noisy / 1 m | 2 | 51.9% | 48.9–54.8% | 66.7% | 44.4% |
| Far/Noisy / 0.5 m | 2 | 52.4% | 48.9–55.9% | 75.0% | 44.4% |

## Main finding

This batch exposes a pipeline-completeness problem before it can serve as the formal benchmark.

Even at 0.5 m, the retained final transcripts usually stop around source sections 3–4. None of the 11 received reports reaches the locked closing-sentence anchor. The problem therefore cannot be explained by far-field scalar level alone.

The current Gemini provider's stop path is a plausible truncation mechanism:

- it sends `audioStreamEnd`,
- waits only 1.5 s,
- and resolves the stop wait as soon as the first final transcription arrives while stopping.

Gemini Live documents input transcription as independently delivered with no guaranteed ordering relative to other server content. Closing immediately after the first stopping-time final can therefore discard later transcription packets.

## Decision

1. Pause the 24-run formal benchmark. Do not run the HTC half yet.
2. Fix Gemini stop/drain handling.
3. After deployment, run only two 0.5 m preflight gates: Auto once and Far/Noisy once.
4. Confirm that the source tail / closing sentence is retained before restarting the formal matrix.
5. Treat this 11-report batch as pre-fix diagnostic evidence, not the final benchmark result.
