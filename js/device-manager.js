export class DeviceManager extends EventTarget {
  constructor() {
    super();
    this.devices = [];
    this.pickerValue = "__choose_output__";
    this.rememberedKey = "speaker-splitter-pro.remembered-devices.v1";
    this.support = this.getSupport();
    this.loadRememberedDevices();

    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener("devicechange", () => {
        this.refresh().catch(() => {});
      });
    }
  }

  getSupport() {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    const probeContext = AudioCtor ? new AudioCtor({ latencyHint: "interactive" }) : null;
    const contextSink = Boolean(probeContext && "setSinkId" in probeContext);
    probeContext?.close?.();
    const fileMode = window.location.protocol === "file:";

    return {
      fileMode,
      secureContext: window.isSecureContext,
      mediaDevices: Boolean(navigator.mediaDevices),
      enumerateDevices: Boolean(navigator.mediaDevices?.enumerateDevices),
      selectAudioOutput: Boolean(navigator.mediaDevices?.selectAudioOutput && !fileMode),
      elementSink: Boolean("setSinkId" in HTMLMediaElement.prototype),
      contextSink,
      outputRouting: contextSink || Boolean("setSinkId" in HTMLMediaElement.prototype),
    };
  }

  loadRememberedDevices() {
    try {
      const stored = JSON.parse(localStorage.getItem(this.rememberedKey) || "[]");
      if (Array.isArray(stored)) {
        this.devices = stored.map((device) => this.normalizeDevice(device));
      }
    } catch {
      this.devices = [];
    }
  }

  saveRememberedDevices() {
    try {
      const remembered = this.devices
        .filter((device) => device.deviceId && device.deviceId !== "default")
        .map((device) => ({
          deviceId: device.deviceId,
          groupId: device.groupId || "",
          kind: "audiooutput",
          label: device.label || "Remembered output",
          remembered: true,
        }));
      localStorage.setItem(this.rememberedKey, JSON.stringify(remembered));
    } catch {
      // Private windows or locked-down browsers may block local storage.
    }
  }

  async requestAccess() {
    if (!this.support.mediaDevices) {
      throw new Error("Media devices are not available in this browser.");
    }

    // selectAudioOutput is the browser-native speaker permission prompt when present.
    if (this.support.selectAudioOutput) {
      try {
        const device = await navigator.mediaDevices.selectAudioOutput();
        this.rememberDevice(device);
      } catch (error) {
        if (error.name !== "NotAllowedError") {
          throw error;
        }
      }
    }

    // A short microphone grant reveals human-readable device labels in many browsers.
    if (navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch (error) {
        if (error.name !== "NotAllowedError") {
          throw error;
        }
      }
    }

    return this.refresh();
  }

  async chooseOutputDevice() {
    if (!this.support.selectAudioOutput) {
      throw new Error("This browser does not provide a speaker picker.");
    }

    const device = await navigator.mediaDevices.selectAudioOutput();
    this.rememberDevice(device);
    await this.refresh();
    this.rememberDevice(device);
    return this.normalizeDevice(device);
  }

  normalizeDevice(device) {
    return {
      deviceId: device.deviceId || "default",
      groupId: device.groupId || "",
      kind: device.kind || "audiooutput",
      label: device.label || "Selected output",
      remembered: Boolean(device.remembered),
    };
  }

  rememberDevice(device) {
    if (!device) {
      return;
    }

    const normalized = this.normalizeDevice(device);
    const index = this.devices.findIndex((item) => item.deviceId === normalized.deviceId);
    if (index >= 0) {
      this.devices[index] = { ...this.devices[index], ...normalized };
    } else {
      this.devices.push(normalized);
    }
    this.saveRememberedDevices();
  }

  rememberDevices(devices = []) {
    for (const device of devices) {
      this.rememberDevice(device);
    }
  }

  getCompatibility() {
    if (this.support.fileMode) {
      return {
        tone: "warn",
        label: "File mode limits devices",
      };
    }

    if (!this.support.mediaDevices) {
      return {
        tone: "error",
        label: "Device APIs unavailable",
      };
    }

    if (this.support.contextSink && this.support.selectAudioOutput) {
      return {
        tone: "ok",
        label: "Full device routing ready",
      };
    }

    if (this.support.outputRouting) {
      return {
        tone: "warn",
        label: "Limited routing mode",
      };
    }

    return {
      tone: "warn",
      label: "Use system default output",
    };
  }

  normalizeLabel(label = "") {
    return label
      .toLowerCase()
      .replace(/\s*\((default|communications)\)\s*/g, "")
      .replace(/^default\s*-\s*/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  findSavedDeviceMatch(saved = {}) {
    if (!saved.deviceLabel && !saved.groupId && !saved.deviceId) {
      return null;
    }

    const exact = this.devices.find((device) => device.deviceId === saved.deviceId);
    if (exact) {
      return exact;
    }

    if (saved.groupId) {
      const groupMatch = this.devices.find((device) => device.groupId && device.groupId === saved.groupId);
      if (groupMatch) {
        return groupMatch;
      }
    }

    const savedLabel = this.normalizeLabel(saved.deviceLabel || "");
    if (!savedLabel) {
      return null;
    }

    return this.devices.find((device) => {
      const label = this.normalizeLabel(device.label);
      return label && (label === savedLabel || label.includes(savedLabel) || savedLabel.includes(label));
    }) || null;
  }

  async refresh() {
    if (!this.support.enumerateDevices) {
      this.devices = [{ deviceId: "default", label: "Default output", kind: "audiooutput" }];
      this.dispatchEvent(new CustomEvent("devices", { detail: this.devices }));
      return this.devices;
    }

    const allDevices = await navigator.mediaDevices.enumerateDevices();
    const outputDevices = allDevices
      .filter((device) => device.kind === "audiooutput")
      .map((device, index) => ({
        deviceId: device.deviceId || "default",
        groupId: device.groupId || "",
        kind: device.kind,
        label: device.label || (index === 0 ? "Default output" : `Output ${index + 1}`),
      }));

    const hasDefault = outputDevices.some((device) => device.deviceId === "default");
    const nextDevices = hasDefault
      ? outputDevices
      : [{ deviceId: "default", label: "Default output", kind: "audiooutput" }, ...outputDevices];

    for (const device of this.devices) {
      if (device.deviceId && !nextDevices.some((item) => item.deviceId === device.deviceId)) {
        nextDevices.push({ ...device, remembered: true });
      }
    }

    this.devices = nextDevices;
    this.saveRememberedDevices();

    this.dispatchEvent(new CustomEvent("devices", { detail: this.devices }));
    return this.devices;
  }

  fillSelect(select, selectedId = "default") {
    const value = selectedId || "default";
    select.innerHTML = "";

    for (const device of this.devices) {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.remembered ? `${device.label} (saved)` : device.label;
      select.append(option);
    }

    if (this.support.mediaDevices) {
      const option = document.createElement("option");
      option.value = this.pickerValue;
      option.textContent = this.support.selectAudioOutput
        ? "Choose another output..."
        : this.support.fileMode
          ? "Picker needs 127.0.0.1 mode"
          : this.support.outputRouting
            ? "Use browser/OS device permissions"
            : "Use system default output";
      option.disabled = !this.support.selectAudioOutput;
      select.append(option);
    }

    const hasValue = [...select.options].some((option) => option.value === value);
    select.value = hasValue ? value : "default";
    select.disabled = !this.support.outputRouting;
  }
}
