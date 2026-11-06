// Main-thread voice coordinator. Heavy model work runs in voice-worker.js.
const MODEL_IDS = Object.freeze({ jarvis: 'de_DE-jarvis-medium', amy: 'en_US-amy-medium' });
let requestSequence = 0;
let speechWorker = null;
let speechLanguage = null;
let audioContext = null;
let activeSource = null;
let activeAudio = null;
let activeAudioCancel = null;
let speechSequence = 0;

class VoiceWorkerClient {
  constructor() {
    this.worker = new Worker(new URL('./voice-worker.js', import.meta.url));
    this.pending = new Map();
    this.worker.addEventListener('message', event => this.onMessage(event.data));
    this.worker.addEventListener('error', event => this.failAll(new Error(event.message || 'Neural voice worker failed.')));
    this.worker.addEventListener('messageerror', () => this.failAll(new Error('Could not read the neural voice worker response.')));
  }
  onMessage(message) {
    const item = this.pending.get(message.requestId);
    if (!item) return;
    if (message.type === 'progress') { item.onProgress?.(message.progress || {}); return; }
    if (message.type === 'stage') { item.onProgress?.({ stage: message.stage }); return; }
    if (message.type === 'log') return;
    if (message.type !== 'error' && message.type !== 'result' && message.type !== 'audio') return;
    this.pending.delete(message.requestId);
    if (item.timer) clearTimeout(item.timer);
    if (message.type === 'error') item.reject(new Error(message.error || 'Neural voice operation failed.'));
    else item.resolve(message);
  }
  request(action, payload = {}, onProgress) {
    const requestId = ++requestSequence;
    return new Promise((resolve, reject) => {
      const timeoutMs = action === 'speak' ? 45000 : action === 'runtime' ? 240000 : action === 'download' ? 600000 : 30000;
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(action === 'speak' ? 'Neural speech timed out. Switching to the system voice.' : `Voice ${action} timed out.`));
        this.terminate();
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, onProgress, timer });
      try { this.worker.postMessage({ requestId, action, ...payload }); }
      catch (error) { clearTimeout(timer); this.pending.delete(requestId); reject(error); }
    });
  }
  failAll(error) {
    for (const item of this.pending.values()) { if (item.timer) clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
  }
  terminate() {
    this.failAll(new Error('Neural voice worker was stopped.'));
    this.worker.terminate();
  }
}

function createWorker() { return new VoiceWorkerClient(); }

export async function prepareVoiceModels(onProgress = () => {}, allowDownload = navigator.onLine) {
  const client = createWorker();
  const stored = new Set();
  const errors = [];
  const pending = [];
  let runtimeError = null;
  try {
    const initial = await client.request('status');
    for (const id of initial.stored || []) stored.add(id);
    if (allowDownload && navigator.onLine) {
      try {
        onProgress({ voice: 'runtime', state: 'starting', loaded: 0, total: 0 });
        await client.request('runtime', {}, progress => onProgress({ voice: 'runtime', state: 'downloading', ...progress }));
        onProgress({ voice: 'runtime', state: 'ready', loaded: 1, total: 1 });
      } catch (error) {
        runtimeError = error?.message || String(error);
        onProgress({ voice: 'runtime', state: 'error', error: runtimeError });
        return { stored: [...stored], errors, pending, runtimeError };
      }
    } else if (Object.values(initial.complete || {}).some(Boolean)) {
      // Existing models stay usable offline only if their runtime files were cached earlier.
      try { await client.request('runtime'); }
      catch (error) { runtimeError = error?.message || String(error); }
    }
    for (const voice of ['jarvis', 'amy']) {
      const id = MODEL_IDS[voice];
      if (initial.complete?.[voice] === true) {
        onProgress({ voice, state: 'ready', loaded: 1, total: 1 });
        continue;
      }
      if (!allowDownload || !navigator.onLine) {
        pending.push(voice);
        onProgress({ voice, state: 'pending' });
        continue;
      }
      try {
        onProgress({ voice, state: 'starting', loaded: 0, total: 0 });
        const reportProgress = progress => onProgress({ voice, state: 'downloading', ...progress });
        let result;
        try {
          result = await client.request('download', { voice }, reportProgress);
        } catch (firstError) {
          const message = String(firstError?.message || firstError);
          const transient = /Failed to fetch|NetworkError|download failed \((?:429|5\d\d)\)/i.test(message);
          if (!allowDownload || !navigator.onLine || !transient) throw firstError;
          onProgress({ voice, state: 'retrying' });
          await new Promise(resolve => setTimeout(resolve, 1200));
          result = await client.request('download', { voice }, reportProgress);
        }
        for (const saved of result.stored || []) stored.add(saved);
        if (result.complete?.[voice] !== true || !stored.has(id)) throw new Error('The model download could not be verified.');
        onProgress({ voice, state: 'ready', loaded: 1, total: 1 });
      } catch (error) {
        errors.push({ voice, error: error?.message || String(error) });
        onProgress({ voice, state: 'error', error: error?.message || String(error) });
      }
    }
    return { stored: [...stored], errors, pending, runtimeError };
  } finally {
    client.terminate();
  }
}

