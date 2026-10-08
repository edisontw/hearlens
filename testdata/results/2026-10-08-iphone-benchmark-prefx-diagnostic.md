# iPhone shortened-source intake — operator-truncated exploratory set — 2026-10-08

## Correction

The earlier interpretation of this batch as evidence of long-source finalization loss was incorrect.

The operator clarified that, to avoid disturbing other people, playback was intentionally stopped around the end of section 3. Therefore the missing sections 4–6 and closing sentence were **not presented acoustically** and must not be counted as recognition errors.

The attachment contains **11 report headers**. The intended sequence was:

1. Auto 0.5 m ×2
2. Auto 1 m ×2
3. Auto 2 m ×2
4. Far/Noisy 2 m ×2
5. Far/Noisy 1 m ×2
6. Far/Noisy 0.5 m ×2

Cross-checking runtime preset / capture mode / distance shows that **Auto / 1 m repeat 2 is absent from the attachment**.

The raw reports also omit receiving-device model, source-volume field, and notes. Keep them as exploratory evidence rather than the final formal set.

## Corrected scoring basis

For this intake, use the shortened reference ending after:

`第三段，我的電話末四碼是五七二九，房間號碼是一二零八。`

Definition:

- `testdata/benchmark/zh-tw-regression-v2-short.json`

Because the operator described the cutoff as approximately after section 3 rather than a machine-timed cutoff, these values are still **exploratory**. They are nevertheless much more meaningful than scoring against unplayed source material.

## Corrected per-run scores

| Received run | Condition | Repeat | Short-reference CER | Key fields | Short anchors | First partial* | First final* |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | Auto / 0.5 m | 1 | 20.2% | 5/5 | 4/5 | 3.833 s | 20.642 s |
| 2 | Auto / 0.5 m | 2 | 26.0% | 4/5 | 3/5 | 4.079 s | 16.161 s |
| 3 | Auto / 1 m | 1 | 47.1% | 4/5 | 4/5 | 15.138 s | 17.109 s |
| — | Auto / 1 m | 2 | **missing** | — | — | — | — |
| 4 | Auto / 2 m | 1 | 88.5% | 1/5 | 1/5 | 25.120 s | 27.132 s |
| 5 | Auto / 2 m | 2 | 65.4% | 1/5 | 2/5 | 13.953 s | 16.033 s |
| 6 | Far/Noisy / 2 m | 1 | 62.5% | 3/5 | 2/5 | 13.813 s | 18.394 s |
| 7 | Far/Noisy / 2 m | 2 | 46.2% | 3/5 | 3/5 | 12.562 s | 20.974 s |
| 8 | Far/Noisy / 1 m | 1 | 18.3% | 3/5 | 4/5 | 5.534 s | 8.490 s |
| 9 | Far/Noisy / 1 m | 2 | 36.5% | 4/5 | 3/5 | 4.602 s | 16.023 s |
| 10 | Far/Noisy / 0.5 m | 1 | 24.0% | 4/5 | 4/5 | 2.127 s | 26.893 s |
| 11 | Far/Noisy / 0.5 m | 2 | 7.7% | 5/5 | 4/5 | 2.745 s | 27.804 s |

* Client-observed from first audio chunk; not formal acoustic speech-onset latency.

## Cell summaries

| Condition | n | Median short CER | CER range | Median key-field accuracy | Median short-anchor coverage |
| --- | ---: | ---: | ---: | ---: | ---: |
| Auto / 0.5 m | 2 | **23.1%** | 20.2–26.0% | 90% | 70% |
| Auto / 1 m | 1 | **47.1%** | single run | 80% | 80% |
| Auto / 2 m | 2 | **76.9%** | 65.4–88.5% | 20% | 30% |
| Far/Noisy / 2 m | 2 | **54.3%** | 46.2–62.5% | 60% | 50% |
| Far/Noisy / 1 m | 2 | **27.4%** | 18.3–36.5% | 70% | 70% |
| Far/Noisy / 0.5 m | 2 | **15.9%** | 7.7–24.0% | 90% | 80% |

## Interpretation

The corrected short-reference analysis supports the earlier qualitative direction:

- performance worsens substantially with distance under Auto/raw,
- Far/Noisy/voice improves the 1 m and 2 m cells relative to Auto/raw in this exploratory iPhone set,
- 0.5 m is already strong under both policies, with Far/Noisy slightly better in these two repeats,
- repeat variability is still large enough that this batch should not be promoted to the final benchmark.

Do not use the earlier full-source CER values. They were invalid because unplayed material was incorrectly counted as deletion errors.

## Stop-flush change

The stop/drain hardening merged in build `20261008-stop-flush1` is retained as a defensive protocol fix, not as a bug proven by this batch.

Google Live API documents input transcription as being sent independently from other server messages with no guaranteed ordering. Therefore waiting for `turnComplete` plus a short drain grace is a reasonable correctness safeguard, but this operator-truncated dataset does not demonstrate that the previous implementation actually lost the source tail.

## Decision

1. Keep these 11 runs as corrected shortened-source exploratory evidence.
2. Do not require replay of a full 45.554 s source for every benchmark cell.
3. Use the reduced-disturbance short protocol through section 3 for the next formal set.
4. Standardize the cutoff after the complete `房間號碼是一二零八` sentence rather than stopping at an approximate arbitrary time.
5. Collect the missing cells only as part of the new standardized short benchmark; do not try to repair the old intake by mixing protocols.
