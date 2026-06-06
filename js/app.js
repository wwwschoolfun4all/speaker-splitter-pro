import {
  EQ_BANDS,
  EQ_MAX_DB,
  EQ_MIN_DB,
  SPEAKER_IDS,
  formatHz,
  formatTime,
} from "./constants.js";
import { AudioEngine } from "./audio-engine.js?v=20260606-precision-calibrate";
import { DeviceManager } from "./device-manager.js?v=20260606-all-devices";
import { SpectrumVisualizer } from "./visualizer.js";
import {
  FACTORY_PRESETS,
  attachDeviceLabels,
  deletePreset,
  exportPresetBlob,
  listSavedPresets,
  loadLastSession,
  loadLastSessionDevices,
  parsePresetFile,
  saveLastSession,
  savePreset,
} from "./presets.js?v=20260606-all-devices";
import { runLatencyWizard, runMicrophoneCalibration } from "./calibration.js?v=20260606-precision-calibrate";

const $ = (id) => document.getElementById(id);
const QUEUE_PREFS_KEY = "speaker-splitter-pro.queue-prefs.v1";

const dom = {
  engineStatus: $("engineStatus"),
  deviceStatus: $("deviceStatus"),
  dropZone: $("dropZone"),
  fileInput: $("fileInput"),
  chooseFileBtn: $("chooseFileBtn"),
  autoBlendToggle: $("autoBlendToggle"),
  blendTime: $("blendTime"),
  blendTimeValue: $("blendTimeValue"),
  nextTrackBtn: $("nextTrackBtn"),
  clearQueueBtn: $("clearQueueBtn"),
  nextTrackLabel: $("nextTrackLabel"),
  queueList: $("queueList"),
  spotifyLinkInput: $("spotifyLinkInput"),
  embedSpotifyLinkBtn: $("embedSpotifyLinkBtn"),
  openSpotifyLinkBtn: $("openSpotifyLinkBtn"),
  captureSpotifyBtn: $("captureSpotifyBtn"),
  spotifyLinkStatus: $("spotifyLinkStatus"),
  spotifyEmbedPanel: $("spotifyEmbedPanel"),
  spotifyEmbedFrame: $("spotifyEmbedFrame"),
  captureAudioBtn: $("captureAudioBtn"),
  stopCaptureBtn: $("stopCaptureBtn"),
  fileName: $("fileName"),
  playBtn: $("playBtn"),
  pauseBtn: $("pauseBtn"),
  stopBtn: $("stopBtn"),
  seekSlider: $("seekSlider"),
  currentTime: $("currentTime"),
  durationTime: $("durationTime"),
  masterVolume: $("masterVolume"),
  limiterToggle: $("limiterToggle"),
  autoDjToggle: $("autoDjToggle"),
  djBlend: $("djBlend"),
  djBlendValue: $("djBlendValue"),
  djEnergy: $("djEnergy"),
  djEnergyValue: $("djEnergyValue"),
  djFilterSweep: $("djFilterSweep"),
  djFilterSweepValue: $("djFilterSweepValue"),
  bassKillBtn: $("bassKillBtn"),
  vocalKillBtn: $("vocalKillBtn"),
  bassPunchBtn: $("bassPunchBtn"),
  vocalLiftBtn: $("vocalLiftBtn"),
  djResetBtn: $("djResetBtn"),
  autoDjStatus: $("autoDjStatus"),
  bassDeck: document.querySelector('[data-deck="bass"]'),
  vocalDeck: document.querySelector('[data-deck="vocal"]'),
  bassPlatter: $("bassPlatter"),
  vocalPlatter: $("vocalPlatter"),
  bassDeckMeter: $("bassDeckMeter"),
  vocalDeckMeter: $("vocalDeckMeter"),
  deckSourceBadge: $("deckSourceBadge"),
  deckMotionBadge: $("deckMotionBadge"),
  deckScratchBadge: $("deckScratchBadge"),
  threeWayToggle: $("threeWayToggle"),
  vocalIsoToggle: $("vocalIsoToggle"),
  crossoverSlider: $("crossoverSlider"),
  crossoverValue: $("crossoverValue"),
  trebleSplitRow: $("trebleSplitRow"),
  trebleSplitSlider: $("trebleSplitSlider"),
  trebleSplitValue: $("trebleSplitValue"),
  syncTestBtn: $("syncTestBtn"),
  latencyWizardBtn: $("latencyWizardBtn"),
  autoCalibrateBtn: $("autoCalibrateBtn"),
  calibrationPanel: $("calibrationPanel"),
  calibrationStatus: $("calibrationStatus"),
  calibrationProgress: $("calibrationProgress"),
  clipStatus: $("clipStatus"),
  spectrumCanvas: $("spectrumCanvas"),
  eqSliders: $("eqSliders"),
  eqTabs: $("eqTabs"),
  presetStatus: $("presetStatus"),
  presetName: $("presetName"),
  savedPresetSelect: $("savedPresetSelect"),
  savePresetBtn: $("savePresetBtn"),
  loadPresetBtn: $("loadPresetBtn"),
  deletePresetBtn: $("deletePresetBtn"),
  exportPresetBtn: $("exportPresetBtn"),
  importPresetInput: $("importPresetInput"),
  enableDevicesBtn: $("enableDevicesBtn"),
  refreshDevicesBtn: $("refreshDevicesBtn"),
};

const speakerControls = {
  bass: {
    select: $("bassDeviceSelect"),
    volume: $("bassVolume"),
    delay: $("bassDelay"),
    delayValue: $("bassDelayValue"),
    panel: document.querySelector('[data-speaker-panel="bass"]'),
    vu: $("bassVu"),
    vuWrap: document.querySelector('[data-vu="bass"]'),
  },
  vocal: {
    select: $("vocalDeviceSelect"),
    volume: $("vocalVolume"),
    delay: $("vocalDelay"),
    delayValue: $("vocalDelayValue"),
    panel: document.querySelector('[data-speaker-panel="vocal"]'),
    vu: $("vocalVu"),
    vuWrap: document.querySelector('[data-vu="vocal"]'),
  },
  mid: {
    select: $("midDeviceSelect"),
    volume: $("midVolume"),
    delay: $("midDelay"),
    delayValue: $("midDelayValue"),
    panel: document.querySelector('[data-speaker-panel="mid"]'),
    vu: $("midVu"),
    vuWrap: document.querySelector('[data-vu="mid"]'),
  },
  treble: {
    select: $("trebleDeviceSelect"),
    volume: $("trebleVolume"),
    delay: $("trebleDelay"),
    delayValue: $("trebleDelayValue"),
    panel: document.querySelector('[data-speaker-panel="treble"]'),
    vu: $("trebleVu"),
    vuWrap: document.querySelector('[data-vu="treble"]'),
  },
};

let engine = null;
let deviceManager = null;
let visualizer = null;
let selectedEqSpeaker = "bass";
let seeking = false;
let autosaveTimer = null;
let restoringSession = false;
let autoDjFrame = null;
let autoDjLastRun = 0;
let djBaseCrossoverHz = 160;
let playlist = [];
let currentTrackIndex = -1;
let currentTrackId = null;
let trackId = 0;
let autoAdvanceArmed = true;
let scratchState = null;
let draggedTrackId = null;

function setPill(element, message, tone = "ok") {
  element.textContent = message;
  element.classList.toggle("status-pill--warn", tone === "warn");
  element.classList.toggle("status-pill--error", tone === "error");
}

function setEngineStatus(message, tone = "ok") {
  setPill(dom.engineStatus, message, tone);
}

function setDeviceStatus(message, tone = "ok") {
  setPill(dom.deviceStatus, message, tone);
}

function updateDeviceCompatibilityStatus() {
  const compatibility = deviceManager?.getCompatibility?.();
  if (compatibility) {
    setDeviceStatus(compatibility.label, compatibility.tone);
  }
}

