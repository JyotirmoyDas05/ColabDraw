/** Frequency bands (0..1) of whatever is currently being heard or spoken, read by the visualizer. */
export const BAND_COUNT = 24;
export const voiceBands = new Float32Array(BAND_COUNT);

// human voice sits roughly between 100 Hz and 4 kHz
const VOICE_LOW_HZ = 100;
const VOICE_HIGH_HZ = 4000;
// bars rise fast and fall slowly, so they don't flicker
const FALL = 0.82;

const resetBands = () => voiceBands.fill(0);

/**
 * Samples an analyser every frame into `voiceBands` (and the overall loudness
 * into `onLevel`). Returns a function that stops it.
 */
export const startBandMeter = (
  analyser: AnalyserNode,
  onLevel?: (level: number) => void,
  isActive: () => boolean = () => true,
) => {
  const data = new Uint8Array(analyser.frequencyBinCount);
  const hzPerBin = analyser.context.sampleRate / analyser.fftSize;
  const firstBin = Math.max(1, Math.floor(VOICE_LOW_HZ / hzPerBin));
  const lastBin = Math.min(
    data.length - 1,
    Math.ceil(VOICE_HIGH_HZ / hzPerBin),
  );
  let frame = 0;
  const tick = () => {
    frame = requestAnimationFrame(tick);
    if (!isActive()) {
      return;
    }
    analyser.getByteFrequencyData(data);
    let total = 0;
    for (let band = 0; band < BAND_COUNT; band++) {
      // low bands span fewer bins than high ones, like hearing does
      const from =
        firstBin +
        Math.floor(Math.pow(band / BAND_COUNT, 1.6) * (lastBin - firstBin));
      const to = Math.max(
        from + 1,
        firstBin +
          Math.floor(
            Math.pow((band + 1) / BAND_COUNT, 1.6) * (lastBin - firstBin),
          ),
      );
      let sum = 0;
      for (let bin = from; bin < to; bin++) {
        sum += data[bin];
      }
      const value = Math.min(1, (sum / (to - from) / 255) * 1.7);
      voiceBands[band] = Math.max(value, voiceBands[band] * FALL);
      total += value;
    }
    onLevel?.(Math.min(1, (total / BAND_COUNT) * 1.6));
  };
  tick();
  return () => {
    cancelAnimationFrame(frame);
    resetBands();
    onLevel?.(0);
  };
};
