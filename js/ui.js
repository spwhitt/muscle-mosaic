// DOM wiring: intensity control, mode/time toggles, scripted presets,
// stats readouts, legend, and the motor-unit hover tooltip.

import { FIBER_TYPES } from './model.js';
import { pickFiber } from './geometry.js';

const PRESETS = [
  {
    id: 'hold40',
    name: 'Sustained 40%',
    desc: 'Moderate load, long hold — watch recruitment creep',
    segments: [{ dur: 90, target: 0.4 }],
  },
  {
    id: 'hold85',
    name: 'Sustained 85%',
    desc: 'Heavy hold — fast fatigue, then failure',
    segments: [{ dur: 60, target: 0.85 }],
  },
  {
    id: 'restpause',
    name: 'Rest-pause 3×',
    desc: '12 s @ 85% · 8 s rest, ×3',
    segments: Array.from({ length: 3 }, () => [
      { dur: 12, target: 0.85 },
      { dur: 8, target: 0 },
    ]).flat(),
  },
  {
    id: 'dropset',
    name: 'Drop set',
    desc: '88% → 60% → 38%, no rest',
    segments: [
      { dur: 12, target: 0.88 },
      { dur: 12, target: 0.6 },
      { dur: 12, target: 0.38 },
    ],
  },
];

const $ = (id) => document.getElementById(id);