function setPresetStatus(message) {
  dom.presetStatus.textContent = message;
}

function queueAutosave() {
  if (!engine || restoringSession) {
    return;
  }

  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    saveLastSession(attachDeviceLabels(engine.getSettings(), deviceManager?.devices || []));
    setPresetStatus("Settings autosaved");
  }, 250);
}

function loadQueuePrefs() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_PREFS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveQueuePrefs() {
  try {
    localStorage.setItem(
      QUEUE_PREFS_KEY,
      JSON.stringify({
        autoBlend: dom.autoBlendToggle.checked,
        blendTime: Number(dom.blendTime.value),
        savedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Private windows or locked-down browser profiles may block storage.
  }
}

function updateTransportAvailability(hasFile) {
  const hasLive = Boolean(engine?.liveStream);
  const hasSource = hasFile || hasLive;
  dom.playBtn.disabled = !hasSource || engine?.isPlaying;
  dom.pauseBtn.disabled = !hasSource || !engine?.isPlaying;
  dom.stopBtn.disabled = !hasSource;
  dom.seekSlider.disabled = !hasFile || hasLive;
  dom.stopCaptureBtn.disabled = !hasLive;
  dom.captureAudioBtn.disabled = hasLive;
  updateQueueUi();
}

function activeUiSpeakerIds() {
  return dom.threeWayToggle.checked ? ["bass", "mid", "treble"] : ["bass", "vocal"];
}

function updateModeUi() {
  const threeWay = dom.threeWayToggle.checked;
  speakerControls.vocal.panel.classList.toggle("is-hidden", threeWay);
  speakerControls.vocal.vuWrap.classList.toggle("is-hidden", threeWay);
  speakerControls.mid.panel.classList.toggle("is-hidden", !threeWay);
  speakerControls.mid.vuWrap.classList.toggle("is-hidden", !threeWay);
  speakerControls.treble.panel.classList.toggle("is-hidden", !threeWay);
  speakerControls.treble.vuWrap.classList.toggle("is-hidden", !threeWay);
  dom.trebleSplitRow.classList.toggle("is-hidden", !threeWay);

  for (const button of dom.eqTabs.querySelectorAll("[data-eq-tab]")) {
    const id = button.dataset.eqTab;
    button.classList.toggle("is-hidden", threeWay ? id === "vocal" : id === "mid" || id === "treble");
  }

  if (!activeUiSpeakerIds().includes(selectedEqSpeaker)) {
    selectedEqSpeaker = "bass";
  }
  renderEq();
}

function renderEq() {
  if (!engine) {
    return;
  }

  const settings = engine.getSettings();
  const speaker = settings.speakers[selectedEqSpeaker];

  for (const button of dom.eqTabs.querySelectorAll("[data-eq-tab]")) {
    button.classList.toggle("is-active", button.dataset.eqTab === selectedEqSpeaker);
  }

  dom.eqSliders.querySelectorAll("input").forEach((input, index) => {
    const value = speaker.eq[index] ?? 0;
    input.max = selectedEqSpeaker === "bass" && index <= 3 ? 0 : EQ_MAX_DB;
    input.value = value;
    input.nextElementSibling.textContent = `${value > 0 ? "+" : ""}${Number(value).toFixed(1)} dB`;
  });
}

function blendLabel(value) {
  if (value < -8) {
    return `${Math.abs(Math.round(value))}% Bass`;
  }
  if (value > 8) {
    return `${Math.round(value)}% Vocal`;
  }
  return "Center";
}

function sweepLabel(value) {
  if (value < -8) {
    return `${Math.abs(Math.round(value))}% Dark`;
  }
  if (value > 8) {
    return `${Math.round(value)}% Bright`;
  }
  return "Open";
}

function getDjSettings() {
  return engine.getSettings().dj;
}

function applyDjOutput() {
  if (!engine) {
    return;
  }

  const settings = engine.getSettings();
  const dj = settings.dj;
  const blend = dj.speakerBlend / 100;
  const energy = dj.energy;
  const sweep = dj.filterSweep / 100;
  const activeIds = activeUiSpeakerIds();

  const bassBase = dj.bassKill ? 0 : 1 + Math.max(0, -blend) * 0.38 - Math.max(0, blend) * 0.58;
  const vocalBase = dj.vocalKill ? 0 : 1 + Math.max(0, blend) * 0.28 - Math.max(0, -blend) * 0.16;
  const bassEnergy = 0.88 + energy * 0.36;
  const vocalEnergy = 0.88 + energy * 0.18;

  engine.setSpeakerDjGain("bass", bassBase * bassEnergy);
  engine.setSpeakerDjGain("vocal", activeIds.includes("vocal") ? vocalBase * vocalEnergy : 0);
  engine.setSpeakerDjGain("mid", activeIds.includes("mid") ? vocalBase * vocalEnergy : 0);
  engine.setSpeakerDjGain("treble", activeIds.includes("treble") ? vocalBase * (0.9 + energy * 0.2) : 0);

  const baseCrossover = djBaseCrossoverHz;
  const nextCrossover = Math.round(Math.min(500, Math.max(70, baseCrossover + sweep * 95)));
  if (Math.abs(nextCrossover - settings.crossoverHz) >= 2) {
    engine.setCrossover(nextCrossover);
    dom.crossoverSlider.value = nextCrossover;
    dom.crossoverValue.textContent = `${nextCrossover} Hz`;
  }
}

function renderDjControls() {
  if (!engine) {
    return;
  }

  const settings = engine.getSettings();
  const dj = settings.dj;
  dom.autoDjToggle.checked = settings.autoDjEnabled;
  dom.djBlend.value = dj.speakerBlend;
  dom.djBlendValue.textContent = blendLabel(dj.speakerBlend);
  dom.djEnergy.value = dj.energy;
  dom.djEnergyValue.textContent = `${Math.round(dj.energy * 100)}%`;
  dom.djFilterSweep.value = dj.filterSweep;
  dom.djFilterSweepValue.textContent = sweepLabel(dj.filterSweep);
  dom.bassKillBtn.classList.toggle("is-active", dj.bassKill);
  dom.vocalKillBtn.classList.toggle("is-active", dj.vocalKill);
  document.querySelector(".dj-panel")?.classList.toggle("is-auto", settings.autoDjEnabled);
  dom.autoDjStatus.textContent = settings.autoDjEnabled ? "Listening" : "Manual mix";
  applyDjOutput();
  updateDeckVisuals();
}

function buildEqControls() {
  dom.eqSliders.innerHTML = "";

  EQ_BANDS.forEach((frequency, index) => {
    const label = document.createElement("label");
    label.className = "eq-band";

    const freq = document.createElement("span");
    freq.textContent = formatHz(frequency);

    const input = document.createElement("input");
    input.type = "range";
    input.min = EQ_MIN_DB;
    input.max = EQ_MAX_DB;
    input.step = "0.1";
    input.value = "0";
    input.addEventListener("input", () => {
      const value = Number(input.value);
      engine.setEqGain(selectedEqSpeaker, index, value);
      const rendered = Number(input.value);
      output.textContent = `${rendered > 0 ? "+" : ""}${rendered.toFixed(1)} dB`;
      queueAutosave();
    });

    const output = document.createElement("output");
    output.textContent = "0.0 dB";

    label.append(freq, input, output);
    dom.eqSliders.append(label);
  });
}

function updateSettingsUi() {
  if (!engine) {
    return;
  }

  const settings = engine.getSettings();
  dom.threeWayToggle.checked = settings.threeWay;
  dom.vocalIsoToggle.checked = settings.vocalIsolation;
  dom.crossoverSlider.value = settings.crossoverHz;
  dom.crossoverValue.textContent = `${Math.round(settings.crossoverHz)} Hz`;
  dom.trebleSplitSlider.value = settings.trebleSplitHz;
  dom.trebleSplitValue.textContent = `${Math.round(settings.trebleSplitHz)} Hz`;
  dom.masterVolume.value = settings.masterVolume;
  dom.limiterToggle.checked = settings.limiterEnabled;
  dom.clipStatus.textContent = settings.limiterEnabled ? "Limiter ready" : "Limiter off";

  for (const id of SPEAKER_IDS) {
    const speaker = settings.speakers[id];
    speakerControls[id].volume.value = speaker.volume;
    speakerControls[id].delay.value = speaker.delayMs;
    speakerControls[id].delayValue.textContent = `${Math.round(speaker.delayMs)} ms`;
    speakerControls[id].select.value = speaker.deviceId || "default";
  }

  updateModeUi();
  renderEq();
  renderDjControls();
}

function updateClock() {
  if (engine) {
    updateDeckVisuals();
    if (engine.liveStream) {
      dom.currentTime.textContent = engine.isPlaying ? "Live" : "Paused";
      dom.durationTime.textContent = "--:--";
      dom.seekSlider.value = 0;
      requestAnimationFrame(updateClock);
      return;
    }

    const current = engine.getCurrentTime();
    const duration = engine.duration || 0;
    dom.currentTime.textContent = formatTime(current);
    dom.durationTime.textContent = formatTime(duration);

    if (!seeking && duration > 0) {
      dom.seekSlider.value = Math.round((current / duration) * 1000);
    }

    const blendSeconds = Number(dom.blendTime.value);
    if (
      engine.isPlaying &&
      dom.autoBlendToggle.checked &&
      autoAdvanceArmed &&
      duration > 0 &&
      blendSeconds > 0 &&
      getNextTrackIndex() >= 0 &&
      duration - current <= blendSeconds
    ) {
      autoAdvanceArmed = false;
      playNextTrack(true);
    }
  }
  requestAnimationFrame(updateClock);
}

function updateDeckVisuals() {
  if (!engine || !dom.bassDeck || !dom.vocalDeck) {
    return;
  }

  const settings = engine.getSettings();
  const levels = engine.getMeterLevels();
  const bassLevel = levels.bass?.rms || 0;
  const vocalLevel = levels.vocal?.rms || levels.mid?.rms || levels.treble?.rms || 0;
  const spinning = engine.isPlaying;
  const speed = Math.max(0.82, 2.3 - settings.dj.energy * 1.15);

  dom.bassDeck.classList.toggle("is-spinning", spinning && !settings.dj.bassKill);
  dom.vocalDeck.classList.toggle("is-spinning", spinning && !settings.dj.vocalKill);
  dom.bassDeck.classList.toggle("is-muted", settings.dj.bassKill);
  dom.vocalDeck.classList.toggle("is-muted", settings.dj.vocalKill);
  dom.bassPlatter?.style.setProperty("--pulse", bassLevel.toFixed(3));
  dom.vocalPlatter?.style.setProperty("--pulse", vocalLevel.toFixed(3));
  dom.bassPlatter?.style.setProperty("--spin-speed", `${speed.toFixed(2)}s`);
  dom.vocalPlatter?.style.setProperty("--spin-speed", `${Math.max(0.78, speed * 0.94).toFixed(2)}s`);
  if (dom.bassDeckMeter) {
    dom.bassDeckMeter.style.width = `${Math.round(bassLevel * 100)}%`;
  }
  if (dom.vocalDeckMeter) {
    dom.vocalDeckMeter.style.width = `${Math.round(vocalLevel * 100)}%`;
  }
  if (dom.deckSourceBadge) {
    dom.deckSourceBadge.textContent = engine.liveStream ? "Live input" : engine.objectUrl ? "File deck" : "No source";
    dom.deckSourceBadge.classList.toggle("is-live", Boolean(engine.liveStream || engine.objectUrl));
  }
  if (dom.deckMotionBadge) {
    dom.deckMotionBadge.textContent = spinning ? "Spinning" : "Stopped";
    dom.deckMotionBadge.classList.toggle("is-live", spinning);
  }
  if (dom.deckScratchBadge && !scratchState) {
    dom.deckScratchBadge.textContent = engine.liveStream ? "Scratch unavailable" : engine.objectUrl ? "Scratch ready" : "Load a song";
    dom.deckScratchBadge.classList.toggle("is-live", Boolean(engine.objectUrl && !engine.liveStream));
  }
}

function averageSpectrumBand(spectrum, analyser, lowHz, highHz) {
  const sampleRate = analyser.context.sampleRate;
  const nyquist = sampleRate / 2;
  const start = Math.max(0, Math.floor((lowHz / nyquist) * spectrum.length));
  const end = Math.min(spectrum.length - 1, Math.ceil((highHz / nyquist) * spectrum.length));
  let sum = 0;
  let count = 0;

  for (let i = start; i <= end; i += 1) {
    sum += spectrum[i] || 0;
    count += 1;
  }

  return count ? sum / count / 255 : 0;
}

function analyzeCrossoverProfile({ bassEntry, vocalEntry, trebleEntry, settings, levels }) {
  const crossover = settings.crossoverHz;
  const bassBodyHigh = Math.max(95, Math.min(210, crossover * 0.95));
  const edgeLow = Math.max(55, crossover * 0.68);
  const edgeHigh = Math.min(620, crossover * 1.65);
  const lowMidLow = Math.max(180, crossover * 1.08);

  const subBand = averageSpectrumBand(bassEntry.spectrum, bassEntry.analyser, 38, 78);
  const punchBand = averageSpectrumBand(bassEntry.spectrum, bassEntry.analyser, 78, bassBodyHigh);
  const bassEdgeBand = averageSpectrumBand(bassEntry.spectrum, bassEntry.analyser, edgeLow, Math.min(500, crossover * 1.08));
  const vocalEdgeBand = averageSpectrumBand(vocalEntry.spectrum, vocalEntry.analyser, Math.max(80, crossover * 0.9), edgeHigh);
  const mudBand = averageSpectrumBand(vocalEntry.spectrum, vocalEntry.analyser, lowMidLow, 520);
  const vocalBand = averageSpectrumBand(vocalEntry.spectrum, vocalEntry.analyser, 700, 3200);
  const airBand = trebleEntry
    ? averageSpectrumBand(trebleEntry.spectrum, trebleEntry.analyser, 5000, 12000)
    : 0.35;

  const bassLevel = levels.bass?.rms || 0;
  const vocalLevel = (levels.vocal?.rms || levels.mid?.rms || 0);
  const bassBody = subBand * 0.45 + punchBand * 0.4 + bassEdgeBand * 0.15;
  const crossoverBody = bassEdgeBand * 0.55 + vocalEdgeBand * 0.45;
  const vocalBody = vocalBand * 0.72 + vocalEdgeBand * 0.18 + airBand * 0.1;
  const crossoverBalance = (bassEdgeBand + 0.035) / (vocalEdgeBand + 0.035);
  const bassNeed = (vocalBody + 0.05) / (bassBody + 0.05);
  const hot = Object.values(levels).some((level) => level.peak > 0.94);

  return {
    airBand,
    bassBody,
    bassEdgeBand,
    bassLevel,
    bassNeed,
    crossoverBalance,
    crossoverBody,
    hot,
    mudBand,
    punchBand,
    subBand,
    vocalBand,
    vocalBody,
    vocalEdgeBand,
    vocalLevel,
  };
}

function getAutoDjStatus(profile) {
  if (profile.hot) {
    return "Protecting headroom";
  }
  if (profile.bassNeed > 1.55 || profile.bassEdgeBand < 0.2) {
    return "Filling crossover";
  }
  if (profile.mudBand > 0.52 || profile.crossoverBalance > 1.65) {
    return "Cleaning low mids";
  }
  if (profile.subBand < 0.18 && profile.vocalBody > 0.34) {
    return "Lifting bass";
  }
  return "Auto balancing";
}

function runAutoDj() {
  if (!engine) {
    autoDjFrame = requestAnimationFrame(runAutoDj);
    return;
  }

  const now = performance.now();
  const settings = engine.getSettings();

  if (settings.autoDjEnabled && engine.isPlaying && now - autoDjLastRun > 850) {
    autoDjLastRun = now;
    const data = engine.getAnalyserData();
    const bassEntry = data.find((entry) => entry.id === "bass");
    const vocalEntry = data.find((entry) => entry.id === "vocal" || entry.id === "mid");
    const trebleEntry = data.find((entry) => entry.id === "treble") || vocalEntry;
    const levels = engine.getMeterLevels();

    if (bassEntry && vocalEntry) {
      const profile = analyzeCrossoverProfile({
        bassEntry,
        vocalEntry,
        trebleEntry,
        settings,
        levels,
      });

      const dj = settings.dj;
      let nextBlend = dj.speakerBlend;
      let nextEnergy = dj.energy;
      let nextSweep = dj.filterSweep;

      if (profile.hot) {
        nextBlend = Math.min(52, nextBlend + 2);
      } else if (profile.mudBand > 0.58 || profile.crossoverBalance > 1.85) {
        nextBlend = Math.min(52, nextBlend + 4);
      } else if (profile.bassNeed > 1.45 || profile.bassEdgeBand < 0.22) {
        nextBlend = Math.max(-64, nextBlend - 5);
      } else if (profile.vocalLevel > profile.bassLevel * 1.28 && profile.subBand < 0.28) {
        nextBlend = Math.max(-58, nextBlend - 4);
      } else if (profile.bassLevel > profile.vocalLevel * 1.8 || profile.bassBody > profile.vocalBody * 1.9) {
        nextBlend = Math.min(46, nextBlend + 3);
      }

      if (profile.hot) {
        nextEnergy = Math.max(0.36, nextEnergy - 0.04);
      } else if (profile.bassNeed > 1.38 || profile.crossoverBody < 0.28) {
        nextEnergy = Math.min(0.92, nextEnergy + 0.035);
      } else if (profile.mudBand > 0.62 && profile.vocalBody < 0.34) {
        nextEnergy = Math.max(0.42, nextEnergy - 0.025);
      }

      if (profile.bassNeed > 1.52 && profile.mudBand < 0.48) {
        nextSweep = Math.min(38, nextSweep + 4);
      } else if (profile.mudBand > 0.5 || profile.crossoverBalance > 1.72 || profile.hot) {
        nextSweep = Math.max(-34, nextSweep - 4);
      } else if (profile.airBand < 0.18 && profile.vocalBand > 0.22) {
        nextSweep = Math.min(32, nextSweep + 2);
      }

      engine.setDjControls({
        speakerBlend: nextBlend,
        energy: nextEnergy,
        filterSweep: nextSweep,
      });
      renderDjControls();
      dom.autoDjStatus.textContent = getAutoDjStatus(profile);
      queueAutosave();
    }
  }

  autoDjFrame = requestAnimationFrame(runAutoDj);
}

function updateDjControl(partial, autosave = true) {
  engine.setDjControls(partial);
  renderDjControls();
  if (autosave) {
    queueAutosave();
  }
}

async function refreshDevices() {
  if (!deviceManager) {
    return;
  }

  try {
    await deviceManager.refresh();
    await restoreRememberedOutputs();
    const settings = engine.getSettings();
    for (const id of SPEAKER_IDS) {
      deviceManager.fillSelect(speakerControls[id].select, settings.speakers[id].deviceId);
    }

    updateDeviceCompatibilityStatus();
  } catch (error) {
    setDeviceStatus(error.message || "Device scan failed", "error");
  }
}

async function restoreRememberedOutputs() {
  if (!engine || !deviceManager) {
    return;
  }

  const settings = engine.getSettings();
  for (const id of SPEAKER_IDS) {
    const speaker = settings.speakers[id];
    const match = deviceManager.findSavedDeviceMatch(speaker);
    const nextDeviceId = match?.deviceId || speaker.deviceId || "default";

    try {
      await engine.setOutputDevice(id, nextDeviceId);
      if (match) {
        engine.settings.speakers[id].deviceId = match.deviceId;
        engine.settings.speakers[id].deviceLabel = match.label;
        engine.settings.speakers[id].groupId = match.groupId || "";
        deviceManager.rememberDevice(match);
      }
    } catch {
      // A remembered device can exist in storage before the browser grants routing permission again.
    }
  }
}

async function chooseOutputForSpeaker(id) {
  const controls = speakerControls[id];
  const previousValue = engine.getSettings().speakers[id].deviceId || "default";

  try {
    if (deviceManager.support.fileMode && !deviceManager.support.selectAudioOutput) {
      throw new Error("Speaker picker is blocked in file mode. Use http://127.0.0.1:5173/ for Bluetooth output selection.");
    }
    setDeviceStatus("Opening speaker picker", "warn");
    const device = await deviceManager.chooseOutputDevice();
    for (const speakerId of SPEAKER_IDS) {
      deviceManager.fillSelect(
        speakerControls[speakerId].select,
        engine.getSettings().speakers[speakerId].deviceId,
      );
    }
    controls.select.value = device.deviceId;
    await applyDeviceSelection(id, device.deviceId);
  } catch (error) {
    controls.select.value = previousValue;
    setDeviceStatus(error.message || "Speaker picker cancelled", "warn");
  }
}

async function applyDeviceSelection(id, deviceId) {
  if (deviceId === deviceManager?.pickerValue) {
    await chooseOutputForSpeaker(id);
    return;
  }

  try {
    const routed = await engine.setOutputDevice(id, deviceId);
    const selected = (deviceManager?.devices || []).find((device) => device.deviceId === deviceId);
    if (selected) {
      engine.settings.speakers[id].deviceLabel = selected.label;
      engine.settings.speakers[id].groupId = selected.groupId || "";
      deviceManager.rememberDevice(selected);
    }
    if (routed) {
      setDeviceStatus("Output changed");
    } else {
      setDeviceStatus("Output selection unavailable", "warn");
    }
    queueAutosave();
  } catch (error) {
    setDeviceStatus(error.message || "Output change failed", "error");
  }
}

function isAudioFile(file) {
  return Boolean(file?.type?.startsWith("audio/") || /\.(mp3|wav|flac|ogg)$/i.test(file?.name || ""));
}

function getNextTrackIndex() {
  if (currentTrackIndex < 0) {
    return playlist.length ? 0 : -1;
  }

  return currentTrackIndex + 1 < playlist.length ? currentTrackIndex + 1 : -1;
}

function updateQueueUi() {
  if (!dom.queueList) {
    return;
  }

  const nextIndex = getNextTrackIndex();
  dom.nextTrackBtn.disabled = nextIndex < 0 || Boolean(engine?.liveStream);
  dom.clearQueueBtn.disabled = playlist.length === 0;
  dom.blendTimeValue.textContent = `${Number(dom.blendTime.value)} s`;
  dom.nextTrackLabel.textContent = nextIndex >= 0 ? `Next: ${playlist[nextIndex].name}` : "Next: none";

  dom.queueList.replaceChildren();
  if (!playlist.length) {
    const empty = document.createElement("div");
    empty.className = "queue-empty";
    empty.textContent = "Add a few songs and the next one will be preselected.";
    dom.queueList.append(empty);
    return;
  }

  playlist.forEach((track, index) => {
    const item = document.createElement("div");
    item.className = "queue-item";
    item.draggable = !engine?.liveStream;
    item.dataset.trackId = String(track.id);
    item.classList.toggle("is-current", index === currentTrackIndex);
    item.classList.toggle("is-next", index === nextIndex);
    item.addEventListener("dragstart", (event) => {
      draggedTrackId = track.id;
      item.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(track.id));
    });
    item.addEventListener("dragend", () => {
      draggedTrackId = null;
      item.classList.remove("is-dragging");
    });
    item.addEventListener("dragover", (event) => {
      if (!draggedTrackId || draggedTrackId === track.id) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      item.classList.add("is-drop-target");
    });
    item.addEventListener("dragleave", () => {
      item.classList.remove("is-drop-target");
    });
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      item.classList.remove("is-drop-target");
      const sourceId = Number(event.dataTransfer.getData("text/plain") || draggedTrackId);
      moveTrackById(sourceId, track.id);
    });

    const number = document.createElement("span");
    number.className = "queue-index";
    number.textContent = String(index + 1).padStart(2, "0");

    const title = document.createElement("button");
    title.className = "button queue-title";
    title.type = "button";
    title.textContent = track.name;
    title.disabled = Boolean(engine?.liveStream);
    title.addEventListener("click", () => {
      loadTrack(index, { autoplay: Boolean(engine?.isPlaying) });
    });

    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "button button--small queue-badge";
    badge.disabled = Boolean(engine?.liveStream);
    if (index === currentTrackIndex) {
      badge.textContent = "Now";
      badge.classList.add("is-hot");
      badge.disabled = true;
    } else if (index === nextIndex) {
      badge.textContent = "Next";
      badge.classList.add("is-next");
      badge.disabled = true;
    } else {
      badge.textContent = "Preselect";
      badge.addEventListener("click", () => preselectTrack(index));
    }

    const orderControls = document.createElement("div");
    orderControls.className = "queue-order";

    const upButton = document.createElement("button");
    upButton.className = "button button--small queue-move";
    upButton.type = "button";
    upButton.textContent = "Up";
    upButton.disabled = index === 0 || Boolean(engine?.liveStream);
    upButton.addEventListener("click", () => moveTrack(index, index - 1));

    const downButton = document.createElement("button");
    downButton.className = "button button--small queue-move";
    downButton.type = "button";
    downButton.textContent = "Down";
    downButton.disabled = index === playlist.length - 1 || Boolean(engine?.liveStream);
    downButton.addEventListener("click", () => moveTrack(index, index + 1));

    const removeButton = document.createElement("button");
    removeButton.className = "button button--small queue-remove";
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.disabled = Boolean(engine?.liveStream);
    removeButton.addEventListener("click", () => removeTrack(index));

    orderControls.append(upButton, downButton, removeButton);
    item.append(number, title, orderControls, badge);
    dom.queueList.append(item);
  });
}

