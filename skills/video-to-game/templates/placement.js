// World placement for a game rebuilt from a video. No dependencies: plain numbers in, plain numbers out,
// so the same code runs in the game and in a Node check.
//
// Three jobs:
//   scatter()  where things go: grouped, spaced, off the play lane, on ground that can hold them
//   settle()   how a thing sits: on the surface, sunk a little, leaning with gentle slopes only
//   audit()    what is wrong: floating, buried, overlapping, in the way, out of scale
// See references/world-placement.md.

/** Deterministic random in [0,1) from a seed, so ?seed=N places the same world every time. */
export function rng(seed = 1) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/** Distance from a point to a polyline (the play lane's centre line), on the ground plane. */
export function distToPath(x, z, points) {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
  }
  return points.length === 1 ? Math.hypot(x - points[0].x, z - points[0].z) : best;
}

/** Slope of the ground at a point, in degrees, from a height function. */
export function slopeDeg(heightAt, x, z, step = 0.5) {
  const dx = (heightAt(x + step, z) - heightAt(x - step, z)) / (2 * step);
  const dz = (heightAt(x, z + step) - heightAt(x, z - step)) / (2 * step);
  return (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI;
}

/**
 * Place `count` things of one kind.
 *
 *   area      { minX, maxX, minZ, maxZ }
 *   radius    footprint radius of one thing, in metres (spacing is 2 x radius x spacing)
 *   clusters  0 = even spread; N = grouped into N groves with open ground between them
 *   lane      { points: [{x,z}...], width } the path the player takes; nothing is placed on it
 *   alongLane metres from the lane's edge within which groves are centred (0 = anywhere). The player only sees
 *             what is near the path: groves that line it frame the view, groves in a far corner are wasted.
 *   avoid     [{ x, z, r }] other keep-out circles (spawn, goal, pickups, landmarks)
 *   occupied  things already placed ([{x,z,radius}]), so kinds do not overlap each other
 *   heightAt  (x,z) => ground height; maxSlope in degrees (trees and houses do not grow on cliffs)
 *
 * Returns [{ x, y, z, rot, scale, tint, radius }]. Fewer than `count` when the space is full: that is the
 * honest answer, not a reason to loosen the rules.
 */
export function scatter({
  rand, count, area, radius = 1, spacing = 1.15, clusters = 0, clusterRadius = 14,
  lane = null, laneMargin = 0, alongLane = 0, avoid = [], occupied = [], heightAt = () => 0, maxSlope = 28,
  scale = [0.85, 1.2], tint = 0.08, tries = 30,
}) {
  const placed = [];
  const all = occupied.slice();
  const centres = [];
  const inArea = (x, z) => x >= area.minX && x <= area.maxX && z >= area.minZ && z <= area.maxZ;
  const free = (x, z, r) => {
    if (!inArea(x, z)) return false;
    if (lane && distToPath(x, z, lane.points) < lane.width / 2 + laneMargin + r) return false;
    for (const a of avoid) if (Math.hypot(x - a.x, z - a.z) < a.r + r) return false;
    for (const o of all) if (Math.hypot(x - o.x, z - o.z) < (o.radius + r) * spacing) return false;
    return slopeDeg(heightAt, x, z) <= maxSlope;
  };
  for (let c = 0; c < clusters; c++) {
    for (let t = 0; t < tries * 4; t++) {
      let x = area.minX + rand() * (area.maxX - area.minX), z = area.minZ + rand() * (area.maxZ - area.minZ);
      if (lane && alongLane > 0 && lane.points.length > 1) {
        // a point on the path, pushed out to one side of it
        const i = Math.floor(rand() * (lane.points.length - 1)), a = lane.points[i], b = lane.points[i + 1], t = rand();
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1, side = rand() < 0.5 ? -1 : 1;
        const off = lane.width / 2 + laneMargin + radius + clusterRadius * 0.5 + rand() * alongLane;
        x = a.x + (b.x - a.x) * t + (-(b.z - a.z) / len) * off * side;
        z = a.z + (b.z - a.z) * t + ((b.x - a.x) / len) * off * side;
      }
      // groves keep their distance from each other, which is what leaves meadows between them
      if (free(x, z, radius) && centres.every((k) => Math.hypot(x - k.x, z - k.z) > clusterRadius * 1.6)) { centres.push({ x, z }); break; }
    }
  }
  for (let i = 0; i < count; i++) {
    for (let t = 0; t < tries; t++) {
      let x, z;
      if (centres.length) {
        const k = centres[Math.floor(rand() * centres.length)];
        // denser in the middle of a grove, thinning out: sqrt would be uniform, a plain product bunches
        const d = clusterRadius * rand() * rand() * 1.4, ang = rand() * Math.PI * 2;
        x = k.x + Math.cos(ang) * d; z = k.z + Math.sin(ang) * d;
      } else {
        x = area.minX + rand() * (area.maxX - area.minX); z = area.minZ + rand() * (area.maxZ - area.minZ);
      }
      const s = scale[0] + rand() * (scale[1] - scale[0]);
      const r = radius * s;
      if (!free(x, z, r)) continue;
      const item = { x, y: heightAt(x, z), z, rot: rand() * Math.PI * 2, scale: s, tint: (rand() - 0.5) * 2 * tint, radius: r };
      placed.push(item); all.push(item);
      break;
    }
  }
  return placed;
}

/**
 * How one thing sits on the ground: its base height, a small sink so no gap shows under it on uneven
 * ground, and a tilt that follows gentle slopes (rocks, bushes) or stays upright (trees, buildings).
 * `footprint` is the radius of its base. Returns { y, tiltX, tiltZ }.
 */
export function settle(heightAt, x, z, { footprint = 1, sink = 0.04, follow = 0, maxTilt = 12 } = {}) {
  const r = Math.max(footprint, 0.1);
  const samples = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].map(([dx, dz]) => heightAt(x + dx, z + dz));
  // sit on the lowest corner, or the uphill side floats
  const y = Math.min(...samples) - sink * r;
  const cap = (maxTilt * Math.PI) / 180;
  const clamp = (v) => Math.max(-cap, Math.min(cap, v));
  return {
    y,
    tiltX: follow ? clamp(Math.atan2(samples[3] - samples[4], 2 * r)) * follow : 0,
    tiltZ: follow ? clamp(-Math.atan2(samples[1] - samples[2], 2 * r)) * follow : 0,
  };
}

