// Cross-section geometry: hex-packed fiber mosaic inside an ellipse, fascicle
// grouping with connective-tissue gaps, motor-unit territory assignment, and a
// picking grid for hover. All coordinates in unit space (ellipse rx=1, ry=0.82).

import { mulberry32 } from './model.js';

export const RX = 1.0;
export const RY = 0.82;

export function buildGeometry(muscle, seed = 11) {
  const rand = mulberry32(seed);
  const totalFibers = muscle.units.reduce((s, u) => s + u.targetFibers, 0);

  // Hex grid dense enough that we can thin to exactly totalFibers.
  const area = Math.PI * RX * RY;
  const spacing = Math.sqrt((2 * area) / (Math.sqrt(3) * totalFibers)) * 0.96;
  const rowH = (spacing * Math.sqrt(3)) / 2;

  let pts = [];
  let row = 0;
  for (let y = -RY; y <= RY; y += rowH, row++) {
    const xOff = row % 2 === 0 ? 0 : spacing / 2;
    for (let x = -RX + xOff; x <= RX; x += spacing) {
      const jx = x + (rand() - 0.5) * spacing * 0.55;
      const jy = y + (rand() - 0.5) * spacing * 0.55;
      const e = (jx * jx) / (RX * RX) + (jy * jy) / (RY * RY);
      if (e < 0.93) pts.push({ x: jx, y: jy });
    }
  }

  // Thin (or pad) to exactly totalFibers.
  shuffle(pts, rand);
  if (pts.length > totalFibers) pts = pts.slice(0, totalFibers);

  // --- Fascicles: assign each point to nearest fascicle center, pull points
  // slightly toward their center to open up perimysium gaps.
  const fascCenters = [];
  const fSpacing = 0.52;
  const fRowH = (fSpacing * Math.sqrt(3)) / 2;
  let fRow = 0;
  for (let y = -RY; y <= RY; y += fRowH, fRow++) {
    const xOff = fRow % 2 === 0 ? 0 : fSpacing / 2;
    for (let x = -RX + xOff; x <= RX; x += fSpacing) {
      const jx = x + (rand() - 0.5) * fSpacing * 0.4;
      const jy = y + (rand() - 0.5) * fSpacing * 0.4;
      const e = (jx * jx) / (RX * RX) + (jy * jy) / (RY * RY);
      if (e < 0.75) fascCenters.push({ x: jx, y: jy, pts: [] });
    }
  }
  for (const p of pts) {
    let best = null;
    let bestD = Infinity;
    for (const c of fascCenters) {
      const d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
      if (d < bestD) { bestD = d; best = c; }
    }
    p.x = best.x + (p.x - best.x) * 0.925;
    p.y = best.y + (p.y - best.y) * 0.925;
    best.pts.push(p);
  }
  muscle.fascicles = fascCenters.map((c) => convexHull(c.pts));

  // --- Motor unit territories: each MU claims the nearest unassigned points
  // within a territory radius sized by its fiber count. Largest first.
  const unassigned = new Set(pts.keys());
  const bySize = [...muscle.units].sort((a, b) => b.targetFibers - a.targetFibers);
  for (const u of bySize) {
    // Territory center uniformly inside the ellipse (shrunk).
    let cx = 0, cy = 0;
    do {
      cx = (rand() * 2 - 1) * RX;
      cy = (rand() * 2 - 1) * RY;
    } while ((cx * cx) / (RX * RX) + (cy * cy) / (RY * RY) > 0.72);

    let radius = 0.8 * spacing * Math.sqrt(u.targetFibers);
    let chosen = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      chosen = [];
      for (const i of unassigned) {
        const p = pts[i];
        const d = Math.hypot(p.x - cx, p.y - cy) + rand() * spacing * 0.5;
        if (d < radius) chosen.push([d, i]);
      }
      if (chosen.length >= u.targetFibers) break;
      radius *= 1.5;
    }
    chosen.sort((a, b) => a[0] - b[0]);
    const take = chosen.slice(0, Math.min(u.targetFibers, chosen.length));
    for (const [, i] of take) {
      unassigned.delete(i);
      u.fibers.push(makeFiber(pts[i], spacing, rand));
    }
  }
  // Any stragglers go to the smallest unit (keeps the mosaic gapless).
  for (const i of unassigned) {
    const u = muscle.units[0];
    u.fibers.push(makeFiber(pts[i], spacing, rand));
  }

  // Flatten + picking grid.
  muscle.fibers = [];
  for (const u of muscle.units) {
    for (const f of u.fibers) {
      f.mu = u;
      f.idx = muscle.fibers.length;
      muscle.fibers.push(f);
    }
  }
  muscle.finalize();

  const grid = new Map();
  const cell = spacing;
  muscle.fibers.forEach((f, idx) => {
    const key = gridKey(f.x, f.y, cell);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(idx);
  });
  muscle.pickGrid = { grid, cell };
}

function makeFiber(p, spacing, rand) {
  const r = spacing * 0.47 * (0.88 + rand() * 0.24);
  const n = 8;
  const rot = rand() * Math.PI * 2;
  const verts = new Float32Array(n * 2);
  for (let k = 0; k < n; k++) {
    const a = rot + (k / n) * Math.PI * 2;
    const rr = r * (0.86 + rand() * 0.26);
    verts[k * 2] = p.x + Math.cos(a) * rr;
    verts[k * 2 + 1] = p.y + Math.sin(a) * rr;
  }
  return {
    x: p.x,
    y: p.y,
    r,
    verts,
    mu: null,
    fatigue: 0,
    fatRateVar: 0.85 + rand() * 0.3,
    recoverVar: 0.85 + rand() * 0.3,
    dispA: 0,
    dispFat: 0,
    phase: rand() * Math.PI * 2,
  };
}

function gridKey(x, y, cell) {
  const ix = Math.floor((x + 2) / cell);
  const iy = Math.floor((y + 2) / cell);
  return ix * 4096 + iy;
}

export function pickFiber(muscle, x, y) {
  const { grid, cell } = muscle.pickGrid;
  const ix = Math.floor((x + 2) / cell);
  const iy = Math.floor((y + 2) / cell);
  let best = null;
  let bestD = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const bucket = grid.get((ix + dx) * 4096 + (iy + dy));
      if (!bucket) continue;
      for (const i of bucket) {
        const f = muscle.fibers[i];
        const d = (f.x - x) ** 2 + (f.y - y) ** 2;
        if (d < bestD) { bestD = d; best = f; }
      }
    }
  }
  return best && bestD < (best.r * 1.8) ** 2 ? best : null;
}

function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// Andrew's monotone chain.
function convexHull(pts) {
  if (pts.length < 3) return pts.map((p) => [p.x, p.y]);
  const sorted = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper).map((p) => [p.x, p.y]);
}