function syncCurrentTrackIndex() {
  currentTrackIndex = currentTrackId ? playlist.findIndex((item) => item.id === currentTrackId) : currentTrackIndex;
  if (currentTrackIndex < 0 && playlist.length && engine?.objectUrl) {
    currentTrackIndex = 0;
    currentTrackId = playlist[0].id;
  }
}

function moveTrack(fromIndex, toIndex) {
  if (
    fromIndex < 0 ||
    fromIndex >= playlist.length ||
    toIndex < 0 ||
    toIndex >= playlist.length ||
    fromIndex === toIndex
  ) {
    return;
  }

  const [track] = playlist.splice(fromIndex, 1);
  playlist.splice(toIndex, 0, track);
  syncCurrentTrackIndex();
  updateQueueUi();
  setEngineStatus(`Moved ${track.name}`);
}

function moveTrackById(sourceId, targetId) {
  const fromIndex = playlist.findIndex((item) => item.id === sourceId);
  const toIndex = playlist.findIndex((item) => item.id === targetId);
  moveTrack(fromIndex, toIndex);
}

async function removeTrack(index) {
  const track = playlist[index];
  if (!track) {
    return;
  }

  const removingCurrent = track.id === currentTrackId;
  const wasPlaying = Boolean(engine?.isPlaying);
  playlist.splice(index, 1);

  if (!removingCurrent) {
    syncCurrentTrackIndex();
    updateQueueUi();
    setEngineStatus(`Removed ${track.name}`, "warn");
    return;
  }

  if (engine) {
    engine.stop();
  }

  currentTrackId = null;
  currentTrackIndex = -1;
  autoAdvanceArmed = true;

  if (playlist.length) {
    const nextIndex = Math.min(index, playlist.length - 1);
    await loadTrack(nextIndex, { autoplay: wasPlaying });
    setEngineStatus(`Removed ${track.name}`);
    return;
  }

  dom.fileName.textContent = "MP3, WAV, FLAC, OGG, or a full playlist";
  updateTransportAvailability(false);
  updateQueueUi();
  setEngineStatus("Queue empty", "warn");
}

