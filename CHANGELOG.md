# Changelog

## 3.6.1 — Simplification and voice stability work

- Simplified Home, Practice, Library, Progress and Settings; removed extra Library filters, favourite controls and duplicate Home shortcuts.
- Kept the four main navigation destinations and the Settings shortcut.
- Kept exactly two voice choices per language: System/Jarvis for German and System/Amy for English.
- First-launch voice downloads run sequentially in the background; the system voice remains available during downloads.
- Kept voice weights out of the app bundle. Models are streamed into OPFS; runtime assets are cached by the service worker.
- Waited for the service worker to control the page before starting the virtual runtime-asset downloads, avoiding a first-launch cache race.
- Removed repeated runtime-asset draining before each inference; the Worker loads the required cached scripts and WASM assets when it initializes.
- Pinned ONNX Runtime Web 1.18.0's WASM-only bundle and one-thread execution, avoiding the newer default JSEP bundle implicated in Safari/WebKit memory reports.
- Kept inference in a dedicated Worker, reused the phonemizer and active-language session, and released the previous session when switching languages.
- Corrected model-cache handling: legacy Thorsten files are no longer relabelled as Jarvis. The old MLS/Thorsten/Amy cache is cleaned and the two selected models are downloaded from their configured sources.
- Added stronger voice-config and model-file checks, explicit ONNX tensor dimensions, phoneme-ID range validation and a bounded text length for neural inference.
- Added graceful system-voice fallback and release of audio/Worker resources when the app is backgrounded.
- Cached practice availability until the user's vocabulary changes and retained 100-word Library pagination.
- Preserved CSV/TSV import/export, all 17 columns, independent Leitner/SM-2 schedules, user-only vocabulary, individual deletion and CSV-batch deletion.

## Validation

- Automated Node suite: 42 tests pass.
- JavaScript syntax, HTML ID references, service-worker asset list, manifest, CSV template and ZIP integrity are checked before packaging.
- Mocked Worker tests do not prove that the real downloaded ONNX files synthesize correctly.
- No physical iPhone 16 / iOS 26 test has been performed; do not claim iPhone verification.

## 3.6.1
- Added neural voice diagnostics showing model initialisation, phonemisation, ONNX inference, audio decoding and playback stages, with a visible recent-event log and explicit failure message.
- Added bounded audio playback waits and an iOS AudioContext running-state check so a playback failure is reported instead of appearing to do nothing.
- Added controls to delete both downloaded neural voice models from this device and to opt out of automatic downloads. Vocabulary, learning progress and system voices are unaffected.
- Added an explicit action to download the neural voices again later.
- Kept the existing simplified learning interface and voice choices.


## 3.6.2
- Home now stays a clean overview until the user starts a review session.
- Review mode hides the overview and bottom navigation so the flashcard is presented as the primary full-screen task without scrolling past the dashboard. Added an explicit End review control.
- Rebuilt the review card as a 3D flip card: Show answer rotates to the reverse side. Rating an answer animates the card off-screen before the next card appears.
- Added subtle tactile press, hover, and elevation animations to buttons and interactive controls, with reduced-motion accessibility support.
- No changes to vocabulary storage, CSV import/export, scheduling algorithms, or neural voice implementation.

## 3.7.0 — Reliability, data model and progress (2026-11-06)

### Fixed
- Database requests now resolve only after the enclosing IndexedDB transaction completes; transaction failures reject the operation.
- Review schedule updates and review-log writes now commit atomically.
- SM-2 `Hard` ratings now advance the repetition count and subsequent interval.
- Missing schedule branches are persisted during startup without overwriting an existing algorithm's progress.
- Inactive entries are excluded from due-review calculations.
- Startup no longer deletes vocabulary records merely because their source is marked `builtin`.
- Backup metadata now reports the actual application release.

### Added
- IndexedDB v3 additive indexes for vocabulary headwords, review-log word IDs and session dates.
- Optional Persian translation, CEFR level, tags and a separate notes field.
- Monthly activity calendar, CEFR distribution and independent scheduler due counts.
- Expanded CSV schema with backwards-compatible import of the original 17-column files.
- Spreadsheet-formula neutralization on CSV export.
- Deterministic scheduling tests for hard-answer progression and date boundaries.

### Preserved
- Existing five pages, four bottom-navigation destinations, flashcard workflow, Leitner/SM-2 independence, six optional present-tense verb forms, voice options, service-worker shell cache, OPFS voice storage, import batches, JSON merge restore, and all prior vocabulary fields.
