# Placing the world

Generated props are good; where they were put was not. Earlier games had trees hovering over slopes, houses
half under the ground, rocks on the player's path, a hero the size of a door knob next to a mushroom, and props
sprinkled evenly like confetti. `templates/placement.js` places, seats and checks; this page gives the rules.

## One ground, one scale

- **One height function** `heightAt(x, z)` for everything: the ground mesh is built from it, props sit on it,
  the hero stands on it. Two sources of truth is how things float.
- **The hero is the ruler.** Fix `HERO_HEIGHT` (1.7 m for a person) and size everything in hero heights, read
  off the video's frames:

| Thing | Hero heights |
|---|---|
| grass, flowers, small pickups | 0.1 to 0.4 |
| rocks, bushes, crates | 0.2 to 1.6 |
| doors | 1.2 to 1.4 |
| trees | 2 to 6 |
| houses | 2.5 to 5 |
| towers, landmarks | 6 and up |

  Put those ranges in `SIZES`; the audit flags anything outside them. A stylised video may break them on
  purpose (giant mushrooms): then change the table, do not skip the check.
- **Normalise every model on load** (`normalizeModel`): known height, base at y = 0, centred. Image-to-3D returns
  any size and any origin.

## Decide the lane first

Write down the path the player takes as a few points (`LANE`) with a width, before placing anything.

- Nothing solid on the lane. Obstacles that are part of the game are placed by hand and marked `walkable` or
  given their own check.
- **Line the lane.** The player only sees what is near the path. Groves with `alongLane` set frame the view;
  props scattered across the whole map are wasted and leave the start looking empty.
- **Landmarks by hand, on the sightline.** The goal, the tower, the big tree go where the camera is already
  looking: at the end of a straight, at the outside of a bend, on a rise. One landmark per stretch of path.
- Keep-out circles (`avoid`) around the spawn, the goal, pickups and anything the player must read clearly.

## Scatter in groups, big things first

```js
const trees = scatter({ rand, count: 150, area: AREA, radius: 1.6, clusters: 11, lane: LANE, laneMargin: 1.5, alongLane: 26, heightAt, maxSlope: 22 });
const rocks = scatter({ rand, count: 70, area: AREA, radius: 0.9, lane: LANE, occupied: trees, heightAt });
```

- Order: landmarks, then buildings, then trees, then rocks and bushes, then ground detail. Each kind passes the
  earlier ones as `occupied`, so nothing lands inside something else.
- `clusters` makes groves with open ground between them. Even spread (`clusters: 0`) is for small loose things
  (rocks, tufts). Open space is part of the composition.
- `maxSlope` keeps trees and houses off cliffs. If `scatter` returns fewer than asked, the space is full; do not
  loosen the rules to hit a number.
- Vary every instance: rotation, scale and tint come back with each position. Use them.
- `rng(seed)` drives it, so `?seed=N` builds the same world every time.

## Seat each thing

`settle(heightAt, x, z, { footprint, follow })` returns the height and tilt for one object:

- It sits on the **lowest** point under its base and sinks slightly, so no gap shows on the uphill side.
- `follow: 0` for anything that grows or is built upright (trees, houses, posts). `follow: 1` for things that lie
  on the ground (rocks, logs, bushes); tilt is capped so nothing tips over.
- A building on a slope needs more: a wide `footprint`, and a base or foundation that goes into the ground.
- Things with roots or a base hidden by design (grass cards, flowers) can sink further; raise `sink`.

Record everything you place (`PLACED.push({ name, kind, x, y, z, radius, height })`), including what you place
by hand. What is not recorded is not checked.

## Check it (required)

1. **The audit.** In a scenario or the console: `window.__game.audit()` returns `{ ok, problems, counts }` with
   each floating, buried, overlapping, in-lane or out-of-scale object by name. Ship with `ok: true`, or list the
   exceptions and why in the README.
2. **The map.** Screenshot `?view=map&seed=N`: the whole level from above with the lane drawn. Look for groves
   and gaps (not confetti), a clear lane, things lining it, a landmark at each end of a stretch.
3. **Eye level.** Walk the lane in the recorded take and look at the frames: nothing floating at the horizon,
   no prop cut by the ground, no tree through a roof, sizes that make sense next to the hero.
