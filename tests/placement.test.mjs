// Run: node tests/placement.test.mjs
import assert from 'node:assert/strict';
import { rng, scatter, settle, audit, distToPath, slopeDeg } from '../skills/video-to-game/templates/placement.js';
const area = { minX: -100, maxX: 100, minZ: -200, maxZ: 0 };
const lane = { points: [{ x: 0, z: 0 }, { x: 10, z: -100 }, { x: -5, z: -200 }], width: 8 };
const hill = (x, z) => 3 * Math.sin(x / 20) + 2 * Math.cos(z / 25);
// same seed, same world
assert.deepEqual(scatter({ rand: rng(7), count: 50, area, lane }), scatter({ rand: rng(7), count: 50, area, lane }));
// nothing on the lane, in keep-outs, or touching
const trees = scatter({ rand: rng(3), count: 200, area, radius: 1.5, clusters: 6, lane, laneMargin: 1, avoid: [{ x: 30, z: -50, r: 10 }], heightAt: hill });
assert.ok(trees.length > 120, `placed ${trees.length}`);
for (const t of trees) {
  assert.ok(distToPath(t.x, t.z, lane.points) >= lane.width / 2 + 1 + t.radius - 1e-9);
  assert.ok(Math.hypot(t.x - 30, t.z + 50) >= 10 + t.radius - 1e-9);
  assert.ok(Math.abs(t.y - hill(t.x, t.z)) < 1e-9);
}
for (let i = 0; i < trees.length; i++) for (let j = i + 1; j < trees.length; j++)
  assert.ok(Math.hypot(trees[i].x - trees[j].x, trees[i].z - trees[j].z) >= (trees[i].radius + trees[j].radius) * 1.15 - 1e-9);
// clusters really group: mean nearest-neighbour distance is much smaller than an even spread's
const nn = (list) => list.reduce((s, a, i) => s + Math.min(...list.filter((_, j) => j !== i).map((b) => Math.hypot(a.x - b.x, a.z - b.z))), 0) / list.length;
const even = scatter({ rand: rng(3), count: trees.length, area, radius: 1.5, lane });
assert.ok(nn(trees) < nn(even) * 0.7, `clustered ${nn(trees).toFixed(1)} vs even ${nn(even).toFixed(1)}`);
// a second kind does not land on the first
const rocks = scatter({ rand: rng(9), count: 80, area, radius: 1, occupied: trees, lane });
for (const r of rocks) for (const t of trees) assert.ok(Math.hypot(r.x - t.x, r.z - t.z) >= (r.radius + t.radius) * 1.15 - 1e-9);
// steep ground is refused
const cliff = (x) => (x > 0 ? x * 2 : 0);
assert.ok(slopeDeg(cliff, 10, 0) > 60);
assert.ok(scatter({ rand: rng(1), count: 60, area, heightAt: cliff }).every((p) => p.x <= 0.6));
// full space returns fewer, never overlapping
assert.ok(scatter({ rand: rng(1), count: 500, area: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 }, radius: 2 }).length < 20);
// settle: sits on the low side, sinks, tilts only when asked and never past the cap
const slope = (x) => x * 0.2;
const up = settle(slope, 0, 0, { footprint: 2, sink: 0 });
assert.ok(Math.abs(up.y - -0.4) < 1e-9 && up.tiltX === 0 && up.tiltZ === 0);
const rock = settle(slope, 0, 0, { footprint: 2, follow: 1 });
assert.ok(Math.abs(rock.tiltZ) > 0.15 && Math.abs(rock.tiltZ) <= (12 * Math.PI) / 180 + 1e-9 && rock.y < -0.4);
// audit names each kind of mistake, and passes a clean world
const flat = () => 0;
const bad = audit([
  { name: 'tree-1', kind: 'tree', x: 20, y: 0.6, z: -20, radius: 1.5, height: 6 },
  { name: 'house-1', kind: 'house', x: 40, y: -3, z: -40, radius: 4, height: 6 },
  { name: 'rock-1', kind: 'rock', x: 1, y: 0, z: -50, radius: 1, height: 1 },
  { name: 'tree-2', kind: 'tree', x: 60, y: 0, z: -60, radius: 1.5, height: 40 },
  { name: 'tree-3', kind: 'tree', x: 60.5, y: 0, z: -60, radius: 1.5, height: 6 },
], { heightAt: flat, heroHeight: 1.7, lane, sizes: { tree: [2, 6], house: [2.5, 5] } });
assert.deepEqual(bad.counts, { floating: 1, buried: 1, in_lane: 1, scale: 1, overlap: 1 });
assert.equal(bad.ok, false);
const good = trees.map((t, i) => ({ name: `t${i}`, kind: 'tree', ...t, y: settle(hill, t.x, t.z, { footprint: t.radius }).y, height: 6 * t.scale }));
const res = audit(good, { heightAt: hill, lane, sizes: { tree: [2, 6] } });
assert.ok(res.ok, JSON.stringify(res.problems.slice(0, 3)));
console.log('placement: all checks pass —', trees.length, 'trees in 6 groves, nn', nn(trees).toFixed(1), 'vs even', nn(even).toFixed(1));
