// Muscle physiology model: motor units, Henneman recruitment, rate coding,
// fatigue and recovery. DOM-free so it can be sanity-checked in Node.

export const FIBER_TYPES = {
  S: {
    key: 'S', short: 'I', label: 'Type I · Slow',
    hue: 172,
    fatRate: 0.002,    // fatigue per second at full activation
    recoverTau: 150,   // s, exponential recovery time constant
    tension: 1.0,      // relative specific tension per fiber
  },
  FR: {
    key: 'FR', short: 'IIa', label: 'Type IIa · Fast FR',
    hue: 43,
    fatRate: 0.01,
    recoverTau: 70,
    tension: 1.35,
  },
  FF: {
    key: 'FF', short: 'IIx', label: 'Type IIx · Fast FF',
    hue: 14,
    fatRate: 0.042,
    recoverTau: 28,
    tension: 1.7,
  },
};

// count / fiber-count range / recruitment-threshold range per type.
// Thresholds overlap slightly between types, as in real muscle.
const MU_PLAN = [
  { type: 'S',  count: 24, fibers: [8, 14],  thr: [0.02, 0.38] },
  { type: 'FR', count: 17, fibers: [16, 26], thr: [0.30, 0.60] },
  { type: 'FF', count: 9,  fibers: [30, 46], thr: [0.62, 0.88] },
];

const A_MIN = 0.32;          // force fraction when a MU is first recruited (low firing rate)
const RATE_SPAN = 0.55;      // drive range over which rate coding ramps to max
const ACT_TAU = 0.12;        // s, activation smoothing time constant
const DERECRUIT_HYST = 0.015;
const FATIGUE_CAP = 0.95;
export const FATIGUE_FORCE_EXP = 1.2;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Muscle {
  constructor(seed = 7) {
    const rand = mulberry32(seed);
    this.units = [];
    this.fibers = [];
    this.fascicles = [];
    let id = 0;
    for (const plan of MU_PLAN) {
      for (let i = 0; i < plan.count; i++) {
        const t = plan.count === 1 ? 0 : i / (plan.count - 1);
        const threshold = Math.max(0.02, clamp01(plan.thr[0] + (plan.thr[1] - plan.thr[0]) * t + (rand() - 0.5) * 0.02));
        const targetFibers = Math.round(plan.fibers[0] + rand() * (plan.fibers[1] - plan.fibers[0]));
        this.units.push({
          id: id++,
          type: plan.type,
          threshold,
          // Late-recruited units have a compressed rate-coding range, so every
          // unit reaches full activation at maximal drive.
          rateSpan: Math.min(RATE_SPAN, Math.max(0.08, 1 - threshold)),
          targetFibers,
          fiberCount: 0,
          share: 0,
          recruited: false,
          recruitedAt: -1e9,
          activation: 0,
          firingRate: 0,
          fatigue: 0,
          force: 0,
          fibers: [],
        });
      }
    }
    // Recruitment order follows size (Henneman): sort by threshold so unit ids
    // read in recruitment order.
    this.units.sort((a, b) => a.threshold - b.threshold);
    this.units.forEach((u, i) => (u.id = i));

    this.drive = 0;          // central neural drive 0..1
    this.target = 0;         // target force (maintain mode) or drive (fixed mode)
    this.mode = 'maintain';
    this.time = 0;
    this.forceTotal = 0;
    this.recruitedCount = 0;
    this.failure = false;
  }

  // Called after geometry assignment attaches fibers to units.
  finalize() {
    let sum = 0;
    for (const u of this.units) {
      u.fiberCount = u.fibers.length;
      sum += u.fiberCount * FIBER_TYPES[u.type].tension;
    }
    for (const u of this.units) {
      u.share = (u.fiberCount * FIBER_TYPES[u.type].tension) / sum;
    }
  }

  setTarget(v) { this.target = clamp01(v); }

  reset() {
    this.drive = 0;
    this.failure = false;
    for (const u of this.units) {
      u.recruited = false;
      u.activation = 0;
      u.firingRate = 0;
      u.fatigue = 0;
      u.force = 0;
    }
    for (const f of this.fibers) f.fatigue = 0;
  }

  update(dt) {
    this.time += dt;

    // Controller. In "maintain" mode the CNS raises drive to hold the target
    // force as fibers fatigue — this is what drives progressive recruitment.
    if (this.mode === 'maintain') {
      const err = this.target - this.forceTotal;
      const gain = err > 0 ? 2.2 : 3.2; // derecruitment is faster than recruitment
      this.drive = clamp01(this.drive + err * gain * dt);
      if (this.target <= 0.001) this.drive = Math.max(0, this.drive - 3 * dt);
    } else {
      this.drive = clamp01(this.target);
    }

    let force = 0;
    let recruited = 0;
    for (const u of this.units) {
      const T = FIBER_TYPES[u.type];

      if (!u.recruited && this.drive >= u.threshold) {
        u.recruited = true;
        u.recruitedAt = this.time;
      } else if (u.recruited && this.drive < u.threshold - DERECRUIT_HYST) {
        u.recruited = false;
      }

      // Rate coding: firing rate ramps force from A_MIN to max across the
      // unit's rate-coding span.
      const aTarget = u.recruited
        ? Math.min(1, A_MIN + ((1 - A_MIN) * (this.drive - u.threshold)) / u.rateSpan)
        : 0;
      u.activation += (aTarget - u.activation) * (1 - Math.exp(-dt / ACT_TAU));
      u.firingRate = u.recruited ? 6 + 44 * u.activation : 0;

      const active = u.activation > 0.05;
      const fiberShare = u.fiberCount > 0 ? u.share / u.fiberCount : 0;
      let uForce = 0;
      let uFat = 0;
      for (const f of u.fibers) {
        if (active) {
          f.fatigue = Math.min(
            FATIGUE_CAP,
            f.fatigue + T.fatRate * f.fatRateVar * Math.pow(u.activation, 1.6) * dt
          );
        } else {
          f.fatigue *= Math.exp(-dt / (T.recoverTau * f.recoverVar));
        }
        uFat += f.fatigue;
        uForce += fiberShare * u.activation * Math.pow(1 - f.fatigue, FATIGUE_FORCE_EXP);
      }
      u.fatigue = u.fiberCount > 0 ? uFat / u.fiberCount : 0;
      u.force = uForce;
      force += uForce;
      if (u.recruited) recruited++;
    }

    this.forceTotal = force;
    this.recruitedCount = recruited;
    this.failure =
      this.mode === 'maintain' &&
      this.target > 0.02 &&
      this.drive >= 0.999 &&
      this.forceTotal < this.target - 0.02;
  }

  perTypeStats() {
    const out = {};
    for (const key of Object.keys(FIBER_TYPES)) {
      out[key] = { recruited: 0, total: 0, fatigue: 0, force: 0, share: 0 };
    }
    for (const u of this.units) {
      const s = out[u.type];
      s.total++;
      if (u.recruited) s.recruited++;
      s.fatigue += u.fatigue;
      s.force += u.force;
      s.share += u.share;
    }
    for (const key of Object.keys(out)) {
      const s = out[key];
      s.fatigue = s.total > 0 ? s.fatigue / s.total : 0;
    }
    return out;
  }

  meanFiringRate() {
    let sum = 0;
    let n = 0;
    for (const u of this.units) {
      if (u.recruited) { sum += u.firingRate; n++; }
    }
    return n > 0 ? sum / n : 0;
  }
}
