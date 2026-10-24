import { MAX_DELAY_MS, clamp } from "./constants.js?v=20260606-live-mic-sync";

const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
const CALIBRATION_TRIALS = 5;
const MIN_VALID_TRIALS = 3;
const MAX_LATENCY_SPREAD_MS = 18;
const LIVE_SYNC_SAMPLE_MS = 40;
const LIVE_SYNC_INTERVAL_MS = 2400;
const LIVE_SYNC_HISTORY_SIZE = 150;
const LIVE_SYNC_MIN_SAMPLES = 68;
const LIVE_SYNC_MAX_DELAY_MS = 900;
const LIVE_SYNC_MAX_ADJUST_MS = 2;
const LIVE_SYNC_MIN_CORRELATION = 0.68;

function getBufferStats(buffer) {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    const value = Math.abs(buffer[i]);
    peak = Math.max(peak, value);
    sum += value * value;
  }
  return {
    peak,
    rms: Math.sqrt(sum / buffer.length),
  };
}

async function sampleNoiseFloor(analyser, buffer, durationMs = 420) {
  const start = performance.now();
  let peak = 0;
  let rmsTotal = 0;
  let samples = 0;

  while (performance.now() - start < durationMs) {
    analyser.getFloatTimeDomainData(buffer);
    const stats = getBufferStats(buffer);
    peak = Math.max(peak, stats.peak);
    rmsTotal += stats.rms;
    samples += 1;
    await sleep(24);
  }

  return {
    peak,
    rms: samples ? rmsTotal / samples : 0,
  };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) {
    return 0;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function roundTenth(value) {
  return Math.round(value * 10) / 10;
}

function roundHundredth(value) {
  return Math.round(value * 100) / 100;
}

function findImpulseOnset(buffer, sampleRate, threshold, noiseRms) {
  let peak = 0;
  let peakIndex = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    const value = Math.abs(buffer[i]);
    if (value > peak) {
      peak = value;
      peakIndex = i;
    }
  }

  if (peakIndex < 0 || peak < threshold) {
    return null;
  }

  const floor = Math.max(noiseRms * 4.2, threshold * 0.32, 0.012);
  const searchSamples = Math.min(peakIndex, Math.floor(sampleRate * 0.018));
  let onsetIndex = peakIndex;
  for (let i = peakIndex; i >= peakIndex - searchSamples; i -= 1) {
    if (Math.abs(buffer[i]) <= floor) {
      onsetIndex = i + 1;
      break;
    }
  }

  const stats = getBufferStats(buffer);
  return {
    onsetIndex,
    peak,
    rms: stats.rms,
    quality: peak / Math.max(threshold, 0.001),
  };
}

async function waitForImpulse(analyser, buffer, noiseProfile, expectedStartMs, timeoutMs = 1900) {
  const deadline = performance.now() + timeoutMs;
  const sampleRate = analyser.context.sampleRate;
  const threshold = Math.max(0.045, noiseProfile.peak * 4.8, noiseProfile.rms * 10);
  const earlyWindowMs = 18;

  while (performance.now() < deadline) {
    analyser.getFloatTimeDomainData(buffer);
    const impulse = findImpulseOnset(buffer, sampleRate, threshold, noiseProfile.rms);
    const now = performance.now();

    if (impulse) {
      const bufferDurationMs = (buffer.length / sampleRate) * 1000;
      const onsetMs = now - bufferDurationMs + (impulse.onsetIndex / sampleRate) * 1000;
      if (onsetMs >= expectedStartMs - earlyWindowMs) {
        const latencyMs = Math.max(0, onsetMs - expectedStartMs);
        return {
          latencyMs,
          peak: impulse.peak,
          rms: impulse.rms,
          quality: impulse.quality,
          threshold,
        };
      }
    }

    await sleep(3);
  }

  throw new Error("No calibration click detected. Turn the speaker up or move the microphone closer.");
}

