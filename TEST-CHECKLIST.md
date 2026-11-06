# Deutsch Meister release validation checklist

## Automated checks

- [x] CSV/TSV parsing, UTF-8 BOM, German umlauts, quoted commas and escaped quotes.
- [x] `german` is the only required CSV field; all other fields remain optional.
- [x] The exact 17-column import/export schema.
- [x] Independent Leitner and SM-2 scheduling.
- [x] Plural distractors come from transformations of the same singular noun and are skipped when safe options are unavailable.
- [x] Verb practice uses only imported, populated verb forms.
- [x] Five app pages and four bottom navigation items.
- [x] Simplified Library with search, edit, individual deletion, CSV import and batch deletion.
- [x] Practice availability is derived from the user's imported data.
- [x] German voice selector contains only System/Jarvis; English contains only System/Amy.
- [x] Worker code uses ONNX Runtime Web 1.18.0 WASM-only and one thread.
- [x] Mocked Worker downloads, OPFS completion markers, session reuse and language switching.
- [x] Legacy MLS/Thorsten cache cleanup; no Thorsten-to-Jarvis relabelling.
- [x] JavaScript syntax, HTML IDs, service-worker core files, manifest JSON and ZIP integrity.

## Still requires real browser/device validation

- [ ] Desktop Chrome/Firefox: first-launch runtime/model downloads complete and models appear in OPFS.
- [ ] Desktop: actual Jarvis and Amy models synthesize a word and a full sentence.
- [ ] Desktop: repeated utterances reuse the same session and do not cause growing memory use.
- [ ] Desktop: switching languages releases the previous session and plays the new voice.
- [ ] iPhone 16 / iOS 26 Safari: app remains responsive during the sequential background downloads.
- [ ] iPhone: Jarvis plays German words and full sentences with umlauts.
- [ ] iPhone: Amy plays English words and full sentences.
- [ ] iPhone: a neural failure immediately falls back to the system voice.
- [ ] iPhone: reload while offline; vocabulary and progress remain available.
- [ ] iPhone: cold-start offline neural playback after runtime assets have been cached.
- [ ] iPhone: interrupted download recovery and storage quota/eviction behaviour.

The real-model and physical-device items above are not covered by the mocked automated tests. Do not describe this release as iPhone-verified until they pass.

## Legacy V3.6.1 validation items
- [x] JavaScript syntax checks for app, voice manager and worker.
- [x] Existing automated suite remains green after adding diagnostic stages and model deletion action.
- [ ] On iPhone: select Jarvis/Amy, inspect Neural voice diagnostics and report the last successful stage plus any failure text.
- [ ] On iPhone: delete downloaded voices, confirm System remains selected, reload and confirm models are not downloaded again.
- [ ] On iPhone: tap Download voices again and confirm downloads resume.
- [ ] On iPhone: confirm neural audio playback completes after inference.


## V3.6.2 UI validation items
- Home dashboard is visible before starting review; flashcards are not shown underneath the overview.
- Start review enters focused review mode and hides the dashboard and bottom navigation.
- Show answer performs a 3D card flip.
- Rating a card animates it off-screen before advancing.
- End review returns to the dashboard.
- Buttons and interactive controls have tactile press/hover states; reduced-motion preferences are respected.
- Automated test suite: 45 tests passed. Real-device visual testing is still recommended, especially on iPhone Safari.

## 3.7.0 release verification additions

### Database upgrade and preservation
- [ ] On a browser profile containing a real 3.6.2 database, export a JSON backup before opening 3.7.0.
- [ ] Open 3.7.0 and confirm the IndexedDB database version becomes 3.
- [ ] Confirm all existing word IDs, optional fields, both schedule branches, review logs, settings, and sessions remain present.
- [ ] Confirm no vocabulary entry is removed because of its `source` property.
- [ ] Close/reopen the app and confirm no repeated migration or duplicate history rows appear.

### New vocabulary metadata and CSV
- [ ] Create and edit a word with Persian translation, CEFR level, tags and notes.
- [ ] Create a verb with only `ich` and `sie/Sie` populated; save it successfully.
- [ ] Import the original 17-column CSV fixture and confirm all fields are preserved.
- [ ] Import the expanded template and confirm optional Persian/CEFR/tags/notes fields are populated.
- [ ] Export CSV containing text beginning with `=`, `+`, `-` or `@` and confirm the spreadsheet-safe apostrophe prefix is present.
- [ ] Export JSON, restore into a second test profile, and compare words, schedules, settings and review logs.

### Progress and scheduling
- [ ] Review a word with each Leitner rating and verify the corresponding box movement and due date.
- [ ] Repeat SM-2 Hard ratings and verify repetitions advance.
- [ ] Verify review event and word schedule are both persisted after a review.
- [ ] Check the month calendar around month/year boundaries and confirm only stored events are highlighted.
- [ ] Confirm CEFR totals match the vocabulary entries, including unclassified words.
- [ ] Confirm Leitner and SM-2 due counts are independent.

### iPhone / offline / voice
- [ ] Install the PWA from Safari on iPhone.
- [ ] Verify navigation, card flip, answer buttons, forms, and keyboard behavior at mobile widths.
- [ ] Complete initial neural voice download on Wi-Fi; verify OPFS model storage.
- [ ] Relaunch offline and test app shell, IndexedDB vocabulary, system voice and neural voice playback.
- [ ] Test low-storage and denied-storage behavior; ensure the app remains usable with system voice fallback.
