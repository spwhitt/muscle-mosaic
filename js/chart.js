// Rolling 90 s time-series: force output, target, neural drive, mean fatigue.

const WINDOW_S = 90;
const SAMPLE_HZ = 10;

export class Chart {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.samples = []; // {t, force, target, drive, fatigue}
    this.lastSampleT = -1;
    this.dpr = 1;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }

  resize() {
    const parent = this.canvas.parentElement;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w === 0 || h === 0) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  clear() {
    this.samples = [];
    this.lastSampleT = -1;
  }

  push(t, force, target, drive, fatigue) {
    if (t - this.lastSampleT < 1 / SAMPLE_HZ) return;
    this.lastSampleT = t;
    this.samples.push({ t, force, target, drive, fatigue });
    const cutoff = t - WINDOW_S;
    while (this.samples.length > 0 && this.samples[0].t < cutoff) this.samples.shift();
  }

  draw(now) {
    const { ctx } = this;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const padL = 30, padR = 8, padT = 4, padB = 11;
    const iw = w - padL - padR;
    const ih = h - padT - padB;
    const x0 = now - WINDOW_S;
    const X = (t) => padL + ((t - x0) / WINDOW_S) * iw;
    const Y = (v) => padT + (1 - v) * ih;

    // Grid + labels.
    ctx.strokeStyle = 'rgba(148, 163, 197, 0.10)';
    ctx.fillStyle = 'rgba(139, 152, 184, 0.75)';
    ctx.font = '9px system-ui, sans-serif';
    ctx.lineWidth = 1;
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      ctx.beginPath();
      ctx.moveTo(padL, Y(v));
      ctx.lineTo(w - padR, Y(v));
      ctx.stroke();
      ctx.fillText(`${Math.round(v * 100)}%`, 4, Y(v) + 3);
    }
    const t0 = Math.ceil(x0 / 15) * 15;
    for (let ts = t0; ts <= now; ts += 15) {
      ctx.fillText(`${Math.round(ts)}s`, X(ts) - 8, h - 4);
    }

    if (this.samples.length < 2) return;

    const line = (get, color, width, dash = []) => {
      ctx.beginPath();
      ctx.setLineDash(dash);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      let started = false;
      for (const s of this.samples) {
        const x = X(s.t);
        const y = Y(get(s));
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };

    // Force area fill.
    ctx.beginPath();
    ctx.moveTo(X(this.samples[0].t), Y(0));
    for (const s of this.samples) ctx.lineTo(X(s.t), Y(s.force));
    ctx.lineTo(X(this.samples[this.samples.length - 1].t), Y(0));
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padT, 0, padT + ih);
    grad.addColorStop(0, 'rgba(45, 212, 191, 0.35)');
    grad.addColorStop(1, 'rgba(45, 212, 191, 0.02)');
    ctx.fillStyle = grad;
    ctx.fill();

    line((s) => s.force, '#2dd4bf', 1.8);
    line((s) => s.drive, 'rgba(167, 139, 250, 0.85)', 1.1);
    line((s) => s.fatigue, 'rgba(248, 113, 113, 0.8)', 1.1);
    line((s) => s.target, 'rgba(226, 232, 240, 0.65)', 1, [4, 4]);
  }
}