function summarizeTrials(id, trials) {
  const valid = trials
    .filter((trial) => Number.isFinite(trial.latencyMs) && trial.quality >= 1)
    .sort((a, b) => a.latencyMs - b.latencyMs);

  if (valid.length < MIN_VALID_TRIALS) {
    throw new Error(`${id} calibration was not stable enough. Move the microphone closer and try again.`);
  }

  const latencyMs = median(valid.map((trial) => trial.latencyMs));
  const peak = median(valid.map((trial) => trial.peak));
  const spread = valid[valid.length - 1].latencyMs - valid[0].latencyMs;

  if (spread > MAX_LATENCY_SPREAD_MS) {
    const centered = valid.filter((trial) => Math.abs(trial.latencyMs - latencyMs) <= MAX_LATENCY_SPREAD_MS / 2);
    if (centered.length < MIN_VALID_TRIALS) {
      throw new Error(`${id} readings were too inconsistent. Quiet the room and try again.`);
    }

    return {
      latencyMs: median(centered.map((trial) => trial.latencyMs)),
      peak: median(centered.map((trial) => trial.peak)),
      spreadMs: centered[centered.length - 1].latencyMs - centered[0].latencyMs,
      trials: centered,
    };
  }

  return {
    latencyMs,
    peak,
    spreadMs: spread,
    trials: valid,
  };
}

async function measureSpeaker(engine, id, analyser, buffer, noiseProfile, callbacks, progressBase, progressSpan) {
  const trials = [];

  for (let trial = 0; trial < CALIBRATION_TRIALS; trial += 1) {
    callbacks.status?.(`Measuring ${id} ${trial + 1}/${CALIBRATION_TRIALS}`);
    callbacks.progress?.(progressBase + trial * (progressSpan / CALIBRATION_TRIALS));
    await sleep(210);

    const firedAt = performance.now();
    const startDelayMs = await engine.playSpeakerPing(id, {
      gain: id === "bass" ? 1.08 : 0.9,
      startDelay: 0.14,
      toneHz: 1400,
      noiseAmount: 0.95,
      bypassCrossover: true,
    });

    try {
      trials.push(await waitForImpulse(
        analyser,
        buffer,
        noiseProfile,
        firedAt + startDelayMs,
      ));
    } catch (error) {
      trials.push({
        latencyMs: Number.NaN,
        peak: 0,
        rms: 0,
        quality: 0,
        error,
      });
    }

    await sleep(190);
  }

  return summarizeTrials(id, trials);
}

async function verifyCalibration(engine, analyser, buffer, noiseProfile, activeIds, callbacks) {
  const measured = {};
  for (let index = 0; index < activeIds.length; index += 1) {
    const id = activeIds[index];
    callbacks.status?.(`Verifying ${id}`);
    callbacks.progress?.(82 + index * (12 / activeIds.length));
    await sleep(180);
    const firedAt = performance.now();
    const startDelayMs = await engine.playSpeakerPing(id, {
      gain: id === "bass" ? 1.02 : 0.86,
      startDelay: 0.12,
      toneHz: 1400,
      noiseAmount: 0.9,
      bypassCrossover: true,
    });
    const result = await waitForImpulse(analyser, buffer, noiseProfile, firedAt + startDelayMs, 1600);
    measured[id] = result.latencyMs;
  }

  const values = Object.values(measured);
  return Math.max(...values) - Math.min(...values);
}

function getMeasurementVolume(id, previousVolume) {
  if (id === "bass") {
    return clamp(Math.max(previousVolume, 0.86), 0, 1);
  }

  return clamp(Math.max(previousVolume, 0.74), 0, 1.5);
}

function getTargetPeak(id, medianPeak) {
  if (id === "bass") {
    return {
      peak: medianPeak * 1.12,
      minVolume: 0.78,
      maxVolume: 1,
      maxRatio: 1.34,
    };
  }

  return {
    peak: medianPeak,
    minVolume: 0.55,
    maxVolume: 1.5,
    maxRatio: 1.18,
  };
}

