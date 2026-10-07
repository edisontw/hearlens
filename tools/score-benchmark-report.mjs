import fs from "node:fs";

export function normalizeCerText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, "");
}

export function levenshteinDistance(reference, hypothesis) {
  const a = [...String(reference ?? "")];
  const b = [...String(hypothesis ?? "")];

  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      const deletion = previous[j] + 1;
      const insertion = current[j - 1] + 1;
      current[j] = Math.min(substitution, deletion, insertion);
    }
    [previous, current] = [current, previous];
  }

  return previous[b.length];
}

export function characterErrorRate(reference, hypothesis) {
  const normalizedReference = normalizeCerText(reference);
  const normalizedHypothesis = normalizeCerText(hypothesis);
  const edits = levenshteinDistance(normalizedReference, normalizedHypothesis);
  const referenceCharacters = [...normalizedReference].length;

  return {
    edits,
    referenceCharacters,
    cer: referenceCharacters ? edits / referenceCharacters : null,
    normalizedReference,
    normalizedHypothesis,
  };
}

export function scoreKeyFields(hypothesis, keyFields = []) {
  const normalizedHypothesis = normalizeCerText(hypothesis);

  const fields = keyFields.map((field) => {
    const variants = (field.variants || []).map(normalizeCerText).filter(Boolean);
    const matchedVariant =
      variants.find((variant) => normalizedHypothesis.includes(variant)) || null;

    return {
      id: field.id,
      label: field.label || field.id,
      matched: Boolean(matchedVariant),
      matchedVariant,
    };
  });

  const matched = fields.filter((field) => field.matched).length;
  return {
    matched,
    total: fields.length,
    accuracy: fields.length ? matched / fields.length : null,
    fields,
  };
}

export function scoreBenchmarkReport(report, benchmark) {
  const hypothesis = String(report?.finalTranscript || "");
  const reference = String(benchmark?.referenceText || "");
  const cer = characterErrorRate(reference, hypothesis);
  const keyFields = scoreKeyFields(hypothesis, benchmark?.keyFields || []);

  return {
    schema: "hearlens-benchmark-score-v1",
    sourceId: benchmark?.sourceId || report?.test?.sourceId || null,
    buildId: report?.buildId || null,
    receiverDevice: report?.test?.receiverDevice || null,
    distance: report?.test?.distance || null,
    sourceVolume: report?.test?.sourceVolume || null,
    preset: report?.runtime?.preset || null,
    captureMode: report?.runtime?.captureMode || null,
    cer: {
      edits: cer.edits,
      referenceCharacters: cer.referenceCharacters,
      value: cer.cer,
    },
    keyFields,
    captionLatency: report?.captionLatency || null,
    finalTranscript: hypothesis,
  };
}

function runCli() {
  const [reportPath, benchmarkPath] = process.argv.slice(2);
  if (!reportPath || !benchmarkPath) {
    console.error(
      "Usage: node tools/score-benchmark-report.mjs <report.json> <benchmark.json>",
    );
    process.exitCode = 2;
    return;
  }

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const benchmark = JSON.parse(fs.readFileSync(benchmarkPath, "utf8"));
  process.stdout.write(
    JSON.stringify(scoreBenchmarkReport(report, benchmark), null, 2) + "\n",
  );
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  runCli();
}
