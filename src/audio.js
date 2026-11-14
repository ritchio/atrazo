export class AudioTrack {
  constructor(onChange = () => {}) {
    this.context = null;
    this.buffer = null;
    this.source = null;
    this.startedAt = 0;
    this.offset = 0;
    this.onChange = onChange;
    this.name = '';
    this.objectUrl = '';
  }

  async load(file) {
    this.stop();
    this.context ||= new AudioContext();
    const data = await file.arrayBuffer();
    this.buffer = await this.context.decodeAudioData(data);
    this.name = file.name;
    this.objectUrl = URL.createObjectURL(file);
    this.offset = 0;
    this.onChange(this);
  }

  async play(from = this.offset) {
    if (!this.buffer) return;
    this.context ||= new AudioContext();
    await this.context.resume();
    this.stopSource();
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.context.destination);
    const offset = Math.max(0, Math.min(from, Math.max(0, this.buffer.duration - 0.01)));
    source.start(0, offset);
    this.source = source;
    this.offset = offset;
    this.startedAt = this.context.currentTime;
    source.onended = () => { if (this.source === source) { this.source = null; this.offset = 0; } };
  }

  stopSource() {
    if (this.source) { try { this.source.stop(); } catch {} this.source.disconnect(); this.source = null; }
  }

  stop() {
    if (this.source && this.context) this.offset = Math.min(this.buffer?.duration || 0, this.offset + this.context.currentTime - this.startedAt);
    this.stopSource();
  }

  seek(seconds, resume = false) {
    this.stopSource();
    this.offset = Math.max(0, Math.min(seconds, this.buffer?.duration || 0));
    if (resume) this.play(this.offset);
  }

  clear() {
    this.stop();
    this.buffer = null;
    this.name = '';
    this.offset = 0;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = '';
    this.onChange(this);
  }

  get duration() { return this.buffer?.duration || 0; }

  drawWaveform(canvas, playhead = 0) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (!this.buffer) {
      ctx.strokeStyle = '#343741'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(0, rect.height / 2); ctx.lineTo(rect.width, rect.height / 2); ctx.stroke(); ctx.setLineDash([]); return;
    }
    const data = this.buffer.getChannelData(0);
    const step = Math.ceil(data.length / Math.max(1, rect.width * 2));
    const middle = rect.height / 2;
    ctx.strokeStyle = '#9376e1'; ctx.lineWidth = 1;
    for (let x = 0; x < rect.width; x++) {
      let min = 1, max = -1;
      for (let i = 0; i < step; i++) { const value = data[x * step + i]; if (value === undefined) break; min = Math.min(min, value); max = Math.max(max, value); }
      ctx.beginPath(); ctx.moveTo(x + .5, middle + min * middle * .85); ctx.lineTo(x + .5, middle + max * middle * .85); ctx.stroke();
    }
    const x = this.duration ? (playhead / this.duration) * rect.width : 0;
    ctx.strokeStyle = '#e3c4ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rect.height); ctx.stroke();
  }
}