/**
 * Check a placed world. Each object: { name, kind, x, y, z, radius, height } where y is the object's base.
 *   heroHeight  the hero's height in metres: every size is judged against it
 *   sizes       expected height per kind, in hero heights, as [min, max] (see the scale table in the reference)
 * Returns { ok, problems: [{ type, name, detail }], counts }.
 */
export function audit(objects, { heightAt = () => 0, heroHeight = 1.7, lane = null, sizes = {}, floatTol = 0.08, buryFrac = 0.35 } = {}) {
  const problems = [];
  const add = (type, o, detail) => problems.push({ type, name: o.name ?? o.kind ?? 'object', detail });
  for (const o of objects) {
    const ground = heightAt(o.x, o.z);
    const gap = o.y - ground;
    if (gap > floatTol + 0.02 * (o.radius ?? 1)) add('floating', o, `${gap.toFixed(2)} m above the ground`);
    if (o.height && -gap > o.height * buryFrac) add('buried', o, `${(-gap).toFixed(2)} m under the ground of ${o.height.toFixed(2)} m`);
    if (lane && !o.walkable && distToPath(o.x, o.z, lane.points) < lane.width / 2 + (o.radius ?? 0) * 0.5) add('in_lane', o, 'blocks the path the player takes');
    const want = sizes[o.kind];
    if (want && o.height) {
      const h = o.height / heroHeight;
      if (h < want[0] || h > want[1]) add('scale', o, `${h.toFixed(1)} hero heights tall, expected ${want[0]} to ${want[1]}`);
    }
  }
  for (let i = 0; i < objects.length; i++) {
    for (let j = i + 1; j < objects.length; j++) {
      const a = objects[i], b = objects[j];
      if (a.overlapOk || b.overlapOk || !a.radius || !b.radius) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < (a.radius + b.radius) * 0.6) add('overlap', a, `runs into ${b.name ?? b.kind ?? 'another object'} (${d.toFixed(2)} m apart)`);
    }
  }
  const counts = {};
  for (const p of problems) counts[p.type] = (counts[p.type] || 0) + 1;
  return { ok: problems.length === 0, problems, counts };
}
