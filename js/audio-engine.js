import {
  ACTIVE_THREE_WAY,
  ACTIVE_TWO_WAY,
  EQ_BANDS,
  EQ_MAX_DB,
  EQ_MIN_DB,
  MAX_DELAY_MS,
  SPEAKER_IDS,
  clamp,
  createDefaultSettings,
  mergeSettings,
} from "./constants.js";

const AudioCtor = window.AudioContext || window.webkitAudioContext;
const WORKLET_URL = new URL("./center-vocal-worklet.js", import.meta.url);
const FILTER_RAMP_SECONDS = 0.025;

function smoothValue(param, value, context, ramp = FILTER_RAMP_SECONDS) {
  const now = context.currentTime;
  const safeValue = Number.isFinite(value) ? value : param.value;
  param.cancelScheduledValues(now);
  param.setTargetAtTime(safeValue, now, ramp);
}

function waitForMediaEvent(media, eventName) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      media.removeEventListener(eventName, onSuccess);
      media.removeEventListener("error", onError);
    };
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(media.error?.message || "The audio file could not be loaded."));
    };

    media.addEventListener(eventName, onSuccess, { once: true });
    media.addEventListener("error", onError, { once: true });
  });
}

class SpeakerPath {
  constructor(id) {
    if (!AudioCtor) {
      throw new Error("Web Audio API is not supported in this browser.");
    }

    this.id = id;
    this.role = id;
    this.deviceId = "default";
    this.spectrum = null;
    this.meter = null;
    this.isolationAvailable = false;

    this.context = new AudioCtor({ latencyHint: "playback" });
    this.media = new Audio();
    this.media.preload = "auto";
    this.media.playsInline = true;

    this.mediaSource = this.context.createMediaElementSource(this.media);
    this.liveSource = null;
    this.inputGain = this.context.createGain();

    // Two cascaded high-pass and low-pass filters form a smooth 24 dB/octave
    // crossover while still allowing live frequency moves without zipper noise.
    this.highPassA = this.context.createBiquadFilter();
    this.highPassB = this.context.createBiquadFilter();
    this.lowPassA = this.context.createBiquadFilter();
    this.lowPassB = this.context.createBiquadFilter();
    for (const node of [this.highPassA, this.highPassB]) {
      node.type = "highpass";
      node.Q.value = 0.707;
    }
    for (const node of [this.lowPassA, this.lowPassB]) {
      node.type = "lowpass";
      node.Q.value = 0.707;
    }

    this.dryGain = this.context.createGain();
    this.isoFeedGain = this.context.createGain();
    this.isoHighPass = this.context.createBiquadFilter();
    this.isoLowPass = this.context.createBiquadFilter();
    this.isoPresence = this.context.createBiquadFilter();
    this.isoGain = this.context.createGain();
    this.centerNode = null;

    this.isoHighPass.type = "highpass";
    this.isoHighPass.frequency.value = 120;
    this.isoLowPass.type = "lowpass";
    this.isoLowPass.frequency.value = 7000;
    this.isoPresence.type = "peaking";
    this.isoPresence.frequency.value = 1800;
    this.isoPresence.Q.value = 1.2;
    this.isoPresence.gain.value = 2.5;
    this.dryGain.gain.value = 1;
    this.isoGain.gain.value = 0;

    this.eqNodes = EQ_BANDS.map((frequency) => {
      const node = this.context.createBiquadFilter();
      node.type = "peaking";
      node.frequency.value = frequency;
      node.Q.value = frequency < 1000 ? 1.05 : 1.18;
      node.gain.value = 0;
      return node;
    });

    this.delay = this.context.createDelay(MAX_DELAY_MS / 1000 + 0.05);
    this.volume = this.context.createGain();
    this.djGain = this.context.createGain();
    this.master = this.context.createGain();
    this.limiter = this.context.createDynamicsCompressor();
    this.limiterInput = this.context.createGain();
    this.limiterBypass = this.context.createGain();
    this.ceiling = this.context.createGain();
    this.analyser = this.context.createAnalyser();

    this.delay.delayTime.value = 0;
    this.inputGain.gain.value = 0.72;
    this.volume.gain.value = 1;
    this.djGain.gain.value = 1;
    this.master.gain.value = 1;
    this.limiter.threshold.value = -12;
    this.limiter.knee.value = 10;
    this.limiter.ratio.value = 14;
    this.limiter.attack.value = 0.004;
    this.limiter.release.value = 0.22;
    this.limiterInput.gain.value = 1;
    this.limiterBypass.gain.value = 0;
    this.ceiling.gain.value = 0.82;
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.82;

    this.connectGraph();
    this.setCrossover(160, 3500);
  }

