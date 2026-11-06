# Voice sources, attribution and runtime

Deutsch Meister exposes exactly two choices for each language:

| Language | System option | Neural option | Runtime key |
|---|---|---|---|
| German | Browser/device system voice | Jarvis · Medium | `de_DE-jarvis-medium` |
| English | Browser/device system voice | Amy · Medium | `en_US-amy-medium` |

## German — Jarvis

- Selected PiperHub page: https://piperhub.org/model/jarvis-german-de-medium/
- Model repository: https://huggingface.co/ufozone/piper-de_DE-jarvis-medium
- Files: `model.onnx` and `config.json`.
- ONNX size: approximately 63.1 MB.
- Author/repository: ufozone.
- Licence: **CC BY-NC-SA 4.0**. Commercial use is not permitted. Attribution and ShareAlike conditions apply if adapted material is shared.
- Runtime stores the files as `jarvis-de-medium.onnx` and `jarvis-de-medium.onnx.json` in OPFS.

## English — Amy

- Selected PiperHub page: https://piperhub.org/model/amy-english-en-medium/
- Runtime model repository: https://huggingface.co/rhasspy/piper-voices/tree/v1.0.0/en/en_US/amy/medium
- Files: `en_US-amy-medium.onnx` and `en_US-amy-medium.onnx.json` (pinned to the Piper `v1.0.0` model release).
- ONNX size: approximately 63.2 MB.
- The model card identifies the MycroftAI Mimic 3 voice dataset as its source. The dataset repository publishes a CC BY-SA 4.0 licence: https://github.com/MycroftAI/mimic3-voices/blob/master/LICENSE.
- Runtime stores the files as `amy-en-medium.onnx` and `amy-en-medium.onnx.json` in OPFS.

## Runtime implementation

- ONNX Runtime Web: 1.18.0, `ort.wasm.min.js` (WASM-only bundle).
- WASM execution provider: `wasm`, one thread.
- Runtime assets: `ort.wasm.min.js`, `ort-wasm-simd.wasm`, `ort-wasm.wasm`, and the three `@diffusionstudio/piper-wasm@1.0.0` phonemizer assets.
- Phonemizer: `@diffusionstudio/piper-wasm@1.0.0`, using the model's `espeak.voice` configuration.
- Inference is isolated in `js/voice-worker.js`. One voice model/session is active at a time. Repeated utterances in the same language reuse the session; changing languages terminates the previous worker.
- Model files are downloaded sequentially on first launch and streamed into OPFS. Runtime assets are cached by the service worker. Neither model is bundled in the app ZIP.
- Old MLS/Thorsten model files in the legacy `piper` OPFS directory are removed. Old Thorsten files are never treated as Jarvis.

## Important limitations

- Jarvis's CC BY-NC-SA 4.0 licence excludes commercial use. Check the licences again before commercial distribution or a change in model source.
- The Amy source's dataset attribution and ShareAlike terms must be retained.
- The app's automated tests use a mocked ONNX runtime and mocked model bytes. They verify the worker pipeline and data handling, not the acoustic quality or compatibility of the actual downloaded models.
- No physical iPhone 16 / iOS 26 test has been performed. Real-device testing is required before claiming iOS compatibility.