async function loadTrack(index, options = {}) {
  const track = playlist[index];
  if (!track || !engine) {
    return;
  }

  const wasPlaying = options.autoplay ?? engine.isPlaying;
  setEngineStatus("Loading audio", "warn");
  try {
    await engine.loadFile(track.file);
    currentTrackIndex = index;
    currentTrackId = track.id;
    autoAdvanceArmed = true;
    dom.fileName.textContent = track.name;
    updateTransportAvailability(true);
    setEngineStatus(wasPlaying ? "Blending next track" : "Ready");
    if (wasPlaying) {
      await engine.play();
      setEngineStatus("Playing");
    }
  } catch (error) {
    updateTransportAvailability(false);
    setEngineStatus(error.message || "Could not load file", "error");
  }
  updateQueueUi();
}

async function handleAudioFiles(files) {
  const audioFiles = [...(files || [])].filter(isAudioFile);
  if (!audioFiles.length) {
    setEngineStatus("No audio files found", "warn");
    return;
  }

  const shouldLoadFirst = currentTrackIndex < 0 && !engine?.objectUrl && !engine?.liveStream;
  for (const file of audioFiles) {
    playlist.push({ id: ++trackId, file, name: file.name });
  }

  updateQueueUi();
  setEngineStatus(audioFiles.length === 1 ? "Song added" : `${audioFiles.length} songs added`);

  if (shouldLoadFirst) {
    await loadTrack(0, { autoplay: false });
  }
}

