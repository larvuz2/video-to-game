// The light rig for a game rebuilt from a video. Copy next to index.html and import it.
//
// A generated model under one white light looks like plastic on a void. A scene reads as lit when it has:
//   a fill that carries the sky and ground colours (shadows are never grey, they are sky-coloured);
//   one key light that casts the shadows, in the video's direction and colour;
//   a rim light from behind, so the hero separates from the background (the camera mostly sees a back);
//   something to reflect, or every PBR material from image-to-3D renders dull and dark;
//   a contact shadow under the hero, so feet sit on the ground instead of hovering.
// Feed it the numbers from scripts/light_probe.py. See references/lighting.md.
import * as THREE from 'three';

const DEG = Math.PI / 180;

/** A small sky texture (gradient + sun glow) used as background light and reflections. */
function skyEnvironment(renderer, { sky, haze, ground, keyColor, dir }) {
  const w = 256, h = 128;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const css = (v) => '#' + new THREE.Color(v).getHexString();
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, css(sky)); grad.addColorStop(0.47, css(haze)); grad.addColorStop(0.53, css(haze)); grad.addColorStop(1, css(ground));
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  // sun glow at the key light's place on the sky, so highlights on glossy things point the right way
  const u = (Math.atan2(dir.x, -dir.z) / (2 * Math.PI) + 0.5) * w, v = (0.5 - Math.asin(dir.y) / Math.PI) * h;
  for (const off of [-w, 0, w]) {
    const glow = g.createRadialGradient(u + off, v, 0, u + off, v, h * 0.45);
    glow.addColorStop(0, css(keyColor)); glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.9; g.fillStyle = glow; g.fillRect(0, 0, w, h);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  return { env, sky: tex };
}

/**
 * Build the rig. Every option has a default; pass what light_probe.py printed.
 *   sky, ground, haze, keyColor   colours (hex numbers or '#rrggbb')
 *   azimuth, elevation            where the key light comes from, in degrees (0 = from behind the camera's
 *                                 start view, positive = from the right; elevation 15 low sun, 60 high sun)
 *   keyIntensity, fillIntensity   strengths; rimIntensity for the back light (0 turns it off)
 *   shadowRange                   metres around the target that get sharp shadows
 *   soft                          true for an overcast or hazy video (wider, softer shadow edge)
 *   background                    true paints the sky behind the world from the same colours: sky above, haze at
 *                                 the horizon. Fog is the haze colour, so far things fade INTO the horizon. With a
 *                                 flat sky colour they turn into pale cut-outs instead. Pass false when the game
 *                                 has its own generated sky image.
 * Returns { key, fill, rim, env, follow(target, camera), setExposure(v), castAndReceive(root) }.
 */
export function buildLightRig(scene, renderer, {
  sky = 0x8fb4dd, ground = 0x4f6b3a, haze = 0xc9d2da, keyColor = 0xfff1dd,
  azimuth = 35, elevation = 40, keyIntensity = 2.6, fillIntensity = 0.8, rimIntensity = 1.1,
  shadowRange = 45, shadowMap = 2048, soft = false, environment = true, envIntensity = 0.7, background = true,
} = {}) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const dir = new THREE.Vector3(
    Math.sin(azimuth * DEG) * Math.cos(elevation * DEG), Math.sin(elevation * DEG), Math.cos(azimuth * DEG) * Math.cos(elevation * DEG),
  ).normalize();

  const fill = new THREE.HemisphereLight(new THREE.Color(sky), new THREE.Color(ground), fillIntensity);
  const key = new THREE.DirectionalLight(new THREE.Color(keyColor), keyIntensity);
  key.castShadow = true;
  key.shadow.mapSize.set(shadowMap, shadowMap);
  const cam = key.shadow.camera;
  cam.left = cam.bottom = -shadowRange; cam.right = cam.top = shadowRange; cam.near = 1; cam.far = shadowRange * 6;
  cam.updateProjectionMatrix();
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.04;   // no acne on flat ground, no peter-panning under feet
  key.shadow.radius = soft ? 6 : 2.5;

  // rim: opposite the key, low, sky-tinted. It draws the hero's outline against a busy background.
  const rim = new THREE.DirectionalLight(new THREE.Color(sky).lerp(new THREE.Color(0xffffff), 0.5), rimIntensity);
  scene.add(fill, key, key.target, rim, rim.target);

  let env = null;
  if (environment) {
    const made = skyEnvironment(renderer, { sky, haze, ground, keyColor, dir });
    env = made.env;
    scene.environment = env;
    if (background) scene.background = made.sky; else made.sky.dispose();
    if (scene.fog) scene.fog.color.set(haze);
    if ('environmentIntensity' in scene) scene.environmentIntensity = envIntensity;
  }

  const texel = (shadowRange * 2) / shadowMap;
  const snap = (v) => Math.round(v / texel) * texel;
  const back = new THREE.Vector3();

  return {
    key, fill, rim, env, direction: dir,
    /** Call every frame: the shadow area travels with the target in whole texels, so edges do not crawl. */
    follow(target, camera) {
      const p = target.isVector3 ? target : target.position;
      const x = snap(p.x), y = p.y, z = snap(p.z);
      key.target.position.set(x, y, z);
      key.position.set(x + dir.x * shadowRange * 2, y + dir.y * shadowRange * 2, z + dir.z * shadowRange * 2);
      if (camera) {
        // behind the hero as the camera sees it, a little above
        back.subVectors(p, camera.position).setY(0).normalize();
        rim.target.position.copy(p);
        rim.position.set(p.x + back.x * 20, p.y + 9, p.z + back.z * 20);
      }
    },
    setExposure(v) { renderer.toneMappingExposure = v; },
    /** Generated GLBs arrive with shadows off and reflections at full: fix every mesh in one pass. */
    castAndReceive(root, { cast = true, receive = true, envMapIntensity = envIntensity } = {}) {
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = cast; o.receiveShadow = receive;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (m && 'envMapIntensity' in m) m.envMapIntensity = envMapIntensity;
          // image-to-3D exports often come fully metallic, which renders black without a studio around it
          if (m && m.metalness > 0.6 && !m.metalnessMap) m.metalness = 0.15;
        }
      });
      return root;
    },
  };
}

/** A soft dark disc under a character. Cheap, always there, and it is what makes feet look planted. */
export function contactShadow(radius = 0.6, opacity = 0.45) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2; mesh.renderOrder = 1;
  /** Keep it on the ground under the character; it shrinks and fades as they leave the ground. */
  mesh.place = (x, groundY, z, heightAbove = 0) => {
    const k = Math.max(0, 1 - heightAbove / 4);
    mesh.position.set(x, groundY + 0.02, z);
    mesh.scale.setScalar(0.55 + 0.45 * k);
    mesh.material.opacity = opacity * k;
  };
  return mesh;
}
