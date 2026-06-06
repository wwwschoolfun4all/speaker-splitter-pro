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
      return now - expectedStartMs;
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
    for (let index = 0; index < activeIds.length; index += 1) {
      const id = activeIds[index];
      callbacks.status?.(`Listening to ${id}`);
      callbacks.progress?.(18 + index * (62 / activeIds.length));

      await sleep(260);
      const firedAt = performance.now();
      const startDelayMs = await engine.playSpeakerPing(id, {
        gain: 0.95,
        startDelay: 0.12,
      });
      latencies[id] = await waitForImpulse(
        analyser,
        buffer,
        threshold,
        firedAt + startDelayMs,
      );
      await sleep(280);
    }

    const slowest = Math.max(...Object.values(latencies));
    for (const id of activeIds) {
      const compensation = clamp(slowest - latencies[id], 0, MAX_DELAY_MS);
      engine.setSpeakerDelay(id, compensation);
    }

    callbacks.progress?.(100);
    callbacks.status?.("Calibration applied");
    return {
      latencies,
      delays: Object.fromEntries(
        activeIds.map((id) => [id, engine.getSettings().speakers[id].delayMs]),
      ),
    };
  } catch (error) {
    // Restore user settings if the permission prompt is denied or the room is too noisy.
    for (const [id, delay] of Object.entries(previousDelays)) {
      engine.setSpeakerDelay(id, delay);
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
