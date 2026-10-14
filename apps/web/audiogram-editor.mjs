/**
 * Browser-independent form adapter for the existing M03 audiogram schema.
 * An empty field means NOT MEASURED; it must never be interpreted as 0 dB HL.
 * No sound, network, or persistence APIs are used here.
 */
export const AUDIOGRAM_INPUT_FREQUENCIES = Object.freeze([250, 500, 1000, 2000, 4000, 8000]);
export const AUDIOGRAM_INPUT_EARS = Object.freeze(["left", "right"]);

export function parseThreshold(value) {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^-?(?:\d+)(?:\.\d+)?$/.test(value.trim())) {
    throw new TypeError("請輸入數字；未測量的頻率請留空。");
  }
  const number = Number(value.trim());
  if (!Number.isFinite(number) || number < -20 || number > 130) {
    throw new RangeError("聽力閾值只能填 -20 至 130 dB HL。");
  }
  return number === 0 ? 0 : number;
}

export function profileFromFormData(formData) {
  const ears = {};
  for (const ear of AUDIOGRAM_INPUT_EARS) {
    const data = formData?.[ear];
    if (!data || !Array.isArray(data.thresholds) ||
        data.thresholds.length !== AUDIOGRAM_INPUT_FREQUENCIES.length) {
      throw new TypeError("左右耳均須提供六個頻率欄位。");
    }
    const thresholdsDbHL = {};
    let measured = 0;
    for (let i = 0; i < AUDIOGRAM_INPUT_FREQUENCIES.length; i++) {
      const value = parseThreshold(data.thresholds[i]);
      thresholdsDbHL[AUDIOGRAM_INPUT_FREQUENCIES[i]] = value;
      if (value !== null) measured++;
    }
    if (measured === 0) {
      ears[ear] = null;
      continue;
    }
    if (!["manual", "clinical-report"].includes(data.source)) {
      throw new TypeError("資料來源必須選擇手動輸入或聽力檢查報告。");
    }
    ears[ear] = {
      thresholdsDbHL,
      provenance: { source: data.source, measuredOn: data.measuredOn || null },
    };
  }
  if (!ears.left && !ears.right) throw new TypeError("至少需要一個已測量的聽力閾值。");
  return { schema: "hearlens-audiogram-v1", ears };
}

export function formDataFromProfile(profile) {
  const result = {};
  for (const ear of AUDIOGRAM_INPUT_EARS) {
    const data = profile.ears[ear];
    result[ear] = {
      thresholds: AUDIOGRAM_INPUT_FREQUENCIES.map(
        f => data?.thresholdsDbHL[String(f)] == null ? "" : String(data.thresholdsDbHL[String(f)]),
      ),
      source: data?.provenance.source === "clinical-report" ? "clinical-report" : "manual",
      measuredOn: data?.provenance.measuredOn || "",
    };
  }
  return result;
}

export function measurementCount(profile) {
  return AUDIOGRAM_INPUT_EARS.reduce((total, ear) =>
    total + AUDIOGRAM_INPUT_FREQUENCIES.filter(f =>
      profile.ears[ear]?.thresholdsDbHL[String(f)] != null).length, 0);
}