  connectGraph() {
    this.mediaSource
      .connect(this.inputGain)
      .connect(this.highPassA)
      .connect(this.highPassB)
      .connect(this.lowPassA)
      .connect(this.lowPassB);

    this.lowPassB.connect(this.dryGain);
    this.lowPassB.connect(this.isoFeedGain);
    this.isoFeedGain
      .connect(this.isoHighPass)
      .connect(this.isoLowPass)
      .connect(this.isoPresence)
      .connect(this.isoGain);

    const firstEq = this.eqNodes[0];
    this.dryGain.connect(firstEq);
    this.isoGain.connect(firstEq);

    for (let index = 0; index < this.eqNodes.length - 1; index += 1) {
      this.eqNodes[index].connect(this.eqNodes[index + 1]);
    }

    this.eqNodes[this.eqNodes.length - 1]
      .connect(this.delay)
      .connect(this.volume)
      .connect(this.djGain)
      .connect(this.master);

    this.master.connect(this.limiter).connect(this.limiterInput).connect(this.ceiling);
    this.master.connect(this.limiterBypass).connect(this.ceiling);

    this.ceiling
      .connect(this.analyser)
      .connect(this.context.destination);
  }

  async prepareIsolationWorklet() {
    if (!this.context.audioWorklet || typeof AudioWorkletNode === "undefined") {
      return false;
    }

    try {
      await this.context.audioWorklet.addModule(WORKLET_URL);
      this.centerNode = new AudioWorkletNode(this.context, "center-vocal-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });

      this.isoFeedGain.disconnect();
      this.isoFeedGain
        .connect(this.centerNode)
        .connect(this.isoHighPass);

      this.isolationAvailable = true;
      return true;
    } catch {
      this.isolationAvailable = false;
      return false;
    }
  }

  async load(url) {
    this.stopLiveInput();
    this.media.pause();
    this.media.src = url;
    this.media.load();
    await waitForMediaEvent(this.media, "loadedmetadata");
  }

  loadStream(stream) {
    this.media.pause();
    this.media.removeAttribute("src");
    this.media.load();
    this.stopLiveInput();
    this.liveSource = this.context.createMediaStreamSource(stream);
    this.liveSource.connect(this.inputGain);
  }

  stopLiveInput() {
    if (!this.liveSource) {
      return;
    }

    try {
      this.liveSource.disconnect();
    } catch {
      // The source may already be disconnected after a browser capture stop.
    }
    this.liveSource = null;
  }

  setRole(role) {
    this.role = role;
    const inputHeadroom = role === "bass" ? 0.48 : 0.82;
    const ceiling = role === "bass" ? 0.58 : 0.86;
    this.limiter.threshold.value = role === "bass" ? -16 : -12;
    this.limiter.ratio.value = role === "bass" ? 18 : 14;
    smoothValue(this.inputGain.gain, inputHeadroom, this.context, 0.02);
    smoothValue(this.ceiling.gain, ceiling, this.context, 0.02);
  }

  setCrossover(crossoverHz, trebleSplitHz) {
    const nyquist = this.context.sampleRate / 2;
    const almostNyquist = Math.max(1000, nyquist - 120);
    const lowGuard = this.role === "bass" ? 38 : 10;
    const bassCut = clamp(crossoverHz, 50, 500);
    const trebleCut = clamp(trebleSplitHz, 1000, Math.min(8000, almostNyquist));

    let highPassHz = lowGuard;
    let lowPassHz = almostNyquist;

    if (this.role === "bass") {
      lowPassHz = bassCut;
    } else if (this.role === "vocal") {
      highPassHz = bassCut;
    } else if (this.role === "mid") {
      highPassHz = bassCut;
      lowPassHz = trebleCut;
    } else if (this.role === "treble") {
      highPassHz = trebleCut;
    }

    for (const node of [this.highPassA, this.highPassB]) {
      smoothValue(node.frequency, highPassHz, this.context);
    }
    for (const node of [this.lowPassA, this.lowPassB]) {
      smoothValue(node.frequency, lowPassHz, this.context);
    }
  }

  setVocalIsolation(enabled) {
    const eligible = this.role === "vocal" || this.role === "mid";
    const wet = enabled && eligible ? 0.85 : 0;
    const dry = enabled && eligible ? 0.32 : 1;
    smoothValue(this.isoGain.gain, wet, this.context, 0.018);
    smoothValue(this.dryGain.gain, dry, this.context, 0.018);
  }

  setDelayMs(delayMs) {
    smoothValue(
      this.delay.delayTime,
      clamp(delayMs, 0, MAX_DELAY_MS) / 1000,
      this.context,
      0.012,
    );
  }

  setVolume(value) {
    const maxVolume = this.role === "bass" ? 1 : 1.5;
    smoothValue(this.volume.gain, clamp(value, 0, maxVolume), this.context, 0.015);
  }

  setDjGain(value) {
    smoothValue(this.djGain.gain, clamp(value, 0, 1.35), this.context, 0.018);
  }

  setMasterVolume(value) {
    const maxMaster = this.role === "bass" ? 1 : 1.5;
    smoothValue(this.master.gain, clamp(value, 0, maxMaster), this.context, 0.018);
  }

  setLimiterEnabled(enabled) {
    smoothValue(this.limiterInput.gain, enabled ? 1 : 0, this.context, 0.012);
    smoothValue(this.limiterBypass.gain, enabled ? 0 : 1, this.context, 0.012);
  }

  setEqGain(index, db) {
    const node = this.eqNodes[index];
    if (!node) {
      return;
    }
    const maxBoost = this.role === "bass" && index <= 3 ? 0 : EQ_MAX_DB;
    smoothValue(node.gain, clamp(db, EQ_MIN_DB, maxBoost), this.context, 0.018);
  }

  setEq(eqValues) {
    EQ_BANDS.forEach((_, index) => this.setEqGain(index, eqValues[index] ?? 0));
  }

  async setSinkId(deviceId) {
    this.deviceId = deviceId || "default";
    let routed = false;
    let lastError = null;

    // AudioContext routing keeps Web Audio processing and per-speaker filtering intact.
    if (typeof this.context.setSinkId === "function") {
      try {
        await this.context.setSinkId(this.deviceId);
        routed = true;
      } catch (error) {
        lastError = error;
      }
    }

    // Some browsers only expose setSinkId on media elements; use it as a fallback.
    if (typeof this.media.setSinkId === "function") {
      try {
        await this.media.setSinkId(this.deviceId);
        routed = true;
      } catch (error) {
        lastError = error;
      }
    }

    if (!routed && lastError) {
      throw lastError;
    }
    return routed;
  }

  async resume() {
    if (this.context.state !== "running") {
      await this.context.resume();
    }
  }

  setCurrentTime(seconds) {
    if (Number.isFinite(this.media.duration)) {
      this.media.currentTime = clamp(seconds, 0, this.media.duration);
    }
  }

  setPlaybackRate(rate) {
    const safeRate = clamp(rate, 0.25, 4);
    this.media.playbackRate = safeRate;
    if ("preservesPitch" in this.media) {
      this.media.preservesPitch = false;
    }
  }

  async play() {
    await this.resume();
    await this.media.play();
  }

  pause() {
    this.media.pause();
  }

  async suspend() {
    if (this.context.state === "running") {
      await this.context.suspend();
    }
  }

  playClick({
    gain = 0.75,
    startDelay = 0.08,
    toneHz = 1100,
    noiseAmount = 0.75,
    bypassCrossover = false,
  } = {}) {
    const sampleRate = this.context.sampleRate;
    const length = Math.floor(sampleRate * 0.075);
    const buffer = this.context.createBuffer(2, length, sampleRate);

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < data.length; i += 1) {
        const env = Math.exp(-i / (sampleRate * 0.006));
        const tone = Math.sin((2 * Math.PI * toneHz * i) / sampleRate) * 0.34;
        const noise = (Math.random() * 2 - 1) * noiseAmount;
        data[i] = (tone + noise) * env;
      }
    }

