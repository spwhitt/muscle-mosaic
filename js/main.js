import { Muscle } from './model.js';
import { buildGeometry } from './geometry.js';
import { MuscleView } from './view.js';
import { Chart } from './chart.js';
import { initUI } from './ui.js';

const muscle = new Muscle(7);
buildGeometry(muscle, 11);

const view = new MuscleView(document.getElementById('muscle'), muscle);
const chart = new Chart(document.getElementById('chart'));

const sim = { paused: false, timeScale: 1, preset: null };
const ui = initUI({ muscle, view, chart, sim });

// Dev/deep-link support: ?target=0.7&ff=25 pre-rolls the simulation 25 s at
// 70% target force before the first frame.
const params = new URLSearchParams(location.search);
if (params.has('target')) {
  const t = Math.min(1, Math.max(0, Number(params.get('target')) || 0));
  muscle.setTarget(t);
  const slider = document.getElementById('intensity');
  slider.value = Math.round(t * 100);
  document.getElementById('intensity-val').textContent = `${Math.round(t * 100)}%`;
}
if (params.has('ff')) {
  const seconds = Math.min(300, Number(params.get('ff')) || 0);
  for (let s = 0; s < seconds; s += 0.05) {
    muscle.update(0.05);
    chart.push(muscle.time, muscle.forceTotal, muscle.target, muscle.drive, avgFatigue());
  }
  if (params.has('rest')) {
    muscle.setTarget(0);
    const rest = Math.min(300, Number(params.get('rest')) || 0);
    for (let s = 0; s < rest; s += 0.05) {
      muscle.update(0.05);
      chart.push(muscle.time, muscle.forceTotal, muscle.target, muscle.drive, avgFatigue());
    }
    const slider = document.getElementById('intensity');
    slider.value = 0;
    document.getElementById('intensity-val').textContent = '0%';
  }
}
if (params.has('freeze')) {
  sim.paused = true;
  const pauseBtn = document.getElementById('pause');
  pauseBtn.textContent = '▶ Play';
  pauseBtn.classList.add('active');
}

// Paint once synchronously so the canvas has content before the first rAF
// (screenshot tools and some navigations capture before the loop starts).
view.snapDisplay();
view.draw(0, 0, null);
chart.draw(muscle.time);
ui.updateStats(0, true);

let last = performance.now();
function frame(now) {
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!sim.paused) {
    dt *= sim.timeScale;
    ui.updatePreset(dt);
    muscle.update(dt);
    chart.push(muscle.time, muscle.forceTotal, muscle.target, muscle.drive, avgFatigue());
  }
  view.draw(now / 1000, sim.paused ? 0 : dt, ui.getHoverUnit());
  chart.draw(muscle.time);
  ui.updateStats(now);
  requestAnimationFrame(frame);
}

function avgFatigue() {
  let sum = 0;
  for (const u of muscle.units) sum += u.fatigue;
  return sum / muscle.units.length;
}

requestAnimationFrame(frame);
