# Test Report — Deutsch Meister 3.7.0

**Environment:** Node.js v22.16.0; npm available; Linux container.  
**Commands:** `npm test` and `npm run check`.

## Automated test results

<summary>

- **53 tests passed**
- **0 tests failed**
- **0 tests skipped**

</summary>

Coverage includes:

- Five-page navigation structure and optional CEFR metadata fields.
- Bounded library rendering and deletion controls.
- CSV import/export parsing, quoting, BOM, TSV, delimiter detection, original 17-column sample compatibility, and formula-prefix neutralization.
- Challenge generation for articles, plurals and optional verb forms.
- Independent Leitner and SM-2 schedules.
- SM-2 Hard progression, invalid-rating rejection, inactive-word due exclusion, and local calendar boundary calculations.
- Neural voice worker/runtime configuration and mocked download/inference behavior.
- Static check that review schedule and log are written through one multi-store transaction.
- Progress calendar and CEFR UI contracts.

## Syntax checks

`npm run check` passed for all JavaScript modules and `sw.js` using `node --check`.

## Not executed / requires real browser or device

| Test | Status | Reason |
|---|---|---|
| Browser end-to-end CRUD | Not executed | Browser automation framework is not installed; headless Chromium timed out before producing DOM output |
| Real IndexedDB v2 → v3 migration | Not executed | Requires browser profile with a populated pre-upgrade database |
| JSON backup/restore in browser | Not executed | Requires browser file picker/download and populated IndexedDB |
| Offline PWA launch | Not executed | Requires service-worker-controlled browser session |
| iPhone Safari / iOS PWA | Not executed | No physical iPhone/iOS runtime available |
| Real Jarvis/Amy model downloads and audio | Not executed | Requires network access to upstream model/CDN sources, OPFS and audio output |
| Screen reader / keyboard / contrast audit | Not executed | Requires interactive accessibility tooling and manual review |

No claim is made that these unexecuted checks passed. Use `TEST-CHECKLIST.md` to complete them on the target devices.
