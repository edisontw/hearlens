# Test Data Collection Pipeline

Updated: 2026-10-07

## Goal

Make HearLens engineering tests reproducible now and scalable later.

## Phase 1 — manual export

The Web Hearing Lab exports one `hearlens-test-report-v1` JSON object containing the build, session, test source, human-readable receiving-device label/model, distance, playback-volume note, STT/input settings, device diagnostics, browser metadata, full-session final transcript, and retained telemetry log.

The one-click copy button is the canonical manual export path.

## Phase 2 — MN4 collector

When test volume becomes large, add a small HTTPS collector on MN4:

```
Browser -> MN4 test-results endpoint -> validated append-only queue -> batched repository dataset update
```

The browser should only submit a test report. Repository write access remains server-side on MN4.

Suggested request envelope:

```json
{
  "schema": "hearlens-test-report-v1",
  "clientReportId": "generated-id",
  "report": { "...": "same object produced by the copy button" }
}
```

Collector requirements:

- HTTPS only,
- allow requests only from the HearLens site origin,
- request-size and rate limits,
- validate the schema version,
- add a server receipt timestamp,
- deduplicate repeated client report IDs,
- append locally before repository synchronization,
- retry failed repository synchronization later,
- do not collect raw microphone audio by default.

## Privacy boundary

Automatic upload should initially be enabled only for controlled synthetic or prerecorded engineering tests. Real conversations, clinical conversations, patient speech, or other potentially identifying content should not be uploaded automatically.

If real-user studies are added later, consent, retention, access control, and de-identification need a separate protocol.

## Suggested dataset layout

```
test-results/
  schema/
    hearlens-test-report-v1.schema.json
  runs/
    YYYY-MM/
      date-clientReportId.json
  summaries/
    regression.csv
```

For larger test volumes, MN4 should batch dataset updates rather than create one repository change per telemetry line.
