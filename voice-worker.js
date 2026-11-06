/*
 * Dedicated classic worker for offline Piper inference.
 *
 * Runtime: ONNX Runtime Web 1.18.0's WASM-only bundle (no WebGPU/JSEP).
 * Phonemizer: one persistent piper_phonemize Emscripten instance per worker.
 * Model policy: one ONNX model/session at a time; all work stays off the UI thread.
 */
importScripts('./piper-core.js');

const MODEL_CACHE_VERSION = 3;
const MODEL_DIRECTORY = 'deutsch-meister-voices';
const LEGACY_DIRECTORY = 'piper';
const RUNTIME_CACHE = 'deutsch-meister-voice-runtime-v1';
const ORT_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/';
const PHONEMIZER_BASE = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/';
const RUNTIME_FILES = [
  { name: 'ort.wasm.min.js', url: `${ORT_BASE}ort.wasm.min.js` },
  { name: 'ort-wasm-simd.wasm', url: `${ORT_BASE}ort-wasm-simd.wasm` },
  { name: 'ort-wasm.wasm', url: `${ORT_BASE}ort-wasm.wasm` },
  { name: 'piper_phonemize.js', url: `${PHONEMIZER_BASE}piper_phonemize.js` },
  { name: 'piper_phonemize.wasm', url: `${PHONEMIZER_BASE}piper_phonemize.wasm` },
  { name: 'piper_phonemize.data', url: `${PHONEMIZER_BASE}piper_phonemize.data` }
];
const MODELS = Object.freeze({
  jarvis: {
    id: 'de_DE-jarvis-medium',
    modelFile: 'jarvis-de-medium.onnx',
    configFile: 'jarvis-de-medium.onnx.json',
    modelUrl: 'https://huggingface.co/ufozone/piper-de_DE-jarvis-medium/resolve/main/model.onnx?download=true',
    configUrl: 'https://huggingface.co/ufozone/piper-de_DE-jarvis-medium/resolve/main/config.json?download=true'
  },
  amy: {
    id: 'en_US-amy-medium',
    modelFile: 'en_US-amy-medium.onnx',
    configFile: 'en_US-amy-medium.onnx.json',
    modelUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx?download=true',
    configUrl: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx.json?download=true'
  }
});

let workerQueue = Promise.resolve();
let runtimePromise = null;
let ortRuntime = null;
let phonemizerPromise = null;
let phonemizerModule = null;
let phonemizerOutput = '';
let phonemizerError = '';
let activeVoice = null;
let sessionPromise = null;

function runtimeUrl(fileName) {
  return new URL(`../runtime/${fileName}`, self.location.href).href;
}

function modelFor(key) {
  const model = MODELS[key];
  if (!model) throw new Error(`Unknown neural voice: ${key}`);
  return model;
}

async function modelDirectory(create = true) {
  if (!navigator.storage?.getDirectory) throw new Error('This browser does not support local voice-model storage.');
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(MODEL_DIRECTORY, { create });
}

async function optionalDirectory(name) {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(name, { create: false });
  } catch { return null; }
}

async function readFile(dir, name) {
  try {
    const handle = await dir.getFileHandle(name);
    return await handle.getFile();
  } catch { return null; }
}

function isValidVoiceConfig(config) {
  return !!(
    config && config.phoneme_type === 'espeak' &&
    typeof config.espeak?.voice === 'string' && config.espeak.voice.length > 0 &&
    Number(config.audio?.sample_rate) > 0 && Number(config.num_symbols) > 0 &&
    config.phoneme_id_map && typeof config.phoneme_id_map === 'object' &&
    config.inference && Number.isFinite(Number(config.inference.noise_scale)) &&
    Number.isFinite(Number(config.inference.length_scale)) &&
    Number.isFinite(Number(config.inference.noise_w))
  );
}

async function isModelComplete(key) {
  const model = modelFor(key);
  try {
    const dir = await modelDirectory(false);
    const [modelFile, configFile, markerFile] = await Promise.all([
      readFile(dir, model.modelFile), readFile(dir, model.configFile), readFile(dir, `${model.modelFile}.complete`)
    ]);
    if (!modelFile || modelFile.size < 1_000_000 || !configFile || configFile.size < 100 || configFile.size > 100_000 || !markerFile?.size) return false;
    const marker = JSON.parse(await markerFile.text());
    if (marker.version !== MODEL_CACHE_VERSION || marker.modelBytes !== modelFile.size || marker.configBytes !== configFile.size) return false;
    return isValidVoiceConfig(JSON.parse(await configFile.text()));
  } catch { return false; }
}

