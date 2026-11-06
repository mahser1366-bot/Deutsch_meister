# Deutsch Meister — Technical Audit Report (3.7.0)

**Audited source:** uploaded `Deutsch_meister_v3.6.1-main.zip`  
**Actual version found in source:** `VERSION.txt` and README reported 3.6.2; the archive name reported 3.6.1.  
**Delivered version:** 3.7.0  
**Scope:** source inspection and targeted fixes across HTML, CSS, JavaScript modules, IndexedDB, scheduling, CSV, service worker, voice worker, PWA manifest, and tests.

## Architecture map

- `index.html`: five views (Home, Practice, Library, Progress, Settings), editor, review card, and navigation.
- `js/app.js`: application lifecycle, view state, vocabulary CRUD, review workflow, statistics, import/export, practice exercises, and voice UI integration.
- `js/db.js`: IndexedDB open/upgrade, object-store access, settings, and atomic review persistence.
- `js/scheduler.js`: local-calendar date helpers, legacy schedule initialization, Leitner, SM-2, and due checks.
- `js/challenges.js`: challenge/distractor generation and verb bank/question generation.
- `js/csv.js`: CSV/TSV parser and safe CSV cell serialization.
- `js/voice-manager.js`, `js/voice-worker.js`, `js/piper-core.js`: neural voice download, OPFS persistence, worker lifecycle, phonemization, ONNX inference, and audio playback.
- `sw.js`: app-shell cache, runtime asset cache, offline fallback, and service-worker lifecycle.
- `manifest.json`: PWA metadata and icons.
- `tests/*.test.mjs`: unit and static contract tests.

## Findings and fixes

| Finding | Severity | Resolution |
|---|---:|---|
| Archive name 3.6.1 disagreed with internal 3.6.2 version | Medium | Aligned app, manifest/package metadata, changelog, service-worker cache and version file at 3.7.0 |
| IndexedDB helper resolved on request success, not transaction completion | High | Operations now resolve on transaction completion and reject on abort/error |
| Review word update and review-log write could partially commit | High | Both writes now use one `words` + `reviewLogs` read-write transaction |
| Startup only persisted schedules when the entire `scheduling` object was absent | High | Startup persists missing Leitner/SM-2 branches while retaining existing branch values |
| SM-2 Hard did not increment repetitions | High | Hard now advances repetitions and uses subsequent intervals; ease factor is adjusted downward |
| Startup deleted all records with `source === 'builtin'` | High | Removed automatic deletion; existing records remain available |
| Scheduler date helper depended directly on wall-clock `new Date()` | Medium | Added explicit local-date input to scheduling and month/year boundary tests |
| Inactive entries could be included in due review | Medium | Due predicate now excludes `active === false` |
| Vocabulary model/editor lacked dedicated Persian, CEFR, tags and notes inputs | Medium | Added optional fields and exposed Persian on review cards |
| Progress only had a seven-day bar view | Medium | Added current-month calendar, CEFR counts and separate scheduler due counts |
| CSV export quoted values but did not neutralize formula-leading cells | Medium | Added formula-prefix neutralization for spreadsheet consumers |
| Backup metadata declared version 3.5 | Low | Updated backup metadata to 3.7.0 and schema version 3 |

### Clarification on the original editor

The original `fieldNotes` element was labelled “English example translation” and stored the `exampleEn` property. That mapping was internally named awkwardly, but it was not itself a data-loss bug. Version 3.7.0 retains English example translation as a separate field and adds a genuinely separate optional `notes` property.

## Data compatibility

- Database name remains `deutsch-meister-db`.
- IndexedDB version increases from 2 to 3.
- Existing stores (`words`, `settings`, `reviewLogs`, `sessions`, `collections`) are retained.
- Added indexes are non-unique and do not rewrite or delete existing records.
- Missing scheduler branches are added from the legacy compatibility fields only where that branch is absent.
- JSON restore remains a merge by ID; it does not clear existing records.
- The 17-column CSV import format remains supported; new optional columns extend the template/export format.

**Migration caveat:** The migration path is implemented as an additive IndexedDB upgrade. It has been statically reviewed, but it has not been exercised against a real pre-existing user database in a browser profile in this environment. Keep a JSON backup before first launch of 3.7.0.

## Scheduling behavior

- Leitner and SM-2 remain independent nested schedules.
- Leitner: Again moves down one box, Hard holds, Good moves up one, Easy moves up two; intervals remain 1, 2, 4, 7 and 14 days by box.
- SM-2: Again resets repetitions; Hard, Good and Easy advance repetitions; Hard lowers ease, Easy increases ease.
- Schedule date calculations use local calendar dates at midday to avoid UTC-midnight date drift.
- Inactive words are not due.
- Mastery definitions remain the app's simplified definitions: Leitner box 5 or SM-2 interval of at least 14 days. This is a product heuristic, not a validated CEFR/retention measure.

## Security and reliability review

- User-provided text inserted into generated HTML is escaped at the render sites reviewed (`esc`).
- Dictionary links are restricted to HTTPS URLs.
- CSV output quotes cells and prefixes formula-like leading characters to reduce spreadsheet formula injection risk.
- IndexedDB transaction errors are surfaced rather than silently treating request success as commit success.
- External speech runtime and model downloads remain external dependencies; model licensing is documented in `VOICE-SOURCES.md`.
- No `.git`, `node_modules`, secrets file, or credential-bearing test fixture is required for the delivered app.

## Product and UX changes

- Existing page structure and review interaction are retained.
- Persian translation is optional and rendered right-to-left.
- CEFR level and tags are optional metadata; the app does not guess a level.
- Verb conjugation fields remain individually optional for all six persons.
- Progress calendar and CEFR distribution are based on persisted logs and user-supplied CEFR values.
- Streak definition is surfaced: five distinct reviewed words or a completed quiz.

## Not fully verified

- iOS Safari and installed iOS PWA behavior.
- Real OPFS quota/eviction behavior on low-storage iPhones.
- Real neural model download, checksum/source availability and playback on a device.
- Cold-start offline playback after an actual first online model installation.
- Browser-driven CRUD/import/export/migration flows against a populated pre-existing IndexedDB profile. Chromium was present, but the headless browser process timed out in this environment before producing a DOM dump; therefore no browser pass is claimed.
- Visual accessibility audit with screen reader, keyboard-only and color-contrast tooling.

See `TEST-REPORT.md` for the executed test results and `TEST-CHECKLIST.md` for device verification steps.
