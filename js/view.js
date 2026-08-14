// Canvas renderer for the muscle cross-section. Colors are precomputed in a
// quantized (activation × fatigue) lookup table per fiber type so the per-frame
// cost is one table index + one Path2D fill per fiber.

import { FIBER_TYPES, FATIGUE_FORCE_EXP } from './model.js';
import { RX, RY } from './geometry.js';

const A_STEPS = 48;
const F_STEPS = 24;
const BASE_HUE = 221; // inactive fiber slate blue

function lerp(a, b, t) { return a + (b - a) * t; }

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

export class MuscleView {
  constructor(canvas, muscle) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.muscle = muscle;
    this.shimmer = true;
    this.scale = 1;
    this.cx = 0;
    this.cy = 0;
    this.dpr = 1;

    // Path2D per fiber + fascicle hull paths (unit coords).
    this.fiberPaths = muscle.fibers.map((f) => {
      const path = new Path2D();
      path.moveTo(f.verts[0], f.verts[1]);
      for (let k = 1; k < f.verts.length / 2; k++) {
        path.lineTo(f.verts[k * 2], f.verts[k * 2 + 1]);
      }
      path.closePath();
      return path;
    });
    this.hullPaths = muscle.fascicles.map((hull) => {
      const path = new Path2D();
      if (hull.length > 0) {
        path.moveTo(hull[0][0], hull[0][1]);
        for (let k = 1; k < hull.length; k++) path.lineTo(hull[k][0], hull[k][1]);
        path.closePath();
      }
      return path;
    });

    // Color tables.
    this.tables = {};
    for (const key of Object.keys(FIBER_TYPES)) {
      const H = FIBER_TYPES[key].hue;
      const table = [];
      for (let ai = 0; ai < A_STEPS; ai++) {
        const a = ai / (A_STEPS - 1);
        const row = [];
        for (let fi = 0; fi < F_STEPS; fi++) {
          const f = fi / (F_STEPS - 1);
          // Three channels on one fiber:
          //   force   → vividness of the type hue (force = activation × (1−fatigue)^k)
          //   fatigue → a reserved violet stain, visible mid-contraction and
          //             lingering at rest while the fiber recovers
          //   drive   → shimmer motion, applied at draw time
          const force = a * Math.pow(1 - f, FATIGUE_FORCE_EXP);
          const h = lerp(BASE_HUE, H, Math.min(1, force * 1.5));
          const s = lerp(0.16, 0.8, force);
          const l = lerp(0.125, 0.3 + 0.28 * force, force);
          let [r, g, b] = hslToRgb(h, s, l);
          const stain = f * 0.55;
          r = lerp(r, 148, stain);
          g = lerp(g, 96, stain);
          b = lerp(b, 210, stain);
          row.push(`rgb(${r | 0},${g | 0},${b | 0})`);
        }
        table.push(row);
      }
      this.tables[key] = table;
    }

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
    this.scale = Math.min(w / (RX * 2.1), h / (RY * 2.14));
    this.cx = w / 2;
    this.cy = h / 2;
    this.bgGradient = null;
  }

  // Snap display-smoothed values to the model's current state (used after
  // fast-forward pre-rolls so the first paint already shows the state).
  snapDisplay() {
    for (const f of this.muscle.fibers) {
      f.dispA = f.mu.activation;
      f.dispFat = f.fatigue;
    }
  }

  toUnit(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.cx) / this.scale,
      y: (clientY - rect.top - this.cy) / this.scale,
    };
  }

  draw(t, dt, hoverUnit) {
    const { ctx, muscle } = this;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!this.bgGradient) {
      const g = ctx.createRadialGradient(this.cx, this.cy, 10, this.cx, this.cy, Math.max(w, h) * 0.7);
      g.addColorStop(0, '#0d1322');
      g.addColorStop(1, '#05070e');
      this.bgGradient = g;
    }
    ctx.fillStyle = this.bgGradient;
    ctx.fillRect(0, 0, w, h);

    ctx.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, this.dpr * this.cx, this.dpr * this.cy);

    // Fascicle boundaries (perimysium).
    ctx.lineWidth = 0.008;
    ctx.strokeStyle = 'rgba(148, 163, 197, 0.10)';
    for (const path of this.hullPaths) ctx.stroke(path);

    // Fibers.
    const smoothA = 1 - Math.exp(-dt / 0.15);
    const smoothF = 1 - Math.exp(-dt / 0.4);
    const shimmerOn = this.shimmer;
    for (let i = 0; i < muscle.fibers.length; i++) {
      const f = muscle.fibers[i];
      const u = f.mu;
      f.dispA += (u.activation - f.dispA) * smoothA;
      f.dispFat += (f.fatigue - f.dispFat) * smoothF;
      let a = f.dispA;
      // Brief bright pulse when a motor unit is first recruited, so new
      // recruitment reads as a visible event (uses simulation time).
      const sinceRecruit = muscle.time - u.recruitedAt;
      if (u.recruited && sinceRecruit < 0.9) {
        a = Math.min(1, a + 0.35 * (1 - sinceRecruit / 0.9));
      }
      if (shimmerOn && u.recruited && a > 0.02) {
        const vf = 1.5 + 6 * u.activation; // visible proxy for firing rate
        a = Math.min(1, Math.max(0, a * (1 + 0.07 * Math.sin(2 * Math.PI * vf * t + f.phase))));
      }
      const ai = (a * (A_STEPS - 1) + 0.5) | 0;
      const fi = (f.dispFat * (F_STEPS - 1) + 0.5) | 0;
      ctx.fillStyle = this.tables[u.type][ai][fi];
      ctx.fill(this.fiberPaths[i]);
    }

    // Hover highlight: dim everything else, outline the hovered motor unit.
    if (hoverUnit) {
      ctx.fillStyle = 'rgba(4, 6, 12, 0.55)';
      for (let i = 0; i < muscle.fibers.length; i++) {
        if (muscle.fibers[i].mu !== hoverUnit) ctx.fill(this.fiberPaths[i]);
      }
      ctx.lineWidth = 0.007;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.shadowColor = 'rgba(255, 255, 255, 0.55)';
      ctx.shadowBlur = 12 * this.dpr;
      for (const f of hoverUnit.fibers) {
        ctx.stroke(this.fiberPaths[f.idx]);
      }
      ctx.shadowBlur = 0;
    }

    // Epimysium ring.
    ctx.beginPath();
    ctx.ellipse(0, 0, RX * 1.02, RY * 1.03, 0, 0, Math.PI * 2);
    ctx.lineWidth = 0.02;
    if (muscle.failure) {
      const pulse = 0.55 + 0.35 * Math.sin(t * 6);
      ctx.strokeStyle = `rgba(248, 113, 113, ${pulse})`;
      ctx.shadowColor = 'rgba(248, 113, 113, 0.6)';
      ctx.shadowBlur = 24 * this.dpr;
    } else {
      ctx.strokeStyle = 'rgba(148, 163, 197, 0.35)';
      ctx.shadowColor = 'rgba(80, 110, 200, 0.25)';
      ctx.shadowBlur = 18 * this.dpr;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}