async function writeMarker(dir, model) {
  const modelFile = await readFile(dir, model.modelFile);
  const configFile = await readFile(dir, model.configFile);
  if (!modelFile?.size || !configFile?.size) throw new Error('The downloaded model files are incomplete.');
  const markerHandle = await dir.getFileHandle(`${model.modelFile}.complete`, { create: true });
  const writer = await markerHandle.createWritable();
  await writer.write(JSON.stringify({ version: MODEL_CACHE_VERSION, modelBytes: modelFile.size, configBytes: configFile.size, completedAt: new Date().toISOString() }));
  await writer.close();
}

async function cleanupLegacyVoiceCache() {
  // Old releases stored MLS/Thorsten/Amy files in an OPFS directory named "piper".
  // Never relabel a Thorsten model as Jarvis: the two voices are not interchangeable.
  const oldDir = await optionalDirectory(LEGACY_DIRECTORY);
  if (!oldDir) return;
  const oldFiles = [
    'de_DE-mls-medium.onnx', 'de_DE-mls-medium.onnx.json', 'de_DE-mls-medium.onnx.complete',
    'de_DE-thorsten-medium.onnx', 'de_DE-thorsten-medium.onnx.json', 'de_DE-thorsten-medium.onnx.complete',
    'en_US-amy-medium.onnx', 'en_US-amy-medium.onnx.json', 'en_US-amy-medium.onnx.complete'
  ];
  for (const name of oldFiles) {
    try { await oldDir.removeEntry(name); } catch { /* absent */ }
  }
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(LEGACY_DIRECTORY);
  } catch { /* keep an empty or unrelated directory rather than failing startup */ }
}

async function status() {
  await cleanupLegacyVoiceCache();
  const complete = {};
  const stored = [];
  for (const key of Object.keys(MODELS)) {
    complete[key] = await isModelComplete(key);
    if (complete[key]) stored.push(MODELS[key].id);
  }
  return { complete, stored };
}

async function drainResponse(response, fileName, sendProgress) {
  if (!response.ok) throw new Error(`Voice runtime download failed (${response.status}) for ${fileName}.`);
  const total = Number(response.headers.get('content-length') || 0);
  let loaded = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      sendProgress?.({ type: 'progress', progress: { fileName, loaded, total } });
    }
  } else {
    const buffer = await response.arrayBuffer();
    loaded = buffer.byteLength;
    sendProgress?.({ type: 'progress', progress: { fileName, loaded, total: total || loaded } });
  }
  if (!loaded) throw new Error(`The downloaded runtime file ${fileName} is empty.`);
}

async function prepareRuntimeAssets(sendProgress = () => {}) {
  let cache = null;
  try { if (self.caches) cache = await self.caches.open(RUNTIME_CACHE); } catch { /* the service worker still serves cached runtime URLs */ }
  for (const asset of RUNTIME_FILES) {
    const url = runtimeUrl(asset.name);
    if (cache) {
      try { const cached = await cache.match(url); if (cached?.ok) continue; } catch { /* verify by fetching below */ }
    }
    const response = await fetch(url, { cache: 'no-store' });
    await drainResponse(response, asset.name, sendProgress);
  }
  return true;
}

