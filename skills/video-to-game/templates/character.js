// Character animation for a game rebuilt from a video. Copy next to index.html and import it.
//
// The rigging model returns clips; what makes a character feel alive is everything between them:
//   the right clip for what the body is doing (idle, walk, run, rising, falling, landing, the action);
//   blends between clips, each with its own length (into a run is slow, into a jump is instant);
//   legs that move at the speed of the ground, so feet do not slide;
//   a body that turns smoothly and leans into its turns;
//   weight: a dip on landing, a stretch on take-off.
// See references/character-animation.md.
import * as THREE from 'three';

// What each state is called by the tools that make the clips. First match wins.
const NAMES = {
  idle: /idle|stand|breath|rest/i,
  walk: /walk|stroll/i,
  run: /run|jog|sprint/i,
  jump: /jump(?!.*land)|leap|take.?off|hop/i,
  fall: /fall|air|descend|glid/i,
  land: /land/i,
  action: /attack|punch|slash|swing|throw|cast|interact|use|pick|kick|shoot|wave/i,
};
// Seconds to blend INTO a state. Short where the body commits (jump), longer where it settles (idle).
const FADE = { idle: 0.3, walk: 0.22, run: 0.22, jump: 0.08, fall: 0.2, land: 0.1, action: 0.1 };
const ONCE = new Set(['jump', 'land', 'action']);

/** Remove sideways and forward travel from a clip's root, so the game moves the body and the clip only poses it. */
export function inPlace(clip, rootName) {
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.position')) continue;
    const bone = track.name.slice(0, -'.position'.length);
    if (rootName ? bone !== rootName : !/hips|root|pelvis|armature/i.test(bone)) continue;
    const v = track.values;
    for (let i = 0; i < v.length; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; }   // keep the bounce (y), drop the travel
  }
  return clip;
}

/**
 * How fast the ground must move under a looping clip for the feet not to slide, in metres per second.
 * Poses the model through one loop and measures how far a foot sweeps back and forth: a stride.
 * Returns 0 when it cannot tell (no feet found); then give `speeds` by hand.
 */
export function strideSpeed(root, clip) {
  const feet = [];
  root.traverse((o) => { if (o.isBone && /foot|ankle|toe/i.test(o.name) && !/end/i.test(o.name)) feet.push(o); });
  if (!feet.length || clip.duration <= 0) return 0;
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip); action.play();
  const p = new THREE.Vector3(), inv = new THREE.Matrix4();
  const lo = feet.map(() => [Infinity, Infinity]), hi = feet.map(() => [-Infinity, -Infinity]);
  const steps = 24;
  for (let i = 0; i < steps; i++) {
    mixer.setTime((clip.duration * i) / steps);
    root.updateMatrixWorld(true);
    inv.copy(root.matrixWorld).invert();
    feet.forEach((f, k) => {
      p.setFromMatrixPosition(f.matrixWorld).applyMatrix4(inv);
      lo[k][0] = Math.min(lo[k][0], p.x); hi[k][0] = Math.max(hi[k][0], p.x);
      lo[k][1] = Math.min(lo[k][1], p.z); hi[k][1] = Math.max(hi[k][1], p.z);
    });
  }
  action.stop(); mixer.uncacheRoot(root);
  // a foot sweeps its stride once back (planted) and once forward (in the air) per loop
  const sweep = Math.max(...feet.map((_, k) => Math.hypot(hi[k][0] - lo[k][0], hi[k][1] - lo[k][1])));
  const scale = new THREE.Vector3().setFromMatrixScale(root.matrixWorld).x || 1;
  return (2 * sweep * scale) / clip.duration;
}

