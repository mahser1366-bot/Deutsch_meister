/* Small, dependency-free helpers shared by the Piper worker and its tests. */
(function attachPiperCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PiperCore = api;
})(typeof self !== 'undefined' ? self : globalThis, function createPiperCore() {
  'use strict';

  function parsePhonemizerOutput(output) {
    const source = String(output || '').trim();
    if (!source) throw new Error('The phonemizer returned no output.');
    let parsed;
    try { parsed = JSON.parse(source); }
    catch { throw new Error('The phonemizer returned invalid JSON.'); }
    if (!Array.isArray(parsed.phoneme_ids) || parsed.phoneme_ids.length === 0) {
      throw new Error('No phoneme IDs were produced by the phonemizer.');
    }
    const ids = parsed.phoneme_ids.map(value => {
      const id = Number(value);
      if (!Number.isSafeInteger(id) || id < 0) throw new Error('The phonemizer returned an invalid phoneme ID.');
      return id;
    });
    return ids;
  }

  function buildFeeds(ort, phonemeIds, config) {
    if (!ort?.Tensor) throw new Error('ONNX Runtime is not initialized.');
    if (!Array.isArray(phonemeIds) || !phonemeIds.length) throw new Error('No phoneme IDs are available for synthesis.');
    const symbolCount = Number(config?.num_symbols || 0);
    const input = new BigInt64Array(phonemeIds.length);
    for (let index = 0; index < phonemeIds.length; index++) {
      const id = Number(phonemeIds[index]);
      if (!Number.isSafeInteger(id) || id < 0 || (symbolCount > 0 && id >= symbolCount)) {
        throw new Error(`Phoneme ID ${id} is outside this voice model's supported range.`);
      }
      input[index] = BigInt(id);
    }
    const feeds = {
      input: new ort.Tensor('int64', input, [1, phonemeIds.length]),
      input_lengths: new ort.Tensor('int64', new BigInt64Array([BigInt(phonemeIds.length)]), [1]),
      scales: new ort.Tensor('float32', new Float32Array([
        Number(config?.inference?.noise_scale ?? 0.667),
        Number(config?.inference?.length_scale ?? 1),
        Number(config?.inference?.noise_w ?? 0.8)
      ]), [3])
    };
    if (Number(config?.num_speakers || 1) > 1) {
      feeds.sid = new ort.Tensor('int64', new BigInt64Array([0n]), [1]);
    }
    return feeds;
  }

  function pcmToWav(pcm, sampleRate) {
    if (!pcm || typeof pcm.length !== 'number' || !pcm.length) throw new Error('The neural voice returned empty audio.');
    const rate = Number(sampleRate);
    if (!Number.isFinite(rate) || rate < 8000 || rate > 96000) throw new Error('The voice model has an invalid audio sample rate.');
    const bytesPerSample = 2;
    const dataBytes = pcm.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);
    const writeText = (offset, value) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    writeText(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * bytesPerSample, true);
    view.setUint16(32, bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeText(36, 'data');
    view.setUint32(40, dataBytes, true);
    for (let i = 0; i < pcm.length; i++) {
      const sample = Math.max(-1, Math.min(1, Number(pcm[i]) || 0));
      view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
    }
    return buffer;
  }

  return Object.freeze({ parsePhonemizerOutput, buildFeeds, pcmToWav });
});
