export class DeviceManager extends EventTarget {
  constructor() {
    super();
    this.devices = [];
    this.pickerValue = "__choose_output__";
    this.support = this.getSupport();

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
      selectAudioOutput: Boolean(navigator.mediaDevices?.selectAudioOutput),
      elementSink: Boolean("setSinkId" in HTMLMediaElement.prototype),
      contextSink,
      outputRouting: contextSink || Boolean("setSinkId" in HTMLMediaElement.prototype),
    };
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
        nextDevices.push(device);
      }
    }

    this.devices = nextDevices;

    this.dispatchEvent(new CustomEvent("devices", { detail: this.devices }));
    return this.devices;
  }

  fillSelect(select, selectedId = "default") {
    const value = selectedId || "default";
    select.innerHTML = "";

    for (const device of this.devices) {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label;
      select.append(option);
    }

    if (this.support.mediaDevices) {
      const option = document.createElement("option");
      option.value = this.pickerValue;
      option.textContent = this.support.selectAudioOutput
        ? "Choose another output..."
        : this.support.fileMode
          ? "Picker needs 127.0.0.1 mode"
          : "Speaker picker unavailable";
      option.disabled = !this.support.selectAudioOutput;
      select.append(option);
    }

    const hasValue = [...select.options].some((option) => option.value === value);
    select.value = hasValue ? value : "default";
    select.disabled = !this.support.outputRouting;
  }
}
