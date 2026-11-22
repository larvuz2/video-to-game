# Lighting

Grade, bloom and fog (`look-and-post.md`) finish a picture. They cannot light one. A generated model under a
single white light looks like plastic on a void, and that is what made earlier games read as flat next to their
videos. Light the scene first, measure it against the video, then grade.

## Measure the video

```bash
python3 scripts/light_probe.py gameplay.mp4 --time 4        # use the longest steady shot, not a cut
```

It prints the sky, ground and haze colours, the colour and side of the key light, its height, how much contrast
the picture has, and whether shadows are hard or soft, cool or warm. Copy those into `LOOK` in the game. Run it
at two or three times: if the numbers change a lot the video's light moves (sunset, storm), and the game should
pick the key moment's light.

## Build the rig

`templates/lighting.js`, one call:

```js
import { buildLightRig, contactShadow } from './lighting.js';
const rig = buildLightRig(scene, renderer, LOOK);   // sky, ground, haze, keyColor, azimuth, elevation, intensities, soft
rig.castAndReceive(model);                           // every loaded GLB: shadows on, reflections tamed
const blob = contactShadow(0.7); scene.add(blob);    // one per character
// every frame:
rig.follow(hero.position, camera);
blob.place(x, groundY, z, heightAboveGround);
```

What each part is for:

| Part | Job | Sign it is missing |
|---|---|---|
| Sky/ground fill | shadows take the sky's colour, undersides take the ground's | grey or black shadows, flat undersides |
| Key light with shadows | one direction for the whole world, edges that match the video | no shadows, or shadows pointing the wrong way |
| Shadow area that follows the hero | sharp shadows near the player without a huge shadow map | blurry or crawling shadow edges, shadows that stop |
| Rim light from behind | separates the hero from the background | hero melts into the scenery, especially seen from behind |
| Sky reflections | generated PBR materials have something to reflect | dark, dull or pitch-black models |
| Sky painted behind the world | the horizon is the fog colour, so far things fade into it | distant trees become pale cut-outs against the sky |
| Contact shadow | feet sit on the ground | characters look like they hover |

Then the things only the video can tell you:

- **Glowing things light their surroundings.** A lantern, a magic orb or a window is an emissive material plus a
  `PointLight` of the same colour (short `distance`, `decay` 2). Keep to a handful of moving ones; bake the rest
  into the bloom.
- **Time of day is elevation and colour.** Low sun: elevation 10 to 20, warm key, long shadows, cool fill.
  Noon: 55 to 70, near-white key, short shadows. Night: a dim cool key as moonlight, fill nearly off, and
  let the practical lights carry the scene.
- **Indoors or under cover**, drop the fill hard and light with a few coloured point or spot lights; the sky
  rig is for open air.
- **A generated sky image** (from the asset step) replaces the painted one: pass `background: false`, set
  `scene.background` to it, and keep the fog colour equal to its horizon.

## Compare, then fix one thing

```bash
python3 scripts/light_probe.py gameplay.mp4 shot.png --time 4
```

It prints both sets of numbers and what to change, biggest difference first ("the game has less contrast: raise
the key light, lower the fill, check shadows are on"). Fix the first line, take a new screenshot at the same
spot, run it again. Order that converges: exposure and fill, then key strength and colour, then fog, then the
grade. Change the grade last; it hides lighting mistakes without fixing them.

## Check it (required)

- `light_probe.py` on the three side-by-side spots reports "Light matches", or the remaining lines are listed in
  the README as known differences.
- In each pair: shadows fall the same way as in the video, the hero's outline is readable against the
  background, no model is black or chrome, nothing far away is a pale cut-out.
- Shadows do not flicker or crawl in the recorded take.
- Still 60 fps: one shadow-casting light. If the frame rate drops, lower `shadowMap` to 1024 before removing
  anything else.
