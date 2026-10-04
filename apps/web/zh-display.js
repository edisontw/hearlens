const OPENCC_MODULE_URL =
  "https://cdn.jsdelivr.net/npm/opencc-js@1.4.1/dist/esm/full.js";

let converter = (text) => text;
let loadPromise = null;

export function installOpenCC(OpenCC) {
  if (!OpenCC?.Converter) {
    throw new Error("OpenCC Converter is unavailable.");
  }

  converter = OpenCC.Converter({
    from: "cn",
    to: "tw",
  });
}

export function toTaiwanTraditional(text) {
  return converter(String(text ?? ""));
}

export function ensureTaiwanTraditionalDisplay({
  loader = () => import(OPENCC_MODULE_URL),
} = {}) {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const module = await loader();
      installOpenCC(module.default || module);
      return true;
    } catch (error) {
      console.warn(
        "Traditional Chinese display conversion unavailable; using raw transcript.",
        error instanceof Error ? error.message : error,
      );
      return false;
    }
  })();

  return loadPromise;
}