async function fetchIntoOPFS(url, fileName, sendProgress) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Voice download failed (${response.status}) for ${fileName}.`);
  const total = Number(response.headers.get('content-length') || 0);
  if (total && navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      const quota = Number(estimate.quota || 0);
      const usage = Number(estimate.usage || 0);
      const free = quota > 0 ? Math.max(0, quota - usage) : 0;
      if (free > 0 && free < total + 8 * 1024 * 1024) {
        try { await response.body?.cancel(); } catch { /* ignore */ }
        throw new Error(`There is not enough free device storage for ${fileName}.`);
      }
    } catch (error) {
      if (String(error?.message || error).includes('not enough free device storage')) throw error;
    }
  }
  const dir = await modelDirectory(true);
  const handle = await dir.getFileHandle(fileName, { create: true });
  const writer = await handle.createWritable();
  let loaded = 0;
  try {
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
        loaded += value.byteLength;
        sendProgress?.({ type: 'progress', progress: { fileName, loaded, total } });
      }
    } else {
      const blob = await response.blob();
      await writer.write(blob);
      loaded = blob.size;
      sendProgress?.({ type: 'progress', progress: { fileName, loaded, total: total || loaded } });
    }
    await writer.close();
  } catch (error) {
    try { await writer.abort(); } catch { /* ignore */ }
    throw error;
  }
  if (!loaded) throw new Error(`The downloaded model file ${fileName} is empty.`);
  const encoding = response.headers.get('content-encoding');
  if (total && (!encoding || encoding === 'identity') && loaded !== total) throw new Error(`The download of ${fileName} was incomplete (${loaded} of ${total} bytes).`);
  return loaded;
}

async function downloadModel(key, sendProgress) {
  const model = modelFor(key);
  if (await isModelComplete(key)) return;
  const dir = await modelDirectory(true);
  const modelBytes = await fetchIntoOPFS(model.modelUrl, model.modelFile, sendProgress);
  if (modelBytes < 1_000_000) throw new Error(`${key} model download is unexpectedly small (${modelBytes} bytes).`);
  const configBytes = await fetchIntoOPFS(model.configUrl, model.configFile, sendProgress);
  if (configBytes < 100 || configBytes > 100_000) throw new Error(`${key} configuration download has an unexpected size.`);
  const configFile = await readFile(dir, model.configFile);
  const config = JSON.parse(await configFile.text());
  if (!isValidVoiceConfig(config)) {
    throw new Error(`${key} configuration file is not a valid Piper voice configuration.`);
  }
  await writeMarker(dir, model);
  if (!(await isModelComplete(key))) throw new Error(`${key} voice could not be verified in local storage.`);
}

async function loadRuntimeScript(fileName) {
  const url = runtimeUrl(fileName);
  try { importScripts(url); }
  catch (error) { throw new Error(`Could not load cached voice runtime ${fileName}: ${error?.message || error}`); }
}

async function getRuntime() {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    if (!self.PiperCore) throw new Error('The Piper audio helper did not load.');
    if (!self.ort?.InferenceSession) {
      await loadRuntimeScript('ort.wasm.min.js');
    }
    if (!self.ort?.InferenceSession) throw new Error('The CPU-only ONNX Runtime did not initialize.');
    if (!self.createPiperPhonemize) {
      await loadRuntimeScript('piper_phonemize.js');
    }
    if (typeof self.createPiperPhonemize !== 'function') throw new Error('The Piper phonemizer did not initialize.');
    // Single-threaded WASM avoids SharedArrayBuffer/cross-origin-isolation requirements.
    self.ort.env.wasm.numThreads = 1;
    self.ort.env.wasm.wasmPaths = runtimeUrl('');
    ortRuntime = self.ort;
    return ortRuntime;
  })().catch(error => {
    runtimePromise = null;
    throw error;
  });
  return runtimePromise;
}

async function getPhonemizer() {
  if (!phonemizerPromise) {
    await getRuntime();
    phonemizerPromise = self.createPiperPhonemize({
      print: line => {
        const value = String(line || '').trim();
        if (value.startsWith('{') && value.includes('phoneme_ids')) phonemizerOutput = value;
      },
      printErr: message => { phonemizerError = String(message || 'Phonemizer error.'); },
      locateFile: fileName => {
        if (String(fileName).endsWith('.wasm')) return runtimeUrl('piper_phonemize.wasm');
        if (String(fileName).endsWith('.data')) return runtimeUrl('piper_phonemize.data');
        return runtimeUrl(fileName);
      }
    }).then(module => {
      phonemizerModule = module;
      return module;
    }).catch(error => {
      phonemizerPromise = null;
      throw error;
    });
  }
  return phonemizerPromise;
}

async function phonemize(text, language) {
  const module = await getPhonemizer();
  phonemizerOutput = '';
  phonemizerError = '';
  const input = JSON.stringify([{ text: String(text || '').trim() }]);
  try {
    module.callMain(['-l', language, '--input', input, '--espeak_data', '/espeak-ng-data']);
  } catch (error) {
    throw new Error(`German/English phonemization failed: ${error?.message || error}`);
  }
  if (!phonemizerOutput) throw new Error(phonemizerError || 'The phonemizer produced no speech sounds.');
  return self.PiperCore.parsePhonemizerOutput(phonemizerOutput);
}

async function loadVoiceConfig(key) {
  const model = modelFor(key);
  const dir = await modelDirectory(false);
  const file = await readFile(dir, model.configFile);
  if (!file?.size) throw new Error(`${key} voice configuration is missing. Download the voice again.`);
  const config = JSON.parse(await file.text());
  if (!isValidVoiceConfig(config)) {
    throw new Error(`${key} voice configuration is incomplete.`);
  }
  return config;
}

async function createVoiceSession(key) {
  if (!(await isModelComplete(key))) throw new Error(`${key} is not fully downloaded yet.`);
  const runtime = await getRuntime();
  const model = modelFor(key);
  const config = await loadVoiceConfig(key);
  const dir = await modelDirectory(false);
  const modelFile = await readFile(dir, model.modelFile);
  if (!modelFile?.size) throw new Error(`${key} model file is missing. Download the voice again.`);
  const session = await runtime.InferenceSession.create(await modelFile.arrayBuffer(), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'basic',
    executionMode: 'sequential'
  });
  return { key, config, session };
}

async function ensureSession(key) {
  if (activeVoice === key && sessionPromise) return sessionPromise;
  if (sessionPromise) {
    try {
      const previous = await sessionPromise;
      await previous.session.release?.();
    } catch { /* the failed session has no resources to release */ }
  }
  activeVoice = key;
  sessionPromise = createVoiceSession(key).catch(error => {
    activeVoice = null;
    sessionPromise = null;
    throw error;
  });
  return sessionPromise;
}

async function synthesize(key, text, reportStage = () => {}) {
  modelFor(key);
  reportStage('Checking model storage');
  const sourceText = String(text || '').trim();
  if (!sourceText) throw new Error('There is no text to pronounce.');
  if (sourceText.length > 600) throw new Error('This neural voice supports up to 600 characters per request.');
  reportStage('Initialising ONNX model');
  const active = await ensureSession(key);
  reportStage('Phonemising text');
  const ids = await phonemize(sourceText, active.config.espeak.voice);
  reportStage('Generating speech with ONNX');
  const feeds = self.PiperCore.buildFeeds(ortRuntime, ids, active.config);
  const output = await active.session.run(feeds);
  const outputTensor = output?.output || Object.values(output || {})[0];
  const pcm = outputTensor?.data;
  const wav = self.PiperCore.pcmToWav(pcm, active.config.audio.sample_rate);
  reportStage('Speech generated');
  return wav;
}

async function handleWorkerMessage(data) {
  const { requestId, action, voice, text } = data || {};
  if (!requestId) return;
  const send = (payload, transfer = []) => self.postMessage({ requestId, ...payload }, transfer);
  try {
    if (action === 'status') {
      send({ type: 'result', ...(await status()) });
      return;
    }
    if (action === 'runtime') {
      await prepareRuntimeAssets(value => send(value));
      send({ type: 'result', ready: true });
      return;
    }
    if (action === 'download') {
      await downloadModel(voice, value => send(value));
      const state = await status();
      send({ type: 'result', ...state });
      return;
    }
    if (action === 'delete') {
      const model = modelFor(voice);
      const dir = await optionalDirectory(MODEL_DIRECTORY);
      if (dir) {
        for (const name of [model.modelFile, model.configFile, `${model.modelFile}.complete`]) {
          try { await dir.removeEntry(name); } catch { /* already absent */ }
        }
        try { const root = await navigator.storage.getDirectory(); const check = await root.getDirectoryHandle(MODEL_DIRECTORY); let any = false; for await (const _ of check.values()) { any = true; break; } if (!any) await root.removeEntry(MODEL_DIRECTORY); } catch { /* leave empty directory */ }
      }
      send({ type: 'result', ...(await status()) });
      return;
    }
    if (action === 'speak') {
      const buffer = await synthesize(voice, text, stage => send({ type: 'stage', stage }));
      send({ type: 'audio', buffer }, [buffer]);
      return;
    }
    throw new Error(`Unsupported voice worker action: ${action}`);
  } catch (error) {
    send({ type: 'error', error: error?.message || String(error) });
  }
}

self.addEventListener('message', event => {
  const data = event.data;
  workerQueue = workerQueue.then(() => handleWorkerMessage(data)).catch(error => {
    if (data?.requestId) self.postMessage({ requestId: data.requestId, type: 'error', error: error?.message || String(error) });
  });
});