function preselectTrack(index) {
  if (index < 0 || index >= playlist.length || index === currentTrackIndex) {
    return;
  }

  if (currentTrackIndex < 0) {
    loadTrack(index, { autoplay: false });
    return;
  }

  const [track] = playlist.splice(index, 1);
  const activeIndex = playlist.findIndex((item) => item.id === currentTrackId);
  const insertAt = activeIndex >= 0 ? activeIndex + 1 : Math.min(currentTrackIndex + 1, playlist.length);
  playlist.splice(insertAt, 0, track);
  currentTrackIndex = playlist.findIndex((item) => item.id === currentTrackId);
  updateQueueUi();
  setEngineStatus(`Preselected ${track.name}`);
}

async function playNextTrack(autoplay = Boolean(engine?.isPlaying)) {
  const nextIndex = getNextTrackIndex();
  if (nextIndex < 0) {
    setEngineStatus("End of queue", "warn");
    updateQueueUi();
    return false;
  }

  await loadTrack(nextIndex, { autoplay });
  return true;
}

function clearQueue() {
  playlist = [];
  currentTrackIndex = -1;
  currentTrackId = null;
  autoAdvanceArmed = true;
  updateQueueUi();
  if (!engine?.objectUrl && !engine?.liveStream) {
    dom.fileName.textContent = "MP3, WAV, FLAC, OGG, or a full playlist";
  }
}

function setSpotifyLinkStatus(message, tone = "ready") {
  if (!dom.spotifyLinkStatus) {
    return;
  }

  dom.spotifyLinkStatus.textContent = message;
  dom.spotifyLinkStatus.classList.toggle("is-ready", tone === "ready");
  dom.spotifyLinkStatus.classList.toggle("is-warn", tone === "warn");
}

