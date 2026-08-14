# Muscle Mosaic

An interactive 2D cross-section of a skeletal muscle — ~950 fibers across 50 motor
units — that simulates **motor unit recruitment, rate coding, fatigue, and recovery**
in real time. Built to make the fiber-level effects of training variables (load,
sustained holds, rest intervals, rest-pause, drop sets) visible.

Zero dependencies, no build step: vanilla ES modules + Canvas 2D.

## Run it

```bash
pnpm dev          # → http://localhost:5173
```

or equivalently `node server.mjs`, or any static server (e.g. `python3 -m http.server`).

## What you're looking at

- **The mosaic** — each polygon is a muscle fiber; color family is fiber type:
  - **teal** = Type I (slow) — small, recruited first, very fatigue-resistant
  - **amber** = Type IIa (fast, fatigue-resistant)
  - **orange-red** = Type IIx (fast, fatigable) — large, recruited last
- **Brightness/vividness of the type hue** = current force output of that fiber
  (force = activation × (1 − fatigue), so exhausted fibers dim even at full drive).
- **Violet stain** = fatigue — a channel reserved for fatigue alone. Visible
  mid-contraction, and at rest it lingers as a violet ghost that fades as the
  fiber recovers.
- **Flicker speed** = firing rate (rate coding); a brief **bright pulse** marks a
  motor unit the moment it is recruited.
- **Hover** any fiber to highlight its motor unit's scattered territory and see its
  threshold, firing rate, activation, fatigue, and force contribution.
- The **chart** shows force, neural drive, mean fatigue, and target over the last 90 s.

## Controls

- **Target force slider** — in *Maintain force* mode a controller raises neural drive
  to hold the target as fibers fatigue (this is what drives visible recruitment creep
  and, eventually, contractile failure). *Fixed drive* mode holds drive constant and
  lets force sag — the difference between holding a position vs. holding a constant
  "effort".
- **Protocols** — scripted tension-over-time patterns:
  - *Sustained 40%* — slow recruitment creep; fast units gradually join in
  - *Sustained 85%* — rapid IIx fatigue → failure in ~15 s
  - *Rest-pause 3×* — 12 s @ 85% / 8 s rest; watch partial IIx recovery between rounds
    and declining force capacity
  - *Drop set* — 88% → 60% → 38% with no rest; watch derecruitment in reverse order
- **1×/2×/4×** time scale, pause, reset (clears all fatigue).
- **Rate-coding shimmer** — subtle brightness oscillation whose frequency rises with
  firing rate (slowed for visibility).

## The physiology (and where we cheated)

- **Henneman's size principle** — motor units are recruited smallest-first by
  threshold; derecruitment is reverse-ordered. Recruitment completes by ~88% MVC.
- **Rate coding** — a recruited unit's firing rate (~6→50 Hz) ramps its force from
  ~30% to 100% of capacity. Late-recruited units have a compressed rate-coding range.
- **Fatigue** — accumulates per fiber at a type-specific rate scaled by activation:
  IIx fatigues ~20× faster than Type I. Fatigue multiplies force down.
- **Recovery** — exponential at rest with type-specific time constants: IIx fastest
  (τ ≈ 28 s — think PCr resynthesis / pH restoration), IIa intermediate (τ ≈ 70 s),
  Type I slowest once fatigued (τ ≈ 150 s). *The fibers that did the work need the
  rest; the fibers that fatigue fastest also recover fastest.*
- **Simplifications** — single fatigue scalar per fiber (no separate metabolic vs.
  excitation–contraction coupling components), lumped force–frequency curve, uniform
  overlapping MU territories, no potentiation, no afferent feedback, fiber counts
  scaled down ~100×.

## Deep links

Query params pre-roll the simulation for sharing a specific state:

- `?target=0.7&ff=25` — 70% contraction, pre-run 25 s
- `?target=0.85&ff=30&rest=45` — 30 s heavy hold then 45 s of recovery

## Development

```bash
pnpm check        # headless physiology sanity check (scripts/model-check.mjs)
```

prints force / drive / per-type fatigue trajectories for the sustained-hold,
recovery, and rest-pause scenarios.

## File map

```
index.html          page shell
css/style.css       dark theme, layout
js/model.js         physiology: motor units, recruitment, rate coding, fatigue (DOM-free)
js/geometry.js      fiber mosaic, fascicles, MU territories, hover picking
js/view.js          canvas renderer (quantized color tables, recruit flash, failure ring)
js/chart.js         rolling 90 s force/drive/fatigue chart
js/ui.js            controls, presets, stats, tooltip
js/main.js          bootstrap + main loop + deep-link pre-roll
server.mjs          zero-dependency static dev server
scripts/model-check.mjs   headless model sanity check
```
