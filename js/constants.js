export const SPEAKER_IDS = ["bass", "vocal", "mid", "treble"];

export const ACTIVE_TWO_WAY = ["bass", "vocal"];
export const ACTIVE_THREE_WAY = ["bass", "mid", "treble"];

export const SPEAKER_LABELS = {
  bass: "Bass",
  vocal: "Vocal/Treble",
  mid: "Midrange",
  treble: "Treble",
};

export const EQ_BANDS = [
  31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
];

export const EQ_MIN_DB = -12;
export const EQ_MAX_DB = 12;
export const MAX_DELAY_MS = 1000;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

export function dbToGain(db) {
  return Math.pow(10, db / 20);
}

export function formatHz(value) {
  if (value >= 1000) {
    return `${Number(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} kHz`;
  }
  return `${Math.round(value)} Hz`;
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, "0");
  return `${minutes}:${secs}`;
}

export function createEmptyEq() {
  return EQ_BANDS.map(() => 0);
}

export function createDefaultSettings() {
  const speaker = () => ({
    deviceId: "default",
    volume: 1,
    delayMs: 0,
    eq: createEmptyEq(),
  });

  return {
    version: 1,
    name: "Default",
    threeWay: false,
    vocalIsolation: false,
    crossoverHz: 160,
    trebleSplitHz: 3500,
    masterVolume: 1,
    limiterEnabled: true,
    autoDjEnabled: false,
    liveMicSyncEnabled: false,
    dj: {
      speakerBlend: 0,
      energy: 0.5,
      filterSweep: 0,
      bassKill: false,
      vocalKill: false,
    },
    speakers: {
      bass: speaker(),
      vocal: speaker(),
      mid: speaker(),
      treble: speaker(),
    },
  };
}

export function mergeSettings(partial) {
  const base = createDefaultSettings();
  const next = {
    ...base,
    ...(partial || {}),
    speakers: { ...base.speakers },
  };

  for (const id of SPEAKER_IDS) {
    next.speakers[id] = {
      ...base.speakers[id],
      ...((partial && partial.speakers && partial.speakers[id]) || {}),
    };

    // EQ arrays are normalized so older presets never break the 10-band UI.
    next.speakers[id].eq = EQ_BANDS.map((_, index) => {
      const maxBoost = id === "bass" && index <= 3 ? 0 : EQ_MAX_DB;
      return clamp(next.speakers[id].eq[index] ?? 0, EQ_MIN_DB, maxBoost);
    });
    next.speakers[id].volume = clamp(next.speakers[id].volume, 0, id === "bass" ? 1 : 1.5);
    next.speakers[id].delayMs = clamp(next.speakers[id].delayMs, 0, MAX_DELAY_MS);
  }

  next.crossoverHz = clamp(next.crossoverHz, 50, 500);
  next.trebleSplitHz = clamp(next.trebleSplitHz, 1000, 8000);
  next.masterVolume = clamp(next.masterVolume, 0, 1.5);
  next.limiterEnabled = next.limiterEnabled !== false;
  next.autoDjEnabled = Boolean(next.autoDjEnabled);
  next.liveMicSyncEnabled = Boolean(next.liveMicSyncEnabled);
  next.dj = {
    ...base.dj,
    ...((partial && partial.dj) || {}),
  };
  next.dj.speakerBlend = clamp(next.dj.speakerBlend, -100, 100);
  next.dj.energy = clamp(next.dj.energy, 0, 1);
  next.dj.filterSweep = clamp(next.dj.filterSweep, -100, 100);
  next.dj.bassKill = Boolean(next.dj.bassKill);
  next.dj.vocalKill = Boolean(next.dj.vocalKill);
  next.threeWay = Boolean(next.threeWay);
  next.vocalIsolation = Boolean(next.vocalIsolation);

  return next;
}