function parseSpotifyLink(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new Error("Paste a Spotify track, album, or playlist link first.");
  }

  if (raw.startsWith("spotify:")) {
    const parts = raw.split(":");
    if (parts.length >= 3 && isEmbeddableSpotifyType(parts[1])) {
      return `https://open.spotify.com/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}`;
    }
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That does not look like a Spotify link.");
  }

  const allowedHosts = new Set(["open.spotify.com", "play.spotify.com"]);
  if (!allowedHosts.has(url.hostname)) {
    throw new Error("Use an open.spotify.com link.");
  }

  return url.toString();
}

function isEmbeddableSpotifyType(type) {
  return ["track", "album", "playlist", "artist", "show", "episode"].includes(type);
}

function getSpotifyEmbedUrl(value) {
  const spotifyUrl = new URL(parseSpotifyLink(value));
  const segments = spotifyUrl.pathname.split("/").filter(Boolean);
  let typeIndex = segments.findIndex((segment) => isEmbeddableSpotifyType(segment));

  // Older playlist links can look like /user/{name}/playlist/{id}.
  if (typeIndex < 0 && segments[0] === "user") {
    typeIndex = segments.findIndex((segment) => segment === "playlist");
  }

  const type = segments[typeIndex];
  const id = segments[typeIndex + 1];
  if (!isEmbeddableSpotifyType(type) || !id) {
    throw new Error("Use a Spotify track, album, artist, show, episode, or playlist link.");
  }

  return `https://open.spotify.com/embed/${encodeURIComponent(type)}/${encodeURIComponent(id)}?utm_source=speaker_splitter_pro&theme=0`;
}

function embedSpotifyLink() {
  try {
    const embedUrl = getSpotifyEmbedUrl(dom.spotifyLinkInput.value);
    dom.spotifyEmbedFrame.src = embedUrl;
    dom.spotifyEmbedPanel.classList.remove("is-hidden");
    setSpotifyLinkStatus("Embedded player ready", "ready");
    setEngineStatus("Play Spotify, then capture audio", "warn");
  } catch (error) {
    setSpotifyLinkStatus(error.message || "Invalid link", "warn");
  }
}

function openSpotifyLink() {
  try {
    const url = parseSpotifyLink(dom.spotifyLinkInput.value);
    window.open(url, "_blank", "noopener,noreferrer");
    setSpotifyLinkStatus("Opened. Capture that tab.", "ready");
    setEngineStatus("Open Spotify, then capture tab audio", "warn");
  } catch (error) {
    setSpotifyLinkStatus(error.message || "Invalid link", "warn");
  }
}

async function captureSpotifyLinkAudio() {
  try {
    if (!dom.spotifyEmbedFrame.src) {
      embedSpotifyLink();
    }
    parseSpotifyLink(dom.spotifyLinkInput.value);
    setSpotifyLinkStatus("Choose this tab or Spotify tab", "ready");
  } catch (error) {
    setSpotifyLinkStatus(error.message || "Invalid link", "warn");
  }
  await captureLiveAudio();
}

async function captureLiveAudio() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    setEngineStatus("Live capture unsupported", "error");
    return;
  }

  setEngineStatus("Choose an audio source", "warn");
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
      },
    });

    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("No audio was shared. Enable tab/system audio in the picker.");
    }

    await engine.loadLiveStream(stream);
    dom.fileName.textContent = "Live input capture";
    dom.seekSlider.value = 0;
    dom.currentTime.textContent = "Live";
    dom.durationTime.textContent = "--:--";
    updateTransportAvailability(false);
    setEngineStatus("Live input: mute/reroute source", "warn");
  } catch (error) {
    setEngineStatus(error.message || "Live capture cancelled", "warn");
    updateTransportAvailability(Boolean(engine?.objectUrl));
  }
}

function stopLiveAudio() {
  engine.stopLiveCapture();
  dom.fileName.textContent = engine.file?.name || "MP3, WAV, FLAC, or OGG";
  updateTransportAvailability(Boolean(engine.objectUrl));
  setEngineStatus(engine.objectUrl ? "Ready" : "No file loaded", engine.objectUrl ? "ok" : "warn");
}

function wireDropZone() {
  dom.chooseFileBtn.addEventListener("click", () => dom.fileInput.click());
  dom.captureAudioBtn.addEventListener("click", captureLiveAudio);
  dom.embedSpotifyLinkBtn.addEventListener("click", embedSpotifyLink);
  dom.openSpotifyLinkBtn.addEventListener("click", openSpotifyLink);
  dom.captureSpotifyBtn.addEventListener("click", captureSpotifyLinkAudio);
  dom.spotifyLinkInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      embedSpotifyLink();
    }
  });
  dom.stopCaptureBtn.addEventListener("click", stopLiveAudio);
  dom.dropZone.addEventListener("click", (event) => {
    if (event.target !== dom.chooseFileBtn) {
      dom.fileInput.click();
    }
  });
  dom.dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      dom.fileInput.click();
    }
  });
  dom.fileInput.addEventListener("change", () => {
    handleAudioFiles(dom.fileInput.files);
    dom.fileInput.value = "";
  });

  dom.autoBlendToggle.addEventListener("change", () => {
    saveQueuePrefs();
    updateQueueUi();
  });
  dom.blendTime.addEventListener("input", () => {
    saveQueuePrefs();
    updateQueueUi();
  });
  dom.nextTrackBtn.addEventListener("click", () => {
    playNextTrack(Boolean(engine?.isPlaying));
  });
  dom.clearQueueBtn.addEventListener("click", clearQueue);

  for (const eventName of ["dragenter", "dragover"]) {
    dom.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dom.dropZone.classList.add("is-dragging");
    });
  }

  for (const eventName of ["dragleave", "drop"]) {
    dom.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dom.dropZone.classList.remove("is-dragging");
    });
  }

  dom.dropZone.addEventListener("drop", (event) => {
    handleAudioFiles(event.dataTransfer.files);
  });
}

function wireTransport() {
  dom.playBtn.addEventListener("click", async () => {
    try {
      await engine.play();
      setEngineStatus("Playing");
    } catch (error) {
      setEngineStatus(error.message || "Playback failed", "error");
    }
  });

  dom.pauseBtn.addEventListener("click", () => {
    engine.pause();
    setEngineStatus("Paused", "warn");
  });

  dom.stopBtn.addEventListener("click", () => {
    engine.stop();
    setEngineStatus("Stopped", "warn");
  });

  dom.seekSlider.addEventListener("pointerdown", () => {
    seeking = true;
  });
  dom.seekSlider.addEventListener("pointerup", () => {
    seeking = false;
  });
  dom.seekSlider.addEventListener("input", () => {
    const duration = engine.duration || 0;
    engine.setCurrentTime((Number(dom.seekSlider.value) / 1000) * duration);
  });

  dom.masterVolume.addEventListener("input", () => {
    engine.setMasterVolume(Number(dom.masterVolume.value));
    queueAutosave();
  });

  dom.limiterToggle.addEventListener("change", () => {
    engine.setLimiterEnabled(dom.limiterToggle.checked);
    dom.clipStatus.textContent = dom.limiterToggle.checked ? "Limiter ready" : "Limiter off";
    queueAutosave();
  });
}

