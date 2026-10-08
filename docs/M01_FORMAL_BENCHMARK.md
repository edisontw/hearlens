# M01 Formal Taiwan-Mandarin Benchmark

Status: **locked protocol v1 preparation**

This protocol is the formal validation step for the M01 Caption Hearing Lab. It is intentionally separate from the earlier engineering A/B tests.

## 1. Scope

The benchmark answers four questions:

1. How accurately does the frozen caption pipeline recognize the locked Taiwan-Mandarin source?
2. How often does it miss whole source utterances?
3. How reliably does it preserve predefined high-value information such as times and numbers?
4. What client-observed caption timing and audio-safety telemetry are produced under the same controlled conditions?

It does **not** tune gain, choose new device-specific constants, or justify hearing-aid output claims.

## 2. Frozen pipeline for benchmark v1

Benchmark v1 must use one exact GitHub main build. Before the first formal run, record:

- GitHub main SHA,
- Web build ID,
- STT provider/model,
- capture preset,
- adaptive-normalization profile,
- source WAV SHA-256.

Do not change capture constraints, resampling, adaptive normalization, limiter, STT provider/model, or Traditional-Chinese conversion in the middle of a benchmark set. If one of those changes, start a new benchmark version.

## 3. Locked source

Primary source:

- ID: `zh-tw-regression-v2`
- File: `testdata/audio/hearlens-zh-tw-regression-v2.wav`
- SHA-256: `cdd7b9d8d1c94d1f254d7c9fe20b598e1e99982fb1bd96e3555c823ca32b77da`
- Duration: 45.554 s
- Playback file must not be normalized, trimmed, transcoded, or otherwise modified.

Scoring definition:

- `testdata/benchmark/zh-tw-regression-v2.json`

## 4. Preflight completeness gate

Before starting or restarting the 24-run core after any processing-path change:

1. run one 0.5 m Auto trial,
2. run one 0.5 m Far / Noisy trial,
3. play the entire locked 45.554 s source,
4. confirm the retained final transcript reaches the source tail / closing sentence,
5. inspect the event log for stop-flush timeout or capture mismatch.

These two preflight runs are pipeline checks, not part of the 24-run analysis set. If the source tail is systematically absent, stop and fix finalization / segmentation before spending time on the full matrix.

## 5. Core M01 matrix

Use the smallest matrix that answers the product question without repeating the exploratory development matrix.

### Receiving devices

Required:

1. current iPhone test path,
2. HTC U23.

A third phone may be added later, but is not required to start benchmark v1.

### Capture policy

Test both current user-facing policies:

- **Auto** -> raw capture
- **Far / Noisy** -> voice capture

Do not use engineering `?gain=` or `tuning=v1` overrides.

### Distance

- 0.5 m
- 1 m
- 2 m

### Repeats

- 2 complete runs per device × preset × distance cell.

Core total:

`2 devices × 2 presets × 3 distances × 2 repeats = 24 runs`

This is the locked M01 controlled core. Do not expand to TV / restaurant / car / clinic scenes until these 24 runs are complete and reviewed. Those robustness scenes belong to the later scene-validation stage.

## 6. Controlled setup

For every run:

- use the same playback phone,
- use the same playback volume setting,
- use the same room,
- keep playback and receiving phones at fixed height and orientation,
- measure distance between the playback-phone loudspeaker and receiving-phone microphone reference point,
- keep the receiving phone stationary,
- start HearLens first and wait until status is listening,
- then play the locked WAV once from the beginning,
- do not speak or handle either phone during playback,
- stop HearLens after the final source sentence has had time to finalize.

Every exported report must fill:

- receiving-device model,
- distance,
- playback-volume field,
- environment / orientation note.

A report with missing controlled metadata can be retained for debugging but is not part of the formal analysis set.

## 7. Primary and secondary metrics

### 6.1 Primary: strict display CER

The automated scorer:

- applies Unicode NFKC,
- lowercases Latin text,
- removes whitespace and Unicode punctuation,
- preserves content characters,
- **does not silently convert Chinese-number words to Arabic digits**.

This is intentionally strict and reproducible.

Primary endpoint:

- character error rate (CER) = Levenshtein character edits / reference characters.

### 6.2 Predeclared key-field accuracy

Some clinically or practically important fields can have equivalent display forms. Allowed alternatives are declared **before testing** in the benchmark JSON, for example:

- `三` / `3`,
- `五七二九` / `5729`,
- `一二零八` / `1208`.

Do not add a new accepted variant after seeing a benchmark result unless the entire scoring definition is versioned and the whole set is rescored.

### 6.3 Utterance coverage / missed rate

Nine unique source anchors are predefined in the benchmark JSON.

- utterance coverage = matched anchors / 9
- missed-utterance rate = 1 - utterance coverage

This is a coarse completeness measure and should be reported together with CER, not instead of CER.

### 6.4 Caption timing

Current report fields include:

- audio startup time from session start,
- first partial after first audio chunk,
- first final after first audio chunk.

These are **client-observed startup timings**, not yet acoustic speech-onset-to-caption latency.

For benchmark v1 accuracy runs, retain these fields as engineering covariates. Do not label them formal end-to-end speech latency until a locked speech-onset reference is added.

### 6.5 Audio safety / stability telemetry

Record:

- clipping percentage,
- limiter reduction,
- adaptive gain behavior,
- actual EC / NS / AGC state.

Any run with clipping or unexpected capture-policy mismatch should be flagged before accuracy comparison.

## 8. Automated scoring

Given a copied HearLens report saved as `report.json`:

```bash
npm run benchmark:score -- report.json testdata/benchmark/zh-tw-regression-v2.json
```

The scorer outputs:

- strict CER,
- key-field accuracy,
- utterance coverage and missed rate,
- build / device / distance / preset metadata,
- copied caption-latency telemetry,
- final transcript.

Scoring code and benchmark definition are version-controlled with the reports.

## 9. Analysis unit

Keep every individual run.

For each device × preset × distance cell, report both repeats and summarize:

- median CER,
- range of CER,
- median key-field accuracy,
- median utterance coverage,
- whether either run had clipping / limiter activity / capture mismatch.

Do not average away an obvious failed session. A catastrophic outlier is itself evidence of reliability problems.

## 10. Initial decision rules

Benchmark v1 is descriptive first; avoid inventing pass thresholds after seeing results.

The following trigger investigation rather than automatic retuning:

- repeated whole-utterance misses,
- large repeat-to-repeat variability,
- clipping,
- capture settings not matching the selected preset,
- 2 m degradation despite adequate non-clipped normalized level.

If Far / Noisy materially improves completeness at distance without causing a normal-distance penalty, retain the current two-preset policy. Do not automatically promote voice capture to global Auto from one device alone.

## 11. What closes M01

M01 formal validation is complete when:

- all 24 controlled core runs are collected with complete metadata,
- all reports score successfully with the locked scorer,
- results are summarized by device / preset / distance,
- failures and repeat variability are documented,
- the benchmark main SHA / build and source hash are frozen in the result summary.

Real-speaker, noisy-scene, proximity-SNR, and hearing-output evaluation continue in M02+; they are not prerequisites for closing the controlled M01 caption benchmark.
