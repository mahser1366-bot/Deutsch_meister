# Deutsch Meister 3.7.0

Deutsch Meister is an offline-first German vocabulary learning PWA. Vocabulary is learner-owned: there is no bundled or fabricated word list. Add entries manually or import CSV/TSV files.

## What's new in 3.7.0

- Upgrades the existing IndexedDB database from schema version 2 to 3 without deleting object stores or records. Adds non-unique indexes for German headwords, review-log word IDs, and session dates.
- Makes review scheduling and review-history insertion one atomic IndexedDB transaction.
- Waits for transaction completion before resolving ordinary database operations and surfaces transaction failures.
- Repairs missing Leitner/SM-2 schedule branches during startup while preserving existing schedule values.
- Fixes SM-2 `Hard` answers so successful repetitions advance rather than remaining permanently at the first interval.
- Makes scheduling date calculations deterministic against the supplied local calendar date and handles month/year boundaries.
- Keeps inactive words out of due-review counts.
- Preserves existing vocabulary records regardless of their `source` marker.
- Adds optional Persian translation, CEFR level (A1–C2), tags, and a distinct notes field. All six present-tense verb forms remain optional.
- Extends CSV import/export with the additional fields while accepting the older 17-column template. CSV export neutralizes spreadsheet formula prefixes.
- Adds a monthly activity calendar, CEFR distribution, and separate Leitner/SM-2 due counts based on stored records.
- Corrects the backup metadata version and aligns the visible app version, package version, service-worker cache, and `VERSION.txt`.

## Run locally

Requirements: Node.js 20+ for tests; a modern browser for the PWA.

1. Extract the ZIP archive.
2. Open a terminal in the extracted project folder.
3. Start a local web server:

   ```bash
   python3 -m http.server 8000
   ```

4. Open `http://localhost:8000` in your browser.

Do not open `index.html` as a `file://` URL. Service workers, IndexedDB and OPFS require a secure context; `localhost` qualifies.

## Tests and checks

```bash
npm test
npm run check
```

The tests use Node's built-in test runner and do not require `node_modules` or a build step. See [TEST-REPORT.md](TEST-REPORT.md) and [TEST-CHECKLIST.md](TEST-CHECKLIST.md).

## Data safety and backups

- The application stores vocabulary, settings, schedules, sessions, and review history locally in IndexedDB under `deutsch-meister-db`.
- Version 3 is an additive schema migration. It does not clear stores or recreate the database.
- JSON restore merges records by ID; unmatched existing records are retained. It does not perform a destructive replace.
- Export a JSON backup periodically, especially before clearing browser storage or changing devices.
- Browser storage can still be evicted by the browser or removed by the user. The app cannot recover data after browser storage is deleted unless a backup exists.

## Offline and speech

- The app shell is cached by the service worker.
- Vocabulary and learning data remain local in IndexedDB.
- The Jarvis German and Amy English neural voices are downloaded from their documented upstream sources and stored in OPFS; the runtime files are cached separately.
- System SpeechSynthesis remains the fallback when neural speech is unavailable or fails.
- The ONNX models are not bundled in this ZIP. First download requires a network connection and enough storage. Voice source and licensing details are in [VOICE-SOURCES.md](VOICE-SOURCES.md).

## Compatibility notes

- Existing 17-column CSV files remain importable. The expanded template adds `translation_fa`, `level`, `tags`, and `notes`.
- Persian translations, CEFR levels, and tags are optional. Empty verb conjugations are accepted.
- The monthly calendar and CEFR distribution display only data present in the local database. Entries without a CEFR level are counted separately.
- The streak definition is explicit: a day qualifies after five distinct word reviews or a completed quiz.

## Known limitations

- This release has not been physically tested on iPhone Safari/iOS. PWA installation, OPFS quota behavior, long-running neural playback, and cold-start offline voice playback require a real-device check.
- Neural model downloads and synthesis depend on upstream CDN/model availability and browser storage permissions.
- Automated tests cover pure scheduling, CSV parsing/escaping, vocabulary UI structure, challenge generation, and voice-worker behavior with mocks. They do not replace end-to-end tests against a real browser IndexedDB implementation or real ONNX model files.
- CEFR values are user-entered/imported metadata; the app does not automatically classify or validate vocabulary levels.