export async function runMicrophoneCalibration(engine, callbacks = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone calibration is not supported in this browser.");
  }

  const activeIds = engine.getActiveSpeakerIds();
  if (activeIds.length < 2) {
    throw new Error("At least two active speakers are required.");
  }

  const previousDelays = Object.fromEntries(
    activeIds.map((id) => [id, engine.getSettings().speakers[id].delayMs]),
  );
  const previousVolumes = Object.fromEntries(
    activeIds.map((id) => [id, engine.getSettings().speakers[id].volume]),
  );

  let stream = null;
  let context = null;

  try {
    callbacks.status?.("Requesting microphone");
    callbacks.progress?.(5);
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    context = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: "interactive",
    });
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);

    // Measure hardware latency, so the existing manual delays are cleared first.
    for (const id of activeIds) {
      engine.setSpeakerDelay(id, 0);
      engine.setSpeakerVolume(id, getMeasurementVolume(id, previousVolumes[id]));
    }

    callbacks.status?.("Measuring room noise");
    callbacks.progress?.(12);
    const noiseProfile = await sampleNoiseFloor(analyser, buffer);
    if (noiseProfile.peak > 0.18 || noiseProfile.rms > 0.045) {
      throw new Error("The room is too noisy for precise calibration.");
    }

    const latencies = {};
    const peaks = {};
    const spreads = {};
    for (let index = 0; index < activeIds.length; index += 1) {
      const id = activeIds[index];
      const summary = await measureSpeaker(
        engine,
        id,
        analyser,
        buffer,
        noiseProfile,
        callbacks,
        18 + index * (62 / activeIds.length),
        56 / activeIds.length,
      );
      latencies[id] = summary.latencyMs;
      peaks[id] = summary.peak;
      spreads[id] = summary.spreadMs;
    }

    const slowest = Math.max(...Object.values(latencies));
    for (const id of activeIds) {
      const compensation = roundTenth(clamp(slowest - latencies[id], 0, MAX_DELAY_MS));
      engine.setSpeakerDelay(id, compensation);
    }

    const sortedPeaks = Object.values(peaks).filter(Number.isFinite).sort((a, b) => a - b);
    const medianPeak = sortedPeaks[Math.floor(sortedPeaks.length / 2)] || sortedPeaks[0] || 0.12;
    for (const id of activeIds) {
      const currentVolume = engine.getSettings().speakers[id].volume;
      const speakerPeak = Math.max(peaks[id] || medianPeak, 0.02);
      const target = getTargetPeak(id, medianPeak);
      const ratio = clamp(target.peak / speakerPeak, 0.68, target.maxRatio);
      engine.setSpeakerVolume(id, roundHundredth(clamp(currentVolume * ratio, target.minVolume, target.maxVolume)));
    }

    const verificationSpreadMs = await verifyCalibration(
      engine,
      analyser,
      buffer,
      noiseProfile,
      activeIds,
      callbacks,
    );

    callbacks.progress?.(100);
    callbacks.status?.(
      verificationSpreadMs <= 8
        ? "Precision calibration applied"
        : "Calibration applied; verify with Sync Test",
    );
    return {
      latencies,
      peaks,
      spreads,
      verificationSpreadMs,
      delays: Object.fromEntries(
        activeIds.map((id) => [id, engine.getSettings().speakers[id].delayMs]),
      ),
      volumes: Object.fromEntries(
        activeIds.map((id) => [id, engine.getSettings().speakers[id].volume]),
      ),
    };
  } catch (error) {
    // Restore user settings if the permission prompt is denied or the room is too noisy.
    for (const [id, delay] of Object.entries(previousDelays)) {
      engine.setSpeakerDelay(id, delay);
    }
    for (const [id, volume] of Object.entries(previousVolumes)) {
      engine.setSpeakerVolume(id, volume);
    }
    callbacks.status?.("Calibration failed");
    throw error;
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
    await context?.close?.();
  }
}

export async function runLatencyWizard(engine, callbacks = {}) {
  callbacks.status?.("Playing alignment clicks");
  callbacks.progress?.(15);

  for (let i = 0; i < 5; i += 1) {
    callbacks.progress?.(15 + i * 17);
    await engine.playSyncTest();
    await sleep(780);
  }

  callbacks.progress?.(100);
  callbacks.status?.("Adjust delays");
}

