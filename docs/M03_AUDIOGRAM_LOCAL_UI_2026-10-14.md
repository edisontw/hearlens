# M03 — 本機聽力圖輸入與管理頁面（2026-10-14）

## Why this milestone

The versioned bilateral audiogram domain model already passed offline tests, but the deployed Web Hearing Lab had no usable entry point for family/caregiver entry. This release closes that product gap without adding a microphone, hearing amplification, or another offline DSP simulation.

## User-facing feature

From the main page's expanded **研究／裝置資訊** section, open **聽力圖資料（研究用）**. On the separate page:

- enter **right and left ear independently** at 250/500/1000/2000/4000/8000 Hz;
- an empty field means **not measured**, not zero; true zero is allowed;
- optionally assign source and test date to each ear;
- see a simple chart of **only entered points**, with no line through unknown frequencies;
- choose **儲存到這台裝置** to save versioned JSON in this browser's localStorage;
- export or import a strictly schema-validated JSON file, without importing automatically into persistent storage;
- manually clear saved data and the entire form.

Values are dB HL, **not** EQ gain, output dB SPL, REAR/REIG, fitting targets, safety limits or ear-level MPO. Audiogram data are **not linked to Gemini**, the token broker, realtime sound, or native playback.

## Privacy and limits

LocalStorage is **not encrypted**; saving is explicitly opt-in by button, with a warning against shared devices. The page does not collect names, birth dates, voice, email, or accounts. Do not claim that browser profile storage is suitable for protected health records. Exported JSON is similarly sensitive; deletion only clears the current browser origin and does not recall previously exported files. Browser cache/backup/shared-account behavior remains outside this feature's control.

Browser release staging copies the *existing* source-of-truth `packages/audiogram/audiogram.mjs` module into the static site's `audiogram-domain.mjs`. There is no duplicated validation formula. Domain import, strict JSON validation, missing measurement semantics, independent ears, deletion wiring and forbidden live audio paths are covered by a dedicated Node test in CI.

## Acceptance gates

- [x] Source schema and form adapter tests defined.
- [ ] GitHub PR CI PASS and static deployment success.
- [ ] Moto g62 browser check: open editor, enter L/R thresholds, save, reload, import/export and clear.
- [ ] Do **not** mark acoustic latency, real-ear fitting, route hard mute or hearing output as PASS.

If localStorage is unavailable, data may be viewed and exported in-session but persistence must fail visibly. No microphone permissions are requested by this page.