function getSpeechWorker(language) {
  if (speechWorker && speechLanguage !== language) {
    speechWorker.terminate();
    speechWorker = null;
  }
  if (!speechWorker) {
    speechWorker = createWorker();
    speechLanguage = language;
  }
  return speechWorker;
}

function stopCurrentAudio() {
  if (activeSource) { try { activeSource.stop(); } catch { /* already ended */ } activeSource = null; }
  if (activeAudio) { activeAudio.pause(); activeAudioCancel?.(); activeAudio = null; activeAudioCancel = null; }
}

function getAudioContext() {
  if (!audioContext || audioContext.state === 'closed') {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (AudioContextClass) audioContext = new AudioContextClass();
  }
  return audioContext;
}

export async function speakNeural(voice, text, rate = 0.88, onStage = () => {}) {
  // Resume the audio context synchronously from the user's tap, before awaiting inference.
  const token = ++speechSequence;
  stopCurrentAudio();
  const context = getAudioContext();
  const resume = context && context.state === 'suspended' ? context.resume() : Promise.resolve();
  const language = voice === 'jarvis' ? 'de' : 'en';
  const client = getSpeechWorker(language);
  let result;
  onStage('Starting neural worker');
  try { result = await client.request('speak', { voice, text: String(text || '') }, progress => { if (progress.stage) onStage(progress.stage); }); }
  catch (error) { if (token !== speechSequence) return; throw error; }
  if (token !== speechSequence) return;
  onStage('Preparing audio playback');
  if (!context) {
    const blob = new Blob([result.buffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    activeAudio = audio;
    audio.playbackRate = Math.max(0.65, Math.min(1.25, Number(rate) || 0.88));
    try {
      const finished = new Promise((resolve, reject) => {
        activeAudioCancel = resolve;
        audio.addEventListener('ended', resolve, { once: true });
        audio.addEventListener('error', () => reject(new Error('Audio playback failed.')), { once: true });
      });
      const playbackTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Audio playback did not finish within 30 seconds.')), 30000));
      await audio.play();
      onStage('Playing neural audio');
      await Promise.race([finished, playbackTimeout]);
    } finally { if (activeAudio === audio) activeAudio = null; activeAudioCancel = null; URL.revokeObjectURL(url); }
    return;
  }
  await resume;
  if (context.state !== 'running') throw new Error(`iOS audio context is ${context.state}; playback could not start.`);
  if (token !== speechSequence) return;
  if (activeSource) {
    try { activeSource.stop(); } catch { /* already ended */ }
    activeSource = null;
  }
  onStage('Decoding generated audio');
  const audioBuffer = await context.decodeAudioData(result.buffer.slice(0));
  if (token !== speechSequence) return;
  const source = context.createBufferSource();
  source.buffer = audioBuffer;
  source.playbackRate.value = Math.max(0.65, Math.min(1.25, Number(rate) || 0.88));
  source.connect(context.destination);
  activeSource = source;
  onStage('Playing neural audio');
  await Promise.race([new Promise((resolve, reject) => {
    source.onended = () => {
      source.buffer = null;
      if (activeSource === source) activeSource = null;
      resolve();
    };
    try { source.start(0); } catch (error) { reject(error); }
  }), new Promise((_, reject) => setTimeout(() => reject(new Error('Neural audio playback timed out after 30 seconds.')), 30000))]);
}

export async function deleteNeuralVoice(voice) {
  if (!MODEL_IDS[voice]) throw new Error('Unknown neural voice.');
  if (speechWorker) { speechWorker.terminate(); speechWorker = null; speechLanguage = null; }
  const client = createWorker();
  try { return await client.request('delete', { voice }); }
  finally { client.terminate(); }
}

export function stopNeuralSpeech() {
  speechSequence++;
  stopCurrentAudio();
}

export function terminateNeuralWorker() {
  stopNeuralSpeech();
  speechWorker?.terminate();
  speechWorker = null;
  speechLanguage = null;
  if (audioContext && audioContext.state !== 'closed') audioContext.close().catch(() => {});
  audioContext = null;
}

export const neuralVoiceModelIds = MODEL_IDS;
