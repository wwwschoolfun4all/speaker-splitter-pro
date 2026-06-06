import { MAX_DELAY_MS, clamp } from "./constants.js";

const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

function getPeak(buffer) {
  let peak = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    peak = Math.max(peak, Math.abs(buffer[i]));
  }
  return peak;
}

async function sampleNoiseFloor(analyser, buffer, durationMs = 420) {
  const start = performance.now();
  let peak = 0;

  while (performance.now() - start < durationMs) {
    analyser.getFloatTimeDomainData(buffer);
    peak = Math.max(peak, getPeak(buffer));
    await sleep(24);
  }

  return peak;
}

async function waitForImpulse(analyser, buffer, threshold, expectedStartMs, timeoutMs = 1900) {
  const deadline = performance.now() + timeoutMs;

  while (performance.now() < deadline) {
    analyser.getFloatTimeDomainData(buffer);
    const peak = getPeak(buffer);
    const now = performance.now();

    if (now >= expectedStartMs && peak >= threshold) {
      return {
        latencyMs: now - expectedStartMs,
        peak,
      };
    }

    await sleep(8);
  }

  throw new Error("No calibration click detected.");
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
    analyser.fftSize = 2048;
    source.connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);

    // Measure hardware latency, so the existing manual delays are cleared first.
    for (const id of activeIds) {
      engine.setSpeakerDelay(id, 0);
    }

    callbacks.status?.("Measuring room noise");
    callbacks.progress?.(12);
    const noiseFloor = await sampleNoiseFloor(analyser, buffer);
    const threshold = Math.max(0.055, noiseFloor * 4.5);

    const latencies = {};
    const peaks = {};
    for (let index = 0; index < activeIds.length; index += 1) {
      const id = activeIds[index];
      callbacks.status?.(`Listening to ${id}`);
      callbacks.progress?.(18 + index * (62 / activeIds.length));

      await sleep(260);
      const firedAt = performance.now();
      const startDelayMs = await engine.playSpeakerPing(id, {
        gain: id === "bass" ? 1.35 : 0.95,
        startDelay: 0.12,
        toneHz: id === "bass" ? 125 : 1100,
        noiseAmount: id === "bass" ? 1.05 : 0.75,
      });
      const result = await waitForImpulse(
        analyser,
        buffer,
        threshold,
        firedAt + startDelayMs,
      );
      latencies[id] = result.latencyMs;
      peaks[id] = result.peak;
      await sleep(280);
    }

    const slowest = Math.max(...Object.values(latencies));
    for (const id of activeIds) {
      const compensation = clamp(slowest - latencies[id], 0, MAX_DELAY_MS);
      engine.setSpeakerDelay(id, compensation);
    }

    const sortedPeaks = Object.values(peaks).filter(Number.isFinite).sort((a, b) => a - b);
    const medianPeak = sortedPeaks[Math.floor(sortedPeaks.length / 2)] || sortedPeaks[0] || 0.12;
    for (const id of activeIds) {
      const currentVolume = engine.getSettings().speakers[id].volume;
      const speakerPeak = Math.max(peaks[id] || medianPeak, 0.02);
      const targetPeak = id === "bass" ? medianPeak * 1.18 : medianPeak;
      const ratio = clamp(targetPeak / speakerPeak, 0.72, id === "bass" ? 1.28 : 1.16);
      const maxVolume = id === "bass" ? 1 : 1.5;
      const minVolume = id === "bass" ? 0.72 : 0.55;
      engine.setSpeakerVolume(id, clamp(currentVolume * ratio, minVolume, maxVolume));
    }

    callbacks.progress?.(100);
    callbacks.status?.("Calibration applied: delay and level");
    return {
      latencies,
      peaks,
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