export class LiveMicSync {
  constructor(engine, callbacks = {}) {
    this.engine = engine;
    this.callbacks = callbacks;
    this.stream = null;
    this.context = null;
    this.analyser = null;
    this.buffer = null;
    this.spectrum = null;
    this.timer = null;
    this.sampleTimer = null;
    this.running = false;
    this.inCycle = false;
    this.history = {};
    this.stableCandidates = {};
    this.lastAdjustmentAt = 0;
  }

  async start() {
    if (this.running) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Live mic sync is not supported in this browser.");
    }

    this.callbacks.status?.("Requesting microphone");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    this.context = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: "interactive",
    });
    const source = this.context.createMediaStreamSource(this.stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 8192;
    this.analyser.smoothingTimeConstant = 0;
    source.connect(this.analyser);
    this.buffer = new Float32Array(this.analyser.fftSize);
    this.spectrum = new Uint8Array(this.analyser.frequencyBinCount);

    this.running = true;
    this.callbacks.status?.("Silent mic sync listening");
    this.sampleTimer = window.setInterval(() => this.captureSample(), LIVE_SYNC_SAMPLE_MS);
    this.timer = window.setInterval(() => {
      this.runCycle().catch((error) => {
        this.callbacks.status?.(error.message || "Silent sync listening");
      });
    }, LIVE_SYNC_INTERVAL_MS);
  }

  async stop() {
    this.running = false;
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.sampleTimer) {
      window.clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    await this.context?.close?.();
    this.context = null;
    this.analyser = null;
    this.buffer = null;
    this.spectrum = null;
    this.history = {};
    this.stableCandidates = {};
    this.callbacks.status?.("Silent mic sync off");
  }

  averageBand(spectrum, analyser, lowHz, highHz) {
    const nyquist = analyser.context.sampleRate / 2;
    const start = Math.max(0, Math.floor((lowHz / nyquist) * spectrum.length));
    const end = Math.min(spectrum.length - 1, Math.ceil((highHz / nyquist) * spectrum.length));
    let sum = 0;
    let count = 0;

    for (let index = start; index <= end; index += 1) {
      sum += spectrum[index] || 0;
      count += 1;
    }

    return count ? sum / count / 255 : 0;
  }

  appendSample(id, source, microphone) {
    this.history[id] ||= { source: [], microphone: [] };
    const history = this.history[id];
    history.source.push(source);
    history.microphone.push(microphone);
    if (history.source.length > LIVE_SYNC_HISTORY_SIZE) {
      history.source.shift();
      history.microphone.shift();
    }
  }

  captureSample() {
    if (!this.running || !this.analyser || !this.spectrum || !this.engine.isPlaying || this.engine.liveStream) {
      return;
    }

    this.analyser.getByteFrequencyData(this.spectrum);
    const sources = this.engine.getSyncAnalyserData();
    for (const entry of sources) {
      const band = entry.id === "bass" ? [38, 220] : entry.id === "mid" ? [240, 2600] : entry.id === "treble" ? [2500, 10000] : [300, 5200];
      const sourceEnergy = this.averageBand(entry.spectrum, entry.analyser, band[0], band[1]);
      const microphoneEnergy = this.averageBand(this.spectrum, this.analyser, band[0], band[1]);
      this.appendSample(entry.id, sourceEnergy, microphoneEnergy);
    }
  }

  correlation(source, microphone, lagFrames) {
    const length = Math.min(source.length, microphone.length) - lagFrames;
    if (length < LIVE_SYNC_MIN_SAMPLES) {
      return Number.NEGATIVE_INFINITY;
    }

    let sourceMean = 0;
    let microphoneMean = 0;
    for (let index = 0; index < length; index += 1) {
      sourceMean += source[index];
      microphoneMean += microphone[index + lagFrames];
    }
    sourceMean /= length;
    microphoneMean /= length;

    let numerator = 0;
    let sourcePower = 0;
    let microphonePower = 0;
    for (let index = 0; index < length; index += 1) {
      const sourceDelta = source[index] - sourceMean;
      const microphoneDelta = microphone[index + lagFrames] - microphoneMean;
      numerator += sourceDelta * microphoneDelta;
      sourcePower += sourceDelta * sourceDelta;
      microphonePower += microphoneDelta * microphoneDelta;
    }

    return numerator / Math.sqrt(Math.max(sourcePower * microphonePower, 1e-9));
  }

  estimateDelay(id) {
    const history = this.history[id];
    if (!history || history.source.length < LIVE_SYNC_MIN_SAMPLES) {
      return null;
    }

    const maxLagFrames = Math.min(
      Math.floor(LIVE_SYNC_MAX_DELAY_MS / LIVE_SYNC_SAMPLE_MS),
      history.source.length - LIVE_SYNC_MIN_SAMPLES,
    );
    let best = { correlation: Number.NEGATIVE_INFINITY, lagFrames: 0 };

    for (let lagFrames = 0; lagFrames <= maxLagFrames; lagFrames += 1) {
      const correlation = this.correlation(history.source, history.microphone, lagFrames);
      if (correlation > best.correlation) {
        best = { correlation, lagFrames };
      }
    }

    if (best.correlation < LIVE_SYNC_MIN_CORRELATION) {
      return null;
    }

    return {
      confidence: best.correlation,
      delayMs: best.lagFrames * LIVE_SYNC_SAMPLE_MS,
    };
  }

  async runCycle() {
    if (!this.running || this.inCycle || !this.analyser || !this.buffer) {
      return;
    }

    this.inCycle = true;
    try {
      const activeIds = this.engine.getActiveSpeakerIds();
      if (activeIds.length < 2) {
        return;
      }

      if (!this.engine.isPlaying) {
        this.callbacks.status?.("Silent mic sync armed");
        return;
      }

      const estimates = Object.fromEntries(
        activeIds.map((id) => [id, this.estimateDelay(id)]),
      );
      const usable = activeIds.filter((id) => estimates[id]);
      if (usable.length < 2) {
        this.callbacks.status?.("Silent sync listening for clear bass");
        return;
      }

      const signature = usable.map((id) => `${id}:${estimates[id].delayMs}`).join("|");
      for (const key of Object.keys(this.stableCandidates)) {
        if (key !== signature) {
          delete this.stableCandidates[key];
        }
      }
      this.stableCandidates[signature] = (this.stableCandidates[signature] || 0) + 1;
      const isStable = this.stableCandidates[signature] >= 2;
      const slowestDelay = Math.max(...usable.map((id) => estimates[id].delayMs));
      let biggestAdjustment = 0;
      if (isStable && performance.now() - this.lastAdjustmentAt > 7000) {
        for (const id of usable) {
          const speaker = this.engine.getSettings().speakers[id];
          const targetDelay = clamp(speaker.delayMs + slowestDelay - estimates[id].delayMs, 0, MAX_DELAY_MS);
          const adjustment = clamp(targetDelay - speaker.delayMs, -LIVE_SYNC_MAX_ADJUST_MS, LIVE_SYNC_MAX_ADJUST_MS);
          if (Math.abs(adjustment) >= 0.8) {
            this.engine.setSpeakerDelay(id, roundTenth(speaker.delayMs + adjustment));
            biggestAdjustment = Math.max(biggestAdjustment, Math.abs(adjustment));
          }
        }
        if (biggestAdjustment) {
          this.lastAdjustmentAt = performance.now();
        }
      }

      this.callbacks.progress?.(100);
      this.callbacks.status?.(
        biggestAdjustment >= 0.8
          ? `Silent sync aligned ${roundTenth(biggestAdjustment)} ms`
          : isStable
            ? "Silent sync locked"
            : "Silent sync confirming alignment",
      );
      this.callbacks.result?.({ estimates, adjustmentMs: biggestAdjustment });
    } catch (error) {
      this.callbacks.status?.("Silent sync listening");
    } finally {
      this.inCycle = false;
    }
  }
}