export function initUI({ muscle, view, chart, sim }) {
  const slider = $('intensity');
  const sliderVal = $('intensity-val');
  const sliderLabel = $('intensity-label');

  // --- Intensity slider -------------------------------------------------
  slider.addEventListener('input', () => {
    stopPreset();
    muscle.setTarget(slider.value / 100);
    sliderVal.textContent = `${slider.value}%`;
  });

  // --- Mode toggle ------------------------------------------------------
  const modeBtns = { maintain: $('mode-maintain'), fixed: $('mode-fixed') };
  for (const [mode, btn] of Object.entries(modeBtns)) {
    btn.addEventListener('click', () => {
      muscle.mode = mode;
      for (const [m, b] of Object.entries(modeBtns)) b.classList.toggle('active', m === mode);
      sliderLabel.textContent = mode === 'maintain' ? 'Target force' : 'Neural drive';
    });
  }

  // --- Time scale + pause/reset ----------------------------------------
  for (const btn of document.querySelectorAll('[data-speed]')) {
    btn.addEventListener('click', () => {
      sim.timeScale = Number(btn.dataset.speed);
      for (const b of document.querySelectorAll('[data-speed]')) b.classList.toggle('active', b === btn);
    });
  }
  const pauseBtn = $('pause');
  pauseBtn.addEventListener('click', () => {
    sim.paused = !sim.paused;
    pauseBtn.textContent = sim.paused ? '▶ Play' : '⏸ Pause';
    pauseBtn.classList.toggle('active', sim.paused);
  });
  $('reset').addEventListener('click', () => {
    muscle.reset();
    chart.clear();
    stopPreset();
    slider.value = 0;
    sliderVal.textContent = '0%';
  });
  $('shimmer').addEventListener('change', (e) => { view.shimmer = e.target.checked; });

  // --- Presets ----------------------------------------------------------
  const presetWrap = $('presets');
  const presetBtns = new Map();
  for (const p of PRESETS) {
    const btn = document.createElement('button');
    btn.className = 'preset';
    btn.innerHTML = `<span class="preset-name">${p.name}</span><span class="preset-desc">${p.desc}</span><span class="preset-bar"></span>`;
    btn.addEventListener('click', () => {
      if (sim.preset?.def.id === p.id) stopPreset();
      else startPreset(p);
    });
    presetWrap.appendChild(btn);
    presetBtns.set(p.id, btn);
  }

  function startPreset(def) {
    sim.preset = { def, t: 0, total: def.segments.reduce((s, x) => s + x.dur, 0) };
    for (const [id, b] of presetBtns) b.classList.toggle('active', id === def.id);
  }
  function stopPreset() {
    sim.preset = null;
    for (const b of presetBtns.values()) {
      b.classList.remove('active');
      b.style.setProperty('--progress', '0%');
    }
  }
  function updatePreset(dt) {
    const p = sim.preset;
    if (!p) return;
    p.t += dt;
    let acc = 0;
    let target = 0;
    let done = true;
    for (const seg of p.def.segments) {
      if (p.t < acc + seg.dur) { target = seg.target; done = false; break; }
      acc += seg.dur;
    }
    muscle.setTarget(done ? 0 : target);
    slider.value = Math.round(muscle.target * 100);
    sliderVal.textContent = `${Math.round(muscle.target * 100)}%`;
    const btn = presetBtns.get(p.def.id);
    if (btn) btn.style.setProperty('--progress', `${Math.min(100, (p.t / p.total) * 100)}%`);
    if (done) stopPreset();
  }

  // --- Hover tooltip -----------------------------------------------------
  const tooltip = $('tooltip');
  let hoverUnit = null;
  view.canvas.addEventListener('mousemove', (e) => {
    const p = view.toUnit(e.clientX, e.clientY);
    const fiber = pickFiber(muscle, p.x, p.y);
    hoverUnit = fiber ? fiber.mu : null;
    if (!hoverUnit) {
      tooltip.hidden = true;
      return;
    }
    const u = hoverUnit;
    const T = FIBER_TYPES[u.type];
    tooltip.innerHTML = `
      <div class="tt-title"><span class="dot" style="background:hsl(${T.hue} 70% 55%)"></span>
        Motor unit #${u.id + 1} <span class="tt-type">${T.short}</span></div>
      <div class="tt-grid">
        <span>Fibers</span><b>${u.fiberCount}</b>
        <span>Recruit threshold</span><b>${Math.round(u.threshold * 100)}% MVC</b>
        <span>Status</span><b>${u.recruited ? 'Recruited' : 'Standby'}</b>
        <span>Firing rate</span><b>${u.firingRate.toFixed(0)} Hz</b>
        <span>Activation</span><b>${Math.round(u.activation * 100)}%</b>
        <span>Fatigue</span><b>${Math.round(u.fatigue * 100)}%</b>
        <span>Force output</span><b>${(u.force * 100).toFixed(1)}% MVC</b>
      </div>`;
    tooltip.hidden = false;
    const stage = view.canvas.parentElement.getBoundingClientRect();
    const x = e.clientX - stage.left;
    const y = e.clientY - stage.top;
    tooltip.style.left = `${Math.min(x + 16, stage.width - 190)}px`;
    tooltip.style.top = `${Math.max(8, y - 10)}px`;
  });
  view.canvas.addEventListener('mouseleave', () => {
    hoverUnit = null;
    tooltip.hidden = true;
  });

  // --- Stats (10 Hz) ------------------------------------------------------
  const el = {
    force: $('stat-force'),
    drive: $('stat-drive'),
    recruited: $('stat-recruited'),
    rate: $('stat-rate'),
    status: $('stat-status'),
    types: $('type-rows'),
  };
  const typeRows = {};
  for (const key of Object.keys(FIBER_TYPES)) {
    const T = FIBER_TYPES[key];
    const row = document.createElement('div');
    row.className = 'type-row';
    row.innerHTML = `
      <span class="dot" style="background:hsl(${T.hue} 70% 55%)"></span>
      <span class="type-name">${T.short}</span>
      <span class="type-recruited"></span>
      <div class="fatigue-bar"><div class="fatigue-fill"></div></div>
      <span class="type-force"></span>`;
    el.types.appendChild(row);
    typeRows[key] = {
      recruited: row.querySelector('.type-recruited'),
      fatigue: row.querySelector('.fatigue-fill'),
      force: row.querySelector('.type-force'),
    };
  }

  let lastStats = 0;
  function updateStats(now, force = false) {
    if (!force && now - lastStats < 100) return;
    lastStats = now;
    el.force.textContent = `${Math.round(muscle.forceTotal * 100)}%`;
    el.drive.textContent = `${Math.round(muscle.drive * 100)}%`;
    el.recruited.textContent = `${muscle.recruitedCount} / ${muscle.units.length}`;
    el.rate.textContent = `${muscle.meanFiringRate().toFixed(0)} Hz`;

    const stats = muscle.perTypeStats();
    for (const key of Object.keys(FIBER_TYPES)) {
      const s = stats[key];
      typeRows[key].recruited.textContent = `${s.recruited}/${s.total}`;
      typeRows[key].fatigue.style.width = `${Math.round(s.fatigue * 100)}%`;
      typeRows[key].force.textContent = `${Math.round(s.force * 100)}%`;
    }

    let status;
    let cls = '';
    if (muscle.failure) { status = 'Contractile failure — cannot reach target'; cls = 'bad'; }
    else if (muscle.target > 0.005) { status = 'Contracting'; cls = 'work'; }
    else if (Math.max(...Object.values(stats).map((s) => s.fatigue)) > 0.02) { status = 'Recovering'; cls = 'rest'; }
    else { status = 'Fresh · at rest'; cls = ''; }
    el.status.textContent = status;
    el.status.className = `status ${cls}`;
  }

  return { updatePreset, updateStats, getHoverUnit: () => hoverUnit };
}
