import {
  AUDIOGRAM_INPUT_FREQUENCIES,
  AUDIOGRAM_INPUT_EARS,
  profileFromFormData,
  formDataFromProfile,
  measurementCount,
} from "./audiogram-editor.mjs";
import {
  normalizeAudiogramProfile,
  serializeAudiogramProfile,
  deserializeAudiogramProfile,
} from "./audiogram-domain.mjs";

const STORAGE_KEY = "hearlens-audiogram-local-v1";
const NS = "http://www.w3.org/2000/svg";
const form = document.querySelector("#audiogram-form");
const status = document.querySelector("#profile-status");
const summary = document.querySelector("#profile-summary");
const chart = document.querySelector("#profile-chart");

function setStatus(message, kind = "") {
  status.textContent = message;
  status.dataset.kind = kind;
}

function readEntries() {
  const data = {};
  for (const ear of AUDIOGRAM_INPUT_EARS) {
    data[ear] = {
      thresholds: AUDIOGRAM_INPUT_FREQUENCIES.map(
        f => document.getElementById(ear + "-" + f).value.trim(),
      ),
      source: document.getElementById(ear + "-source").value,
      measuredOn: document.getElementById(ear + "-date").value,
    };
  }
  return data;
}

function loadIntoForm(profile) {
  const data = formDataFromProfile(profile);
  for (const ear of AUDIOGRAM_INPUT_EARS) {
    AUDIOGRAM_INPUT_FREQUENCIES.forEach((f, i) => {
      document.getElementById(ear + "-" + f).value = data[ear].thresholds[i];
    });
    document.getElementById(ear + "-source").value = data[ear].source;
    document.getElementById(ear + "-date").value = data[ear].measuredOn;
  }
  drawProfile(profile);
}

function svg(name, attrs = {}, text = "") {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  if (text) element.textContent = text;
  return element;
}

function drawProfile(profile = null) {
  chart.replaceChildren(svg("title", {}, "左右耳已測量的聽力閾值，並非聽力補償或輸出音量"));
  const x = i => 76 + i * 98;
  const y = v => 46 + (v + 20) * 2;
  for (const db of [-20, 0, 20, 40, 60, 80, 100, 120, 130]) {
    const yy = y(db);
    chart.append(svg("line", { x1: 70, y1: yy, x2: 578, y2: yy, class: "gridline" }));
    chart.append(svg("text", { x: 10, y: yy + 5 }, String(db)));
  }
  AUDIOGRAM_INPUT_FREQUENCIES.forEach((f, i) => {
    chart.append(svg("line", { x1: x(i), y1: 46, x2: x(i), y2: 346, class: "gridline" }));
    chart.append(svg("text", { x: x(i), y: 378, "text-anchor": "middle" }, f >= 1000 ? (f / 1000) + "k" : String(f)));
  });
  if (!profile) {
    summary.textContent = "尚未輸入資料；空白表示未測量，不代表 0 dB HL。";
    return;
  }
  for (const ear of AUDIOGRAM_INPUT_EARS) {
    const cls = ear === "left" ? "left-ear" : "right-ear";
    const thresholds = AUDIOGRAM_INPUT_FREQUENCIES.map(
      f => profile.ears[ear]?.thresholdsDbHL[String(f)] ?? null,
    );
    for (let i = 1; i < thresholds.length; i++) {
      if (thresholds[i] !== null && thresholds[i - 1] !== null) {
        chart.append(svg("line", {
          x1: x(i - 1), y1: y(thresholds[i - 1]), x2: x(i), y2: y(thresholds[i]), class: cls,
        }));
      }
    }
    thresholds.forEach((value, i) => {
      if (value === null) return;
      if (ear === "right") {
        chart.append(svg("circle", { cx: x(i), cy: y(value), r: 7, class: cls + " point" }));
      } else {
        chart.append(svg("path", {
          d: "M" + (x(i) - 6) + " " + (y(value) - 6) + " l12 12 m0 -12 l-12 12",
          class: cls + " point",
        }));
      }
    });
  }
  const left = profile.ears.left ? "左耳 " + Object.values(profile.ears.left.thresholdsDbHL).filter(v => v !== null).length + " 點" : "左耳未輸入";
  const right = profile.ears.right ? "右耳 " + Object.values(profile.ears.right.thresholdsDbHL).filter(v => v !== null).length + " 點" : "右耳未輸入";
  summary.textContent = left + "；" + right + "。共 " + measurementCount(profile) + " 個測量值（僅資料顯示）。";
}

function validProfile() {
  return normalizeAudiogramProfile(profileFromFormData(readEntries()));
}

function updatePreview() {
  try {
    const profile = validProfile();
    drawProfile(profile);
    setStatus("");
  } catch (error) {
    drawProfile();
    const anyValue = AUDIOGRAM_INPUT_EARS.some(ear =>
      readEntries()[ear].thresholds.some(value => value !== ""));
    if (anyValue) setStatus(error.message, "error");
    else setStatus("");
  }
}

document.querySelector("#profile-preview").addEventListener("click", updatePreview);
document.querySelector("#profile-save").addEventListener("click", () => {
  try {
    const profile = validProfile();
    localStorage.setItem(STORAGE_KEY, serializeAudiogramProfile(profile));
    drawProfile(profile);
    setStatus("已儲存到此瀏覽器。此儲存空間未加密；請勿在共用裝置保存。", "ok");
  } catch (error) {
    setStatus("未儲存：" + error.message, "error");
  }
});
document.querySelector("#profile-export").addEventListener("click", () => {
  try {
    const profile = validProfile();
    const blob = new Blob([serializeAudiogramProfile(profile) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hearlens-audiogram-v1.json";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    drawProfile(profile);
    setStatus("已準備匯出 JSON。檔案含有聽力資料，請妥善保管。", "ok");
  } catch (error) {
    setStatus("無法匯出：" + error.message, "error");
  }
});
document.querySelector("#profile-import").addEventListener("change", async (event) => {
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 16384) throw new Error("檔案超過 16 KB 限制。");
    const profile = deserializeAudiogramProfile(await file.text());
    loadIntoForm(profile);
    setStatus("已匯入表單，但尚未儲存到此裝置。確認無誤後再按儲存。", "ok");
  } catch (error) {
    setStatus("匯入失敗，原資料未變動：" + error.message, "error");
  } finally {
    input.value = "";
  }
});
document.querySelector("#profile-clear").addEventListener("click", () => {
  if (!window.confirm("清除本機儲存的聽力圖，並清空表單？此動作無法復原。")) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    form.reset();
    for (const ear of AUDIOGRAM_INPUT_EARS) {
      AUDIOGRAM_INPUT_FREQUENCIES.forEach(f => {
        document.getElementById(ear + "-" + f).value = "";
      });
    }
    drawProfile();
    setStatus("本機資料與表單已清除。", "ok");
  } catch (error) {
    setStatus("無法清除本機資料：" + error.message, "error");
  }
});
form.addEventListener("input", updatePreview);
form.addEventListener("change", updatePreview);

try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored !== null) {
    loadIntoForm(deserializeAudiogramProfile(stored));
    setStatus("已載入此瀏覽器先前儲存的聽力圖。", "ok");
  } else drawProfile();
} catch {
  drawProfile();
  setStatus("無法讀取本機儲存資料；請檢查瀏覽器儲存權限或舊資料格式。", "error");
}
