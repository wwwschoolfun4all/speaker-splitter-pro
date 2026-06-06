import { EQ_BANDS, createDefaultSettings, mergeSettings } from "./constants.js";

const STORAGE_KEY = "speaker-splitter-pro.presets.v1";
const LAST_SESSION_KEY = "speaker-splitter-pro.last-session.v1";

const eq = (...values) => EQ_BANDS.map((_, index) => values[index] ?? 0);

export const FACTORY_PRESETS = {
  Music: mergeSettings({
    name: "Music",
    crossoverHz: 160,
    trebleSplitHz: 3600,
    masterVolume: 1,
    speakers: {
      bass: { volume: 0.82, eq: eq(-4, -2.5, -1, 0, 0, 0, 0.5, 1, 1, 0.5) },
      vocal: { eq: eq(-1, -0.5, 0, 0.5, 1, 1.2, 1, 0.8, 0.5, 0) },
      mid: { eq: eq(-3, -2, -1, 0.5, 1.5, 2, 1.5, 0.5, -0.5, -1) },
      treble: { eq: eq(-6, -4, -2, -1, 0, 0.5, 1.5, 2, 2, 1) },
    },
  }),
  Movies: mergeSettings({
    name: "Movies",
    crossoverHz: 120,
    trebleSplitHz: 3200,
    speakers: {
      bass: { volume: 0.82, eq: eq(-3, -1.5, -0.5, 0, -0.5, -1, -1, 0, 0.5, 0.5) },
      vocal: { eq: eq(-2, -1.5, -0.5, 1, 2, 2.5, 1.5, 1, 0.5, 0) },
      mid: { eq: eq(-3, -2, -0.5, 1, 2.2, 2.4, 1.2, 0.5, 0, -0.5) },
      treble: { eq: eq(-6, -5, -3, -1, 0, 0.8, 1.5, 2, 2.5, 1.5) },
    },
  }),
  Gaming: mergeSettings({
    name: "Gaming",
    crossoverHz: 140,
    trebleSplitHz: 4200,
    speakers: {
      bass: { volume: 0.82, eq: eq(-4, -2, -0.5, 0, -1, -1, 0, 1, 1.5, 0.5) },
      vocal: { eq: eq(-2, -1, -0.5, 0.5, 1.5, 2, 2.5, 2, 1, 0.5) },
      mid: { eq: eq(-4, -3, -1, 0.5, 1.5, 2.2, 2.6, 1.5, 0.5, 0) },
      treble: { eq: eq(-5, -4, -3, -1, 0.5, 1.2, 2, 2.5, 2, 1) },
    },
  }),
  Podcast: mergeSettings({
    name: "Podcast",
    crossoverHz: 190,
    trebleSplitHz: 3000,
    vocalIsolation: true,
    speakers: {
      bass: { volume: 0.75, eq: eq(-3, -3, -2, -1, -1, -2, -3, -3, -3, -3) },
      vocal: { volume: 1.1, eq: eq(-6, -5, -3, 0, 2, 3, 2.5, 1, -0.5, -2) },
      mid: { volume: 1.15, eq: eq(-8, -6, -3, 0.5, 2.5, 3.5, 2.5, 0.5, -1.5, -3) },
      treble: { volume: 0.8, eq: eq(-8, -6, -4, -2, -0.5, 0.5, 1, 0.5, -0.5, -2) },
    },
  }),
  "Bass Boost": mergeSettings({
    name: "Bass Boost",
    crossoverHz: 110,
    trebleSplitHz: 3600,
    speakers: {
      bass: { volume: 0.9, eq: eq(-2, -1, 0, 0, 0.5, -1, -1.5, -2, -2, -2) },
      vocal: { volume: 0.95, eq: eq(-4, -3, -2, -0.5, 0.5, 1, 1, 0.5, 0, -0.5) },
      mid: { volume: 0.95, eq: eq(-6, -4, -2, 0, 0.8, 1.2, 1, 0, -1, -2) },
      treble: { volume: 0.9, eq: eq(-7, -5, -3, -1, 0, 0.5, 1, 1, 0.5, -0.5) },
    },
  }),
  "Bass Clean": mergeSettings({
    name: "Bass Clean",
    crossoverHz: 95,
    trebleSplitHz: 3600,
    masterVolume: 0.88,
    speakers: {
      bass: { volume: 0.68, eq: eq(-8, -6, -3, -1, -0.5, -1, -2, -3, -4, -4) },
      vocal: { volume: 1, eq: eq(-3, -2, -1, 0, 0.5, 1, 1, 0.5, 0, -0.5) },
      mid: { volume: 1, eq: eq(-5, -3, -1, 0, 0.7, 1.1, 1, 0, -1, -2) },
      treble: { volume: 0.92, eq: eq(-7, -5, -3, -1, 0, 0.5, 1, 1, 0.5, -0.5) },
    },
  }),
};

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeStore(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function listSavedPresets() {
  return Object.entries(readStore())
    .map(([name, settings]) => ({ name, settings: mergeSettings(settings) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function loadLastSession() {
  try {
    const stored = JSON.parse(localStorage.getItem(LAST_SESSION_KEY) || "null");
    return stored ? mergeSettings(stored) : null;
  } catch {
    return null;
  }
}

export function loadLastSessionDevices() {
  try {
    const stored = JSON.parse(localStorage.getItem(LAST_SESSION_KEY) || "null");
    return stored?.rememberedDevices || [];
  } catch {
    return [];
  }
}

export function getRememberedDevices(settings) {
  const devices = [];
  const seen = new Set();

  for (const speaker of Object.values(settings?.speakers || {})) {
    if (!speaker?.deviceId || speaker.deviceId === "default" || seen.has(speaker.deviceId)) {
      continue;
    }
    seen.add(speaker.deviceId);
    devices.push({
      deviceId: speaker.deviceId,
      label: speaker.deviceLabel || "Remembered output",
      kind: "audiooutput",
    });
  }

  return devices;
}

export function attachDeviceLabels(settings, devices = []) {
  const next = mergeSettings(settings);
  const labelById = new Map(devices.map((device) => [device.deviceId, device.label]));

  for (const speaker of Object.values(next.speakers)) {
    if (speaker.deviceId && labelById.has(speaker.deviceId)) {
      speaker.deviceLabel = labelById.get(speaker.deviceId);
    }
  }

  return next;
}

export function saveLastSession(settings) {
  try {
    const normalized = mergeSettings(settings);
    localStorage.setItem(
      LAST_SESSION_KEY,
      JSON.stringify({
        ...normalized,
        name: "Last Session",
        rememberedDevices: getRememberedDevices(normalized),
        savedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Storage can fail in private windows or when quota is blocked.
  }
}

export function savePreset(name, settings) {
  const cleanName = String(name || "").trim();
  if (!cleanName) {
    throw new Error("Preset name is required.");
  }

  const store = readStore();
  store[cleanName] = mergeSettings({
    ...settings,
    name: cleanName,
    savedAt: new Date().toISOString(),
  });
  writeStore(store);
  return store[cleanName];
}

export function deletePreset(name) {
  const store = readStore();
  delete store[name];
  writeStore(store);
}

export function exportPresetBlob(settings) {
  const payload = JSON.stringify(mergeSettings(settings || createDefaultSettings()), null, 2);
  return new Blob([payload], { type: "application/json" });
}

export async function parsePresetFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  return mergeSettings(parsed);
}
