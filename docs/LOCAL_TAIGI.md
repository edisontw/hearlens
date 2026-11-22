# Local Taiwanese Hokkien mode

HearLens adds an opt-in Taiwanese Hokkien (Taigi) caption mode. It uses the
CPU-only CTranslate2 INT8 runtime on the Windows PC and does not send captured
audio to a cloud STT provider. The browser submits one 12-second mono PCM16 WAV
clip at a time to a service bound only to `127.0.0.1`; the service keeps audio
and transcripts in memory and does not write them to disk or log transcript
text.

## One-time model setup

Run in PowerShell from the repository root:

```powershell
& .\tools\setup-local-taigi.ps1
```

This creates `.venv-local-taigi`, installs a CPU-only conversion environment,
downloads the pinned MediaTek `Breeze-ASR-26` checkpoint, and converts it to
CTranslate2 INT8 under `.models/`. The source checkpoint is about 6.18 GB;
conversion also needs several gigabytes of free disk space. No model files or
audio samples belong in Git.

## Start the local service

Keep this PowerShell window open:

```powershell
& .\.venv-local-taigi\Scripts\python.exe .\tools\local_taigi_server.py
```

Start the HearLens web app in a second window and open it at `http://localhost:8080`
(or another loopback origin added to the local service allowlist):

```powershell
& .\.venv-local-taigi\Scripts\python.exe -m http.server 8080 --directory apps/web
```

Select
**台語（本機 Ryzen 5 模型；漢字轉寫）** before starting captions. The first
caption arrives after a complete 12-second audio window plus inference time;
latency depends on the CPU. A final clip shorter than 0.75 seconds is discarded.

The service accepts browser origins `http://localhost:8080` and
`http://127.0.0.1:8080` by default. Add exact origins separated by semicolons
before starting the service when the development port differs:

```powershell
$env:HEARLENS_ALLOWED_ORIGINS = 'http://localhost:8081;http://127.0.0.1:8081'
& .\.venv-local-taigi\Scripts\python.exe .\tools\local_taigi_server.py
```

The service always binds to loopback. It limits clips to 16 seconds, validates
mono 16-kHz PCM16 WAV input, and serializes inference. If the model cannot keep
up with two queued clips, HearLens stops capture and shows an error instead of
growing an audio backlog. `HEARLENS_ASR_CPU_THREADS` defaults to 6 and accepts
values from 1 to 12.

## Model limits

The model is pinned to
[`MediaTek-Research/Breeze-ASR-26`](https://huggingface.co/MediaTek-Research/Breeze-ASR-26/tree/7b992682e7f5ceedd0a41ebec240f01ba469d19e)
under Apache 2.0. It writes Taigi speech using Mandarin Chinese characters,
not native Taigi orthography. Its card reports 30.13% mean character error
rate over 30 benchmark examples, and its training data is synthetic; actual
conversation accuracy and Ryzen CPU speed have not been measured here. Treat
each caption as a draft and correct it when accuracy matters.

The server fixes the Whisper decoder language token to `zh` because this model
uses the standard Chinese token while producing Chinese-character text. The
Taiwanese Hokkien mode remains explicitly labeled in the UI; it does not claim
Taibun output, word-level alignment, or a measured real-time factor.