function wireSpeakerControls() {
  for (const id of SPEAKER_IDS) {
    const controls = speakerControls[id];
    controls.select.addEventListener("change", () => applyDeviceSelection(id, controls.select.value));
    controls.volume.addEventListener("input", () => {
      engine.setSpeakerVolume(id, Number(controls.volume.value));
      queueAutosave();
    });
    controls.delay.addEventListener("input", () => {
      const delay = Number(controls.delay.value);
      engine.setSpeakerDelay(id, delay);
      controls.delayValue.textContent = `${delay} ms`;
      queueAutosave();
    });
  }

  dom.threeWayToggle.addEventListener("change", async () => {
    try {
      await engine.setThreeWay(dom.threeWayToggle.checked);
      updateModeUi();
      applyDjOutput();
      setEngineStatus(dom.threeWayToggle.checked ? "Three-way mode" : "Two-way mode", "warn");
      queueAutosave();
    } catch (error) {
      setEngineStatus(error.message || "Mode change failed", "error");
    }
  });

  dom.vocalIsoToggle.addEventListener("change", () => {
    engine.setVocalIsolation(dom.vocalIsoToggle.checked);
    queueAutosave();
  });

  dom.crossoverSlider.addEventListener("input", () => {
    const value = Number(dom.crossoverSlider.value);
    djBaseCrossoverHz = value;
    dom.crossoverValue.textContent = `${value} Hz`;
    engine.setCrossover(value);
    queueAutosave();
  });

  dom.trebleSplitSlider.addEventListener("input", () => {
    const value = Number(dom.trebleSplitSlider.value);
    dom.trebleSplitValue.textContent = `${value} Hz`;
    engine.setTrebleSplit(value);
    queueAutosave();
  });

  dom.enableDevicesBtn.addEventListener("click", async () => {
    setDeviceStatus("Requesting access", "warn");
    try {
      await deviceManager.requestAccess();
      await refreshDevices();
    } catch (error) {
      setDeviceStatus(error.message || "Permission request failed", "error");
    }
  });

  dom.refreshDevicesBtn.addEventListener("click", refreshDevices);
}

function wireEq() {
  dom.eqTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-eq-tab]");
    if (!button) {
      return;
    }

    selectedEqSpeaker = button.dataset.eqTab;
    renderEq();
  });
}

function wireDjControls() {
  dom.autoDjToggle.addEventListener("change", () => {
    engine.setAutoDjEnabled(dom.autoDjToggle.checked);
    renderDjControls();
    queueAutosave();
  });

  dom.djBlend.addEventListener("input", () => {
    updateDjControl({ speakerBlend: Number(dom.djBlend.value) });
  });

  dom.djEnergy.addEventListener("input", () => {
    updateDjControl({ energy: Number(dom.djEnergy.value) });
  });

  dom.djFilterSweep.addEventListener("input", () => {
    updateDjControl({ filterSweep: Number(dom.djFilterSweep.value) });
  });

  dom.bassKillBtn.addEventListener("click", () => {
    const dj = getDjSettings();
    updateDjControl({ bassKill: !dj.bassKill });
  });

  dom.vocalKillBtn.addEventListener("click", () => {
    const dj = getDjSettings();
    updateDjControl({ vocalKill: !dj.vocalKill });
  });

  dom.bassPunchBtn.addEventListener("click", () => {
    updateDjControl({
      bassKill: false,
      speakerBlend: Math.max(-45, getDjSettings().speakerBlend - 24),
      energy: Math.min(0.78, getDjSettings().energy + 0.08),
      filterSweep: Math.max(-25, getDjSettings().filterSweep - 8),
    });
    dom.autoDjStatus.textContent = "Bass punch";
  });

  dom.vocalLiftBtn.addEventListener("click", () => {
    updateDjControl({
      vocalKill: false,
      speakerBlend: Math.min(55, getDjSettings().speakerBlend + 24),
      filterSweep: Math.min(35, getDjSettings().filterSweep + 12),
    });
    dom.autoDjStatus.textContent = "Vocal lift";
  });

  dom.djResetBtn.addEventListener("click", () => {
    engine.setAutoDjEnabled(false);
    updateDjControl({
      speakerBlend: 0,
      energy: 0.5,
      filterSweep: 0,
      bassKill: false,
      vocalKill: false,
    });
    dom.autoDjStatus.textContent = "Manual mix";
  });
}

function getPointerAngle(event, element) {
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return Math.atan2(event.clientY - centerY, event.clientX - centerX);
}

function shortestAngleDelta(nextAngle, previousAngle) {
  let delta = nextAngle - previousAngle;
  while (delta > Math.PI) {
    delta -= Math.PI * 2;
  }
  while (delta < -Math.PI) {
    delta += Math.PI * 2;
  }
  return delta;
}

function canScratchDeck() {
  return Boolean(engine?.objectUrl && !engine.liveStream);
}

async function startScratch(event) {
  if (!canScratchDeck()) {
    setEngineStatus(engine?.liveStream ? "Live input cannot be scratched" : "Load a song to scratch", "warn");
    return;
  }

  event.preventDefault();
  const platter = event.currentTarget;
  const now = performance.now();
  scratchState = {
    pointerId: event.pointerId,
    platter,
    wasPlaying: engine.isPlaying,
    lastAngle: getPointerAngle(event, platter),
    lastTime: now,
    rotation: 0,
  };

  platter.setPointerCapture?.(event.pointerId);
  platter.classList.add("is-scratching");
  dom.deckScratchBadge.textContent = "Scratching";
  dom.deckScratchBadge.classList.add("is-live");
  engine.setPlaybackRate(0.45);

  if (!scratchState.wasPlaying) {
    try {
      await engine.play();
    } catch (error) {
      scratchState = null;
      platter.classList.remove("is-scratching");
      setEngineStatus(error.message || "Scratch failed", "error");
    }
  }
}

function moveScratch(event) {
  if (!scratchState || scratchState.pointerId !== event.pointerId || !canScratchDeck()) {
    return;
  }

  event.preventDefault();
  const angle = getPointerAngle(event, scratchState.platter);
  const delta = shortestAngleDelta(angle, scratchState.lastAngle);
  const now = performance.now();
  const elapsed = Math.max(8, now - scratchState.lastTime);
  const velocity = Math.abs(delta) / elapsed;
  const rate = Math.min(3.4, Math.max(0.28, 0.35 + velocity * 720));

  scratchState.rotation += (delta * 180) / Math.PI;
  scratchState.lastAngle = angle;
  scratchState.lastTime = now;
  scratchState.platter.style.setProperty("--scratch-rotation", `${scratchState.rotation.toFixed(1)}deg`);

  // Jumping time in small circular increments creates the audible scratch/jog effect.
  engine.setPlaybackRate(rate);
  engine.nudgeCurrentTime(delta * 0.38);
}

function endScratch(event) {
  if (!scratchState || scratchState.pointerId !== event.pointerId) {
    return;
  }

  const { platter, wasPlaying } = scratchState;
  scratchState = null;
  platter.releasePointerCapture?.(event.pointerId);
  platter.classList.remove("is-scratching");
  engine.setPlaybackRate(1);

  if (!wasPlaying) {
    engine.pause();
    setEngineStatus("Scratch paused", "warn");
  } else {
    setEngineStatus("Playing");
  }
  updateDeckVisuals();
}

function jogDeck(seconds) {
  if (!canScratchDeck()) {
    setEngineStatus(engine?.liveStream ? "Live input cannot be jogged" : "Load a song to jog", "warn");
    return;
  }

  engine.nudgeCurrentTime(seconds);
  setEngineStatus(seconds > 0 ? "Jog forward" : "Jog back", "warn");
}

function wireScratchDecks() {
  for (const platter of [dom.bassPlatter, dom.vocalPlatter]) {
    if (!platter) {
      continue;
    }

    platter.addEventListener("pointerdown", startScratch);
    platter.addEventListener("pointermove", moveScratch);
    platter.addEventListener("pointerup", endScratch);
    platter.addEventListener("pointercancel", endScratch);
    platter.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        jogDeck(-0.22);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        jogDeck(0.22);
      }
    });
  }
}

function setCalibrationVisible(visible) {
  dom.calibrationPanel.classList.toggle("is-hidden", !visible);
}

function calibrationCallbacks() {
  setCalibrationVisible(true);
  return {
    status(message) {
      dom.calibrationStatus.textContent = message;
    },
    progress(value) {
      dom.calibrationProgress.value = value;
    },
  };
}

