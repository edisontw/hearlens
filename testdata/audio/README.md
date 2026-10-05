# Controlled regression audio

This directory stores fixed playback sources used by HearLens engineering regression tests.

## Current primary source

- Source ID: `zh-tw-regression-v2`
- File: `hearlens-zh-tw-regression-v2.wav`
- Format: WAV, mono, 24 kHz, 16-bit PCM
- Duration: 45.554 s
- SHA-256: `cdd7b9d8d1c94d1f254d7c9fe20b598e1e99982fb1bd96e3555c823ca32b77da`

Do not silently replace a regression source while keeping the same source ID. If the spoken content, voice, timing, normalization, encoding, or sample data changes, create a new source ID.

The binary WAV is uploaded separately through GitHub when local-to-connector binary upload is unavailable.