    const source = this.context.createBufferSource();
    const clickGain = this.context.createGain();
    source.buffer = buffer;
    clickGain.gain.value = gain;
    source.connect(clickGain).connect(bypassCrossover ? this.delay : this.inputGain);
    source.start(this.context.currentTime + startDelay);
    return startDelay * 1000;
  }

  getSpectrum() {
    if (!this.spectrum || this.spectrum.length !== this.analyser.frequencyBinCount) {
      this.spectrum = new Uint8Array(this.analyser.frequencyBinCount);
    }
    this.analyser.getByteFrequencyData(this.spectrum);
    return this.spectrum;
  }

  getLevel() {
    if (!this.meter || this.meter.length !== this.analyser.fftSize) {
      this.meter = new Uint8Array(this.analyser.fftSize);
    }
    this.analyser.getByteTimeDomainData(this.meter);

    let sum = 0;
    let peak = 0;
    for (const value of this.meter) {
      const normalized = (value - 128) / 128;
      sum += normalized * normalized;
      peak = Math.max(peak, Math.abs(normalized));
    }

    const rms = Math.sqrt(sum / this.meter.length);
    return {
      rms: clamp(rms * 1.9, 0, 1),
      peak,
      clipping: peak > 0.985,
    };
  }
}

export class AudioEngine extends EventTarget {
  constructor() {
    super();
    this.settings = createDefaultSettings();
    this.paths = Object.fromEntries(SPEAKER_IDS.map((id) => [id, new SpeakerPath(id)]));
    this.objectUrl = null;
    this.file = null;
    this.liveStream = null;
    this.duration = 0;
    this.isPlaying = false;
    this.driftTimer = null;

    for (const [id, path] of Object.entries(this.paths)) {
      path.setRole(id);
      path.media.addEventListener("ended", () => {
        if (this.getActiveSpeakerIds()[0] === id) {
          this.pause();
          this.dispatchEvent(new Event("ended"));
        }
      });
    }

    this.applySettings(this.settings);
  }