function wireSyncTools() {
  dom.syncTestBtn.addEventListener("click", async () => {
    try {
      await engine.playSyncTest();
      setEngineStatus("Sync test");
    } catch (error) {
      setEngineStatus(error.message || "Sync test failed", "error");
    }
  });

  dom.latencyWizardBtn.addEventListener("click", async () => {
    try {
      await runLatencyWizard(engine, calibrationCallbacks());
      setEngineStatus("Wizard complete", "warn");
    } catch (error) {
      setEngineStatus(error.message || "Wizard failed", "error");
    }
  });

  dom.autoCalibrateBtn.addEventListener("click", async () => {
    try {
      const result = await runMicrophoneCalibration(engine, calibrationCallbacks());
      updateSettingsUi();
      setEngineStatus(
        result.verificationSpreadMs <= 8
          ? "Precision calibrated"
          : "Calibrated; run Sync Test",
        result.verificationSpreadMs <= 8 ? "ok" : "warn",
      );
      queueAutosave();
    } catch (error) {
      updateSettingsUi();
      setEngineStatus(error.message || "Calibration failed", "error");
    }
  });
}

function refreshSavedPresetSelect() {
  const saved = listSavedPresets();
  dom.savedPresetSelect.innerHTML = "";

  if (!saved.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No saved presets";
    dom.savedPresetSelect.append(option);
    dom.loadPresetBtn.disabled = true;
    dom.deletePresetBtn.disabled = true;
    return;
  }

  for (const preset of saved) {
    const option = document.createElement("option");
    option.value = preset.name;
    option.textContent = preset.name;
    dom.savedPresetSelect.append(option);
  }
  dom.loadPresetBtn.disabled = false;
  dom.deletePresetBtn.disabled = false;
}

async function applyPreset(settings) {
  engine.applySettings(settings);
  djBaseCrossoverHz = engine.getSettings().crossoverHz;
  updateSettingsUi();

  // Device IDs are part of presets, but routing can fail after hardware changes.
  for (const id of SPEAKER_IDS) {
    try {
      await engine.setOutputDevice(id, engine.getSettings().speakers[id].deviceId);
    } catch {
      // Keep the audio settings even if a remembered device is gone.
    }
  }

  await refreshDevices();
  updateSettingsUi();
  renderDjControls();
  queueAutosave();
}

async function applyFactoryPreset(preset) {
  const current = engine.getSettings();
  const settings = {
    ...preset,
    threeWay: current.threeWay,
    speakers: {},
  };

  for (const id of SPEAKER_IDS) {
    settings.speakers[id] = {
      ...preset.speakers[id],
      deviceId: current.speakers[id].deviceId,
      delayMs: current.speakers[id].delayMs,
    };
  }

  await applyPreset(settings);
}

function wirePresets() {
  dom.savePresetBtn.addEventListener("click", () => {
    try {
      const name = dom.presetName.value.trim();
      savePreset(name, engine.getSettings());
      refreshSavedPresetSelect();
      dom.savedPresetSelect.value = name;
      setPresetStatus("Preset saved");
    } catch (error) {
      setPresetStatus(error.message || "Save failed");
    }
  });

  dom.loadPresetBtn.addEventListener("click", async () => {
    const name = dom.savedPresetSelect.value;
    const preset = listSavedPresets().find((item) => item.name === name);
    if (preset) {
      await applyPreset(preset.settings);
      setPresetStatus("Preset loaded");
    }
  });

  dom.deletePresetBtn.addEventListener("click", () => {
    const name = dom.savedPresetSelect.value;
    if (!name) {
      return;
    }
    deletePreset(name);
    refreshSavedPresetSelect();
    setPresetStatus("Preset deleted");
  });

  dom.exportPresetBtn.addEventListener("click", () => {
    const blob = exportPresetBlob(engine.getSettings());
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const name = engine.getSettings().name || "speaker-splitter-preset";
    anchor.href = url;
    anchor.download = `${name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setPresetStatus("Preset exported");
  });

  dom.importPresetInput.addEventListener("change", async () => {
    const file = dom.importPresetInput.files?.[0];
    if (!file) {
      return;
    }

    try {
      const settings = await parsePresetFile(file);
      await applyPreset(settings);
      if (settings.name) {
        savePreset(settings.name, settings);
        refreshSavedPresetSelect();
        dom.savedPresetSelect.value = settings.name;
      }
      setPresetStatus("Preset imported");
    } catch (error) {
      setPresetStatus(error.message || "Import failed");
    } finally {
      dom.importPresetInput.value = "";
    }
  });

  document.querySelectorAll("[data-factory-preset]").forEach((button) => {
    button.addEventListener("click", async () => {
      const preset = FACTORY_PRESETS[button.dataset.factoryPreset];
      await applyFactoryPreset(preset);
      setPresetStatus(`${preset.name} preset applied`);
    });
  });
}

async function init() {
  buildEqControls();
  updateTransportAvailability(false);
  const queuePrefs = loadQueuePrefs();
  if (typeof queuePrefs.autoBlend === "boolean") {
    dom.autoBlendToggle.checked = queuePrefs.autoBlend;
  }
  if (Number.isFinite(Number(queuePrefs.blendTime))) {
    dom.blendTime.value = Math.min(12, Math.max(0, Number(queuePrefs.blendTime)));
  }
  updateQueueUi();

  try {
    engine = new AudioEngine();
    await engine.initialize();
  } catch (error) {
    setEngineStatus(error.message || "Web Audio unavailable", "error");
    document.querySelectorAll("button, input, select").forEach((element) => {
      if (element !== dom.chooseFileBtn) {
        element.disabled = true;
      }
    });
    return;
  }

  deviceManager = new DeviceManager();
  visualizer = new SpectrumVisualizer({
    canvas: dom.spectrumCanvas,
    vuElements: Object.fromEntries(SPEAKER_IDS.map((id) => [id, speakerControls[id].vu])),
    clipStatus: dom.clipStatus,
    engine,
  });
  visualizer.start();

  wireDropZone();
  wireTransport();
  wireSpeakerControls();
  wireEq();
  wireDjControls();
  wireScratchDecks();
  wireSyncTools();
  wirePresets();

  engine.addEventListener("playstate", () => {
    updateTransportAvailability(Boolean(engine.objectUrl));
    updateDeckVisuals();
  });
  engine.addEventListener("liveinput", () => {
    updateTransportAvailability(Boolean(engine.objectUrl));
    updateDeckVisuals();
    if (!engine.liveStream && !engine.objectUrl) {
      dom.fileName.textContent = "MP3, WAV, FLAC, or OGG";
      setEngineStatus("No file loaded", "warn");
    }
  });
  engine.addEventListener("settingschange", () => {
    // The controls update their own live values while dragging; preset loads use full render.
  });
  engine.addEventListener("ended", () => {
    playNextTrack(true).then((advanced) => {
      if (!advanced) {
        setEngineStatus("Ended", "warn");
      }
    });
  });

  refreshSavedPresetSelect();
  const lastSession = loadLastSession();
  if (lastSession) {
    restoringSession = true;
    deviceManager.rememberDevices(loadLastSessionDevices());
    engine.applySettings(lastSession);
    djBaseCrossoverHz = engine.getSettings().crossoverHz;
    restoringSession = false;
    setPresetStatus("Last session restored");
  }

  updateSettingsUi();
  await refreshDevices();
  for (const id of SPEAKER_IDS) {
    try {
      await engine.setOutputDevice(id, engine.getSettings().speakers[id].deviceId);
    } catch {
      // A remembered Bluetooth device may need Enable Devices before the browser can reuse it.
    }
  }
  await refreshDevices();
  updateClock();
  if (!autoDjFrame) {
    runAutoDj();
  }
  setEngineStatus("No file loaded", "warn");
}

init();
