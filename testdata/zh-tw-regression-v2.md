# HearLens controlled Taiwan-Mandarin regression source v2

Source ID: `zh-tw-regression-v2`

## Transcript

今天是十月五日，現在進行 HearLens 中文語音辨識測試。

請把手機放在固定位置，不要改變播放音量。

第一段，今天天氣不錯，我們下午三點在門口見面。

第二段，請記得帶健保卡、手機和雨傘。

第三段，我的電話末四碼是五七二九，房間號碼是一二零八。

第四段，醫師說下週二上午九點半回診。

第五段，早餐我想吃蛋餅、豆漿和一杯熱咖啡。

第六段，請幫我把客廳的燈關掉，窗戶記得留一點縫。

最後一句，這是一段固定的台灣華語測試語音，請記錄完整的辨識結果。

## Reference file

- File: `testdata/audio/hearlens-zh-tw-regression-v2.wav`
- Duration: 45.554 s
- Sample rate: 24,000 Hz
- Channels: mono
- Encoding: PCM 16-bit
- Peak: approximately -4.37 dBFS
- Overall RMS: approximately -19.71 dBFS
- SHA-256: `cdd7b9d8d1c94d1f254d7c9fe20b598e1e99982fb1bd96e3555c823ca32b77da`

## Use

Use this v2 source as the primary controlled playback source for the current HearLens regression gate.

Keep the playback phone, playback volume, room, receiving-phone orientation, distance, and source file unchanged between A/B runs. Record `zh-tw-regression-v2` in the test report.

Do not normalize, trim, transcode, or otherwise modify the file between runs.