  async initialize() {
    await Promise.all([
      this.paths.vocal.prepareIsolationWorklet(),
      this.paths.mid.prepareIsolationWorklet(),
    ]);
  }

  getActiveSpeakerIds() {
    return this.settings.threeWay ? ACTIVE_THREE_WAY : ACTIVE_TWO_WAY;
  }

  getActivePaths() {
    return this.getActiveSpeakerIds().map((id) => this.paths[id]);
  }

  async loadFile(file) {
    if (!file) {
      throw new Error("No audio file selected.");
    }

    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
    }

    this.file = file;
    this.stopLiveCapture();
    this.objectUrl = URL.createObjectURL(file);
    this.pause();
    this.setPlaybackRate(1);
    await Promise.all(Object.values(this.paths).map((path) => path.load(this.objectUrl)));
    this.duration = this.paths.bass.media.duration || 0;
    this.setCurrentTime(0);
    this.dispatchEvent(new CustomEvent("fileloaded", { detail: { file, duration: this.duration } }));
  }

  async loadLiveStream(stream) {
    if (!stream?.getAudioTracks?.().length) {
      throw new Error("No audio track was captured. Share a tab/window with audio enabled.");
    }

    this.pause();
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }

    this.file = null;
    this.liveStream?.getTracks().forEach((track) => track.stop());
    this.liveStream = stream;
    this.duration = 0;

    for (const path of Object.values(this.paths)) {
      path.loadStream(stream);
    }

    for (const track of stream.getTracks()) {
      track.addEventListener("ended", () => this.stopLiveCapture(), { once: true });
    }

    await Promise.all(this.getActivePaths().map((path) => path.resume()));
    this.isPlaying = true;
    this.dispatchEvent(new Event("liveinput"));
    this.dispatchEvent(new Event("playstate"));
  }

  stopLiveCapture() {
    if (!this.liveStream) {
      return;
    }

    this.liveStream.getTracks().forEach((track) => track.stop());
    this.liveStream = null;
    for (const path of Object.values(this.paths)) {
      path.stopLiveInput();
    }
    this.isPlaying = false;
    this.dispatchEvent(new Event("liveinput"));
    this.dispatchEvent(new Event("playstate"));
  }

  async play() {
    if (this.liveStream) {
      await Promise.all(this.getActivePaths().map((path) => path.resume()));
      this.isPlaying = true;
      this.dispatchEvent(new Event("playstate"));
      return;
    }

    if (!this.objectUrl) {
      throw new Error("Load an audio file first.");
    }

    const current = this.getCurrentTime();
    for (const path of Object.values(this.paths)) {
      path.setCurrentTime(current);
    }

    await Promise.all(this.getActivePaths().map((path) => path.resume()));
    await Promise.all(this.getActivePaths().map((path) => path.play()));
    for (const id of SPEAKER_IDS) {
      if (!this.getActiveSpeakerIds().includes(id)) {
        this.paths[id].pause();
      }
    }

    this.isPlaying = true;
    this.startDriftCorrection();
    this.dispatchEvent(new Event("playstate"));
  }

  pause() {
    if (this.liveStream) {
      Promise.all(this.getActivePaths().map((path) => path.suspend())).catch(() => {});
    } else {
      for (const path of Object.values(this.paths)) {
        path.pause();
      }
    }
    this.isPlaying = false;
    this.stopDriftCorrection();
    this.dispatchEvent(new Event("playstate"));
  }

  stop() {
    if (this.liveStream) {
      this.stopLiveCapture();
      return;
    }

    this.pause();
    this.setCurrentTime(0);
    this.dispatchEvent(new Event("seek"));
  }

  setCurrentTime(seconds) {
    const safeTime = clamp(seconds, 0, this.duration || seconds || 0);
    for (const path of Object.values(this.paths)) {
      path.setCurrentTime(safeTime);
    }
    this.dispatchEvent(new Event("seek"));
  }

  nudgeCurrentTime(seconds) {
    if (this.liveStream || !this.objectUrl || !Number.isFinite(seconds)) {
      return;
    }

    this.setCurrentTime(this.getCurrentTime() + seconds);
  }

  setPlaybackRate(rate) {
    for (const path of Object.values(this.paths)) {
      path.setPlaybackRate(rate);
    }
  }

  getCurrentTime() {
    if (this.liveStream) {
      return 0;
    }

    const first = this.getActivePaths()[0] || this.paths.bass;
    return first.media.currentTime || 0;
  }

  async setThreeWay(enabled) {
    const wasPlaying = this.isPlaying;
    const current = this.getCurrentTime();

    if (wasPlaying) {
      this.pause();
    }

    this.settings.threeWay = Boolean(enabled);
    this.setCurrentTime(current);
    this.updateFilters();

    if (wasPlaying) {
      await this.play();
    }

    this.dispatchEvent(new Event("settingschange"));
  }

  setCrossover(value) {
    this.settings.crossoverHz = clamp(value, 50, 500);
    this.updateFilters();
    this.dispatchEvent(new Event("settingschange"));
  }

  setTrebleSplit(value) {
    this.settings.trebleSplitHz = clamp(value, 1000, 8000);
    this.updateFilters();
    this.dispatchEvent(new Event("settingschange"));
  }

  updateFilters() {
    for (const path of Object.values(this.paths)) {
      path.setCrossover(this.settings.crossoverHz, this.settings.trebleSplitHz);
      path.setVocalIsolation(this.settings.vocalIsolation);
    }
  }

  setVocalIsolation(enabled) {
    this.settings.vocalIsolation = Boolean(enabled);
    for (const path of Object.values(this.paths)) {
      path.setVocalIsolation(this.settings.vocalIsolation);
    }
    this.dispatchEvent(new Event("settingschange"));
  }

  setMasterVolume(value) {
    this.settings.masterVolume = clamp(value, 0, 1.5);
    for (const path of Object.values(this.paths)) {
      path.setMasterVolume(this.settings.masterVolume);
    }
    this.dispatchEvent(new Event("settingschange"));
  }

  setLimiterEnabled(enabled) {
    this.settings.limiterEnabled = Boolean(enabled);
    for (const path of Object.values(this.paths)) {
      path.setLimiterEnabled(this.settings.limiterEnabled);
    }
    this.dispatchEvent(new Event("settingschange"));
  }

  setAutoDjEnabled(enabled) {
    this.settings.autoDjEnabled = Boolean(enabled);
    this.dispatchEvent(new Event("settingschange"));
  }

  setDjControls(partial) {
    this.settings.dj = {
      ...this.settings.dj,
      ...partial,
    };
    this.dispatchEvent(new Event("settingschange"));
  }

  setSpeakerDjGain(id, value) {
    if (!this.paths[id]) {
      return;
    }
    this.paths[id].setDjGain(value);
  }

  setSpeakerVolume(id, value) {
    const speaker = this.settings.speakers[id];
    if (!speaker) {
      return;
    }
    speaker.volume = clamp(value, 0, 1.5);
    this.paths[id].setVolume(speaker.volume);
    this.dispatchEvent(new Event("settingschange"));
  }

  setSpeakerDelay(id, delayMs) {
    const speaker = this.settings.speakers[id];
    if (!speaker) {
      return;
    }
    speaker.delayMs = clamp(delayMs, 0, MAX_DELAY_MS);
    this.paths[id].setDelayMs(speaker.delayMs);
    this.dispatchEvent(new Event("settingschange"));
  }

  setEqGain(id, index, db) {
    const speaker = this.settings.speakers[id];
    if (!speaker) {
      return;
    }
    speaker.eq[index] = clamp(db, EQ_MIN_DB, EQ_MAX_DB);
    this.paths[id].setEqGain(index, speaker.eq[index]);
    this.dispatchEvent(new Event("settingschange"));
  }

  async setOutputDevice(id, deviceId) {
    const speaker = this.settings.speakers[id];
    if (!speaker) {
      return false;
    }

    speaker.deviceId = deviceId || "default";
    const routed = await this.paths[id].setSinkId(speaker.deviceId);
    this.dispatchEvent(new Event("settingschange"));
    return routed;
  }

  applySettings(settings) {
    this.settings = mergeSettings(settings);
    for (const id of SPEAKER_IDS) {
      const speaker = this.settings.speakers[id];
      this.paths[id].setRole(id);
      this.paths[id].setMasterVolume(this.settings.masterVolume);
      this.paths[id].setLimiterEnabled(this.settings.limiterEnabled);
      this.paths[id].setVolume(speaker.volume);
      this.paths[id].setDjGain(1);
      this.paths[id].setDelayMs(speaker.delayMs);
      this.paths[id].setEq(speaker.eq);
      this.paths[id].deviceId = speaker.deviceId;
    }
    this.updateFilters();
    this.dispatchEvent(new Event("settingschange"));
  }

  getSettings() {
    return mergeSettings(JSON.parse(JSON.stringify(this.settings)));
  }

  async playSyncTest() {
    await Promise.all(this.getActivePaths().map((path) => path.resume()));
    this.getActivePaths().forEach((path) => path.playClick({ gain: 0.72, startDelay: 0.08 }));
  }

  async playSpeakerPing(id, options = {}) {
    const path = this.paths[id];
    if (!path) {
      throw new Error(`Unknown speaker path: ${id}`);
    }
    await path.resume();
    return path.playClick(options);
  }

  getAnalyserData() {
    return this.getActiveSpeakerIds().map((id) => ({
      id,
      spectrum: this.paths[id].getSpectrum(),
      analyser: this.paths[id].analyser,
    }));
  }

  getMeterLevels() {
    return Object.fromEntries(
      SPEAKER_IDS.map((id) => [id, this.paths[id].getLevel()]),
    );
  }

  startDriftCorrection() {
    this.stopDriftCorrection();
    this.driftTimer = window.setInterval(() => {
      if (!this.isPlaying) {
        return;
      }

      const active = this.getActivePaths();
      const reference = active[0];
      if (!reference || reference.media.paused) {
        return;
      }

      const refTime = reference.media.currentTime;
      for (const path of active.slice(1)) {
        const drift = path.media.currentTime - refTime;
        if (Math.abs(drift) > 0.045) {
          path.media.currentTime = refTime;
        }
      }
    }, 300);
  }

  stopDriftCorrection() {
    if (this.driftTimer) {
      window.clearInterval(this.driftTimer);
      this.driftTimer = null;
    }
  }
}