export class CharacterAnimator {
  /**
   *   root    the loaded model (gltf.scene)
   *   clips   gltf.animations
   *   map     { run: 'Running', ... } to name clips by hand when their names are unusual
   *   speeds  { walk: 1.6, run: 5 } metres per second each loop was made for; measured when not given
   *   walkAt, runAt  ground speed where idle becomes walk, and walk becomes run
   */
  constructor(root, clips = [], { map = {}, speeds = {}, walkAt = 0.25, runAt, rootBone } = {}) {
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = {};
    this.speeds = {};
    this.state = 'idle';
    this.walkAt = walkAt;
    this.slide = 0;            // metres per second the feet slide on the ground right now (0 is perfect)
    this._lock = 0;            // time left on a one-shot clip
    this._yaw = root.rotation.y; this._lean = 0; this._squash = 0;
    for (const state of Object.keys(NAMES)) {
      const clip = map[state] ? clips.find((c) => c.name === map[state]) : clips.find((c) => NAMES[state].test(c.name));
      if (!clip) continue;
      if (state === 'walk' || state === 'run') inPlace(clip, rootBone);
      const a = this.mixer.clipAction(clip);
      if (ONCE.has(state)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      a.enabled = true; a.setEffectiveWeight(0); a.play();
      this.actions[state] = a;
      if (state === 'walk' || state === 'run') this.speeds[state] = speeds[state] || strideSpeed(root, clip) || (state === 'run' ? 4.5 : 1.5);
    }
    // The measurement counts the planted part of a stride, so it reads low for a run with both feet off the
    // ground. A run slower than 1.8x the walk would look like a walk anyway.
    if (!speeds.run && this.speeds.walk && this.speeds.run) this.speeds.run = Math.max(this.speeds.run, this.speeds.walk * 1.8);
    // walk becomes run halfway between the two clips' own speeds
    this.runAt = runAt ?? (this.speeds.walk && this.speeds.run ? (this.speeds.walk + this.speeds.run) / 2 : 3.2);
    this.has = (s) => !!this.actions[s];
    this.missing = ['idle', 'run', 'jump', 'fall'].filter((s) => !this.has(s));
    if (this.actions.idle) this.actions.idle.setEffectiveWeight(1);
    // with no walk clip, walking is a slowed run; with no run clip, running is a quickened walk
    this._loco = (s) => this.actions[s] ? s : s === 'walk' ? (this.actions.run ? 'run' : 'idle') : (this.actions.walk ? 'walk' : 'idle');
  }

  _go(next) {
    const to = this.actions[next];
    if (next === this.state || !to) return;
    const from = this.actions[this.state];
    to.reset().setEffectiveTimeScale(1).setEffectiveWeight(1);
    if (from) to.crossFadeFrom(from, FADE[next], true); else to.fadeIn(FADE[next]);
    to.play();
    if (ONCE.has(next)) this._lock = to.getClip().duration;
    this.state = next;
  }

  /** Play the action clip once (attack, pick up, cast), then return to moving. */
  act() { if (this.actions.action) { this._lock = 0; this._go('action'); } }

  /**
   * Call every frame.
   *   speed     ground speed in metres per second (horizontal only)
   *   grounded  feet on the ground
   *   vy        vertical speed (positive going up)
   */
  update(dt, { speed = 0, grounded = true, vy = 0 } = {}) {
    const was = this._grounded ?? true;
    this._grounded = grounded;
    this._lock = Math.max(0, this._lock - dt);

    let want;
    if (!grounded) {
      this._fallV = Math.max(0, -vy);                       // how hard the next landing will be
      if (was && vy > 0.5 && this.has('jump')) want = 'jump';             // left the ground going up
      else if (this.state === 'jump' && vy > 0) want = 'jump';             // still rising
      else want = this.has('fall') ? 'fall' : this.state;                  // past the top, or walked off a ledge
    } else if (!was && this.has('land') && this._fallV > 4) {
      want = 'land';                                                       // only a real drop earns a landing clip
    } else if (this._lock > 0 && (this.state === 'land' || this.state === 'action')) {
      want = this.state;                                                   // let a landing or an action finish
    } else {
      // different thresholds going up and coming down, so a speed sitting on the boundary does not flicker
      const toWalk = this.state === 'idle' ? this.walkAt : this.walkAt * 0.6;
      const toRun = this.state === 'run' ? this.runAt * 0.85 : this.runAt;
      want = speed < toWalk ? 'idle' : speed < toRun ? this._loco('walk') : this._loco('run');
    }
    if (!was && grounded) { this._squash = Math.min(0.22, (this._fallV ?? 0) * 0.018); this._fallV = 0; }
    this._go(want);

    // legs at the speed of the ground
    const loop = this.actions[this.state];
    const made = this.speeds[this.state];
    if (loop && made && (this.state === 'walk' || this.state === 'run')) {
      const rate = THREE.MathUtils.clamp(speed / made, 0.55, 1.7);
      loop.setEffectiveTimeScale(rate);
      this.slide = Math.abs(speed - made * rate);
    } else {
      this.slide = this.state === 'idle' && grounded ? speed : 0;
    }

    // weight: dip and recover after a landing
    this._squash = THREE.MathUtils.damp(this._squash, 0, 9, dt);
    this.root.scale.y = (this._baseY ??= this.root.scale.y) * (1 - this._squash);
    this.mixer.update(dt);
  }

  /**
   * Turn `body` (the object the game moves) to face its direction of travel, smoothly, and lean into the turn.
   * Call every frame with the horizontal velocity. `turn` is how fast it swings round (higher = snappier).
   */
  face(body, vx, vz, dt, { turn = 10, lean = 0.05, minSpeed = 0.3 } = {}) {
    const speed = Math.hypot(vx, vz);
    let rate = 0;
    if (speed > minSpeed) {
      const target = Math.atan2(vx, vz);
      const diff = Math.atan2(Math.sin(target - this._yaw), Math.cos(target - this._yaw));   // shortest way round
      const step = diff * (1 - Math.exp(-turn * dt));
      this._yaw += step; rate = dt > 0 ? step / dt : 0;
    }
    this._lean = THREE.MathUtils.damp(this._lean, THREE.MathUtils.clamp(-rate * lean * Math.min(1, speed / 4), -0.16, 0.16), 6, dt);
    body.rotation.set(0, this._yaw, this._lean, 'YXZ');
  }

  /** For window.__game.state: lets a playtest check the animation without looking. */
  get debug() {
    const r = (v) => (v ? +v.toFixed(2) : null);
    return { anim: this.state, slide: +this.slide.toFixed(2), missing: this.missing, clipSpeeds: { walk: r(this.speeds.walk), run: r(this.speeds.run) } };
  }
}

/**
 * Put a loaded model on the game's terms: a known height, feet on y = 0, centred, facing +Z or -Z.
 * Image-to-3D returns any size and any origin; every later number (camera, scale table, shadows) assumes this.
 */
export function normalizeModel(root, { height = 1.7, faceZ = 1 } = {}) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const k = height / (size.y || 1);
  root.scale.multiplyScalar(k);
  root.updateMatrixWorld(true);
  box.setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  root.position.x -= c.x; root.position.z -= c.z; root.position.y -= box.min.y;
  const holder = new THREE.Group();
  holder.add(root);
  if (faceZ < 0) root.rotation.y += Math.PI;
  return holder;
}
