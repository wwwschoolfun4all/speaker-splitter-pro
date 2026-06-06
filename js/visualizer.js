export class SpectrumVisualizer {
  constructor({ canvas, vuElements, clipStatus, engine }) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.vuElements = vuElements;
    this.clipStatus = clipStatus;
    this.engine = engine;
    this.frame = null;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  start() {
    if (this.frame) {
      return;
    }

    const tick = () => {
      this.draw();
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  stop() {
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
  }

  resize() {
    const ratio = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width * ratio));
    const height = Math.max(1, Math.floor(rect.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  draw() {
    const { width, height } = this.canvas;
    const ctx = this.context;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#090c0f";
    ctx.fillRect(0, 0, width, height);
    this.drawGrid(ctx, width, height);

    const data = this.engine.getAnalyserData();
    if (!data.length) {
      return;
    }

    const merged = this.mergeSpectrums(data.map((entry) => entry.spectrum));
    this.drawBars(ctx, width, height, merged, data[0].analyser.context.sampleRate);
    this.updateMeters();
  }

  drawGrid(ctx, width, height) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = Math.max(1, width / 1200);

    for (let i = 1; i < 6; i += 1) {
      const y = (height / 6) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    for (let i = 1; i < 10; i += 1) {
      const x = (width / 10) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    ctx.restore();
  }

  mergeSpectrums(spectrums) {
    const length = spectrums[0]?.length || 0;
    const merged = new Uint8Array(length);

    for (let i = 0; i < length; i += 1) {
      let value = 0;
      for (const spectrum of spectrums) {
        value = Math.max(value, spectrum[i] || 0);
      }
      merged[i] = value;
    }
    return merged;
  }

  drawBars(ctx, width, height, spectrum, sampleRate) {
    const bars = 112;
    const gap = Math.max(1, Math.floor(width / 520));
    const barWidth = Math.max(2, Math.floor((width - gap * (bars - 1)) / bars));
    const minFreq = 35;
    const maxFreq = Math.min(18000, sampleRate / 2);
    const nyquist = sampleRate / 2;

    for (let i = 0; i < bars; i += 1) {
      const t = i / (bars - 1);
      const frequency = minFreq * Math.pow(maxFreq / minFreq, t);
      const bin = Math.min(
        spectrum.length - 1,
        Math.max(0, Math.round((frequency / nyquist) * spectrum.length)),
      );
      const value = spectrum[bin] / 255;
      const eased = Math.pow(value, 1.45);
      const barHeight = Math.max(2, eased * height * 0.9);
      const x = i * (barWidth + gap);
      const y = height - barHeight;

      const hueShift = i / bars;
      const color =
        hueShift < 0.34
          ? "rgba(130, 209, 115, 0.92)"
          : hueShift < 0.72
            ? "rgba(50, 199, 197, 0.9)"
            : "rgba(242, 184, 75, 0.9)";

      ctx.fillStyle = color;
      ctx.fillRect(x, y, barWidth, barHeight);
    }
  }

  updateMeters() {
    const levels = this.engine.getMeterLevels();
    let hot = false;

    for (const [id, element] of Object.entries(this.vuElements)) {
      const level = levels[id] || { rms: 0, peak: 0, clipping: false };
      element.style.width = `${Math.round(level.rms * 100)}%`;
      hot = hot || level.peak > 0.92 || level.clipping;
    }

    if (this.clipStatus) {
      const limiterEnabled = this.engine.getSettings().limiterEnabled;
      this.clipStatus.textContent = limiterEnabled
        ? hot
          ? "Limiter active"
          : "Limiter ready"
        : "Limiter off";
    }
  }
}
