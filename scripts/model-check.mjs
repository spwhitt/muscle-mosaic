// Headless sanity check of the physiology: run scripted scenarios and print
// the trajectory. Run with `pnpm check`.
import { Muscle } from '../js/model.js';
import { buildGeometry } from '../js/geometry.js';

function report(m, label) {
  const s = m.perTypeStats();
  const f = (k) => `${k}: ${s[k].recruited}/${s[k].total} fat ${(s[k].fatigue * 100).toFixed(0)}%`;
  console.log(
    `t=${m.time.toFixed(0).padStart(4)}s ${label.padEnd(10)} ` +
    `drive ${(m.drive * 100).toFixed(0).padStart(3)}%  force ${(m.forceTotal * 100).toFixed(0).padStart(3)}%  ` +
    `${f('S')} | ${f('FR')} | ${f('FF')}${m.failure ? '  ** FAILURE **' : ''}`
  );
}

function run(m, target, seconds, every = 5, label = '') {
  m.setTarget(target);
  const steps = Math.round(seconds / 0.05);
  for (let i = 0; i < steps; i++) {
    m.update(0.05);
    if ((i + 1) % Math.round(every / 0.05) === 0) report(m, label);
  }
}

const m = new Muscle(7);
buildGeometry(m, 11);
console.log(`fibers: ${m.fibers.length}, units: ${m.units.length}`);
console.log(`force shares: S ${(share(m, 'S') * 100).toFixed(0)}%  FR ${(share(m, 'FR') * 100).toFixed(0)}%  FF ${(share(m, 'FF') * 100).toFixed(0)}%`);

function share(m, type) {
  return m.units.filter((u) => u.type === type).reduce((s, u) => s + u.share, 0);
}

console.log('\n--- Scenario 1: sustained 85% (expect recruitment creep, then failure) ---');
run(m, 0.85, 60, 5, 'hold85');

console.log('\n--- Scenario 2: rest 120s (FF should recover fastest, S slowest) ---');
run(m, 0, 120, 20, 'rest');

console.log('\n--- Scenario 3: sustained 45% for 90s (slow creep, no failure) ---');
run(m, 0.40, 90, 15, "hold40");

console.log('\n--- Scenario 4: rest-pause 3× (12s @85% / 8s rest) ---');
for (let r = 0; r < 3; r++) {
  run(m, 0.85, 12, 6, `work${r + 1}`);
  run(m, 0, 8, 8, `rest${r + 1}`);
}
