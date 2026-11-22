# Character animation

The rigging model returns clips. A character feels alive because of what happens between them. Earlier games
played one run loop at a fixed speed on a body that snapped to face its direction: the hero skated, popped
between poses and never looked like it had weight. `templates/character.js` fixes the mechanics; this page says
what to ask for and how to check it.

## Ask for enough clips

One rigging call, all clips in one GLB (`fal-ai/meshy/rigging/multi-animation`; read its live list of
`animation_action_ids` before choosing, do not guess ids). Request, in this order of importance:

| State | What to pick | Why |
|---|---|---|
| idle | a breathing or relaxed standing loop | the game starts on it and returns to it; a frozen T-pose reads as broken |
| run | the main travel loop | most of the play time |
| walk | a slower travel loop | starts, stops and slow input need it, or the hero jogs on the spot |
| jump | a take-off / rising pose | played once as the feet leave the ground |
| fall | an in-air or falling loop | everything after the top of a jump, and stepping off ledges |
| land | a short landing | only after a real drop |
| action | the video's mechanic (swing, throw, cast, glide pose) | the reason the game exists |

Minimum to ship: idle, run, jump and fall. If the rigging model has no fall, use its closest in-air clip and name
it with `map: { fall: '<clip name>' }`. `CharacterAnimator.missing` lists what was not found; a hero missing any
of the four is not done.

## Wire it

```js
import { CharacterAnimator, normalizeModel } from './character.js';
loader.load('assets/hero.glb', (g) => {
  hero.add(normalizeModel(rig.castAndReceive(g.scene), { height: HERO_HEIGHT }));
  anim = new CharacterAnimator(g.scene, g.animations);        // finds clips by name; pass { map } if names are odd
  PACE.walk = anim.speeds.walk ?? PACE.walk;                   // move at the speed the clips were made for
  PACE.run = anim.speeds.run ?? PACE.run;
});
// every frame, after moving the hero:
anim.update(dt, { speed, grounded, vy });
anim.face(hero, vel.x, vel.z, dt);
// when the player triggers the mechanic:
anim.act();
```

What it does for you:

- **Picks the state** from speed, grounded and vertical speed, with different thresholds going up and coming down
  so it never flickers between two clips.
- **Blends** into each state over its own time (a jump commits in 0.08 s, an idle settles over 0.3 s).
- **Stops foot sliding.** It measures how fast each travel loop was made to move and plays the loop faster or
  slower to match the ground. That only stretches so far (0.55x to 1.7x), which is why the game takes its walk
  and run speeds from the clips. Tune the level to the character, not the character to the level.
- **Turns and leans.** The body swings round to its direction of travel and tips slightly into the turn.
- **Gives weight.** A dip on landing, scaled by how hard the landing was.

The measured run speed is an estimate and reads low for runs with a long airborne phase. If the close-up shows
feet slipping backwards, pass the real figure: `new CharacterAnimator(scene, clips, { speeds: { run: 5.5 } })`.

## Beyond the kit

- **The mechanic gets its own motion.** Start it with `anim.act()`, and add what a clip cannot: a camera nudge,
  particles from the hand or tool, a held pose for the long version (glide, charge).
- **Secondary motion** sells cloth and tails: a scarf, cape or ears as two or three bones trailing with a spring
  (`angle += (target - angle) * k; target` from velocity), or a simple vertex wobble on a cape plane.
- **Non-humanoid heroes** (a boat, a kite, a rolling ball) have no clips: animate them from physics. Bank into
  turns, pitch with vertical speed, bob on water, squash on impact. The same rule holds: nothing snaps.
- **Other characters** use the same class. Give each a slightly different `timeScale` and start offset so a
  crowd does not move in step.

## Check it (required)

1. `python3 -m http.server 8000`, then film the close-up reel, which walks the hero through idle, walk, run,
   a turn and a jump without any keys:
   `node scripts/record_play.mjs "http://127.0.0.1:8000/?view=hero" play.mjs -o hero.mp4 --seconds 13`
   (any scenario works; `?view=hero` ignores the keyboard).
2. Pull a frame every 0.25 s and look at every one.
3. In a scenario or the console, read `window.__game.state`: `anim` names the current state, `slide` is how many
   metres per second the feet slip (keep it under 0.3 at steady walk and run), `missing` must be empty.

Reject and fix when a frame shows: a T-pose or A-pose, feet above or below the ground, feet sliding while the
legs are planted, the body facing a direction it is not moving in, a pop between two poses, a jump with running
legs, or a character that goes rigid when it stops.
