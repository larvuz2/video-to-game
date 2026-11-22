#!/usr/bin/env python3
"""Measure the light in a frame, so "match the lighting" becomes numbers.

With one input it reads a frame of the video and prints what to build: sky and ground colours for the
fill light, the colour of the key light, the haze colour, where the light comes from, how much contrast.
With two inputs (video, then a screenshot or take of the game) it compares them and says what is off.

Usage:
  python3 light_probe.py gameplay.mp4 --time 4                 # measure the video, print a light rig
  python3 light_probe.py gameplay.mp4 shot.png --time 4        # compare the game with the video
  python3 light_probe.py gameplay.mp4 take.mp4 --time 4 --game-time 6 --json

Exit code 1 when a comparison finds differences, 0 when the light matches.
Needs ffmpeg on PATH. Standard library only.
"""
import argparse
import colorsys
import json
import subprocess
import sys

W, H = 96, 54
STILLS = ('.png', '.jpg', '.jpeg', '.webp')


def frame(path, t):
    """One small RGB frame as a list of rows of (r, g, b) in 0..1."""
    cmd = ['ffmpeg', '-v', 'error']
    if not path.lower().endswith(STILLS):
        cmd += ['-ss', str(max(0.0, t))]
    cmd += ['-i', path, '-frames:v', '1', '-vf', f'scale={W}:{H}:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    if len(raw) < W * H * 3:
        sys.exit(f'could not read a frame from {path} at {t}s')
    px = [(raw[i] / 255, raw[i + 1] / 255, raw[i + 2] / 255) for i in range(0, W * H * 3, 3)]
    return [px[y * W:(y + 1) * W] for y in range(H)]


def lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luma(p):
    """Perceptual lightness 0..1 (linear Rec.709 luminance, then a display curve so steps look even)."""
    y = 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2])
    return y ** (1 / 2.2)


def mean(pixels):
    n = max(len(pixels), 1)
    return tuple(sum(p[i] for p in pixels) / n for i in range(3))


def hexc(p):
    return '#%02x%02x%02x' % tuple(max(0, min(255, round(c * 255))) for c in p)


def warmth(p):
    """> 0 warm (red over blue), < 0 cool."""
    return p[0] - p[2]


def measure(rows):
    flat = [p for r in rows for p in r]
    ls = sorted(luma(p) for p in flat)
    q = lambda f: ls[min(len(ls) - 1, int(f * len(ls)))]
    by_l = sorted(flat, key=luma)
    shadows = mean(by_l[:len(by_l) // 5])
    highlights = mean(by_l[-max(1, len(by_l) // 12):])
    sky = mean([p for r in rows[:int(H * 0.18)] for p in r])
    ground = mean([p for r in rows[int(H * 0.78):] for p in r])
    haze = mean([p for r in rows[int(H * 0.34):int(H * 0.48)] for p in r])
    left = sum(luma(p) for r in rows for p in r[:W // 2]) / (H * (W // 2))
    right = sum(luma(p) for r in rows for p in r[W // 2:]) / (H * (W - W // 2))
    # where the brightest 2 % of the picture sits: a hint at the light's direction
    hot = sorted(((luma(rows[y][x]), x, y) for y in range(H) for x in range(W)), reverse=True)[:max(1, W * H // 50)]
    hx = sum(h[1] for h in hot) / len(hot) / (W - 1)
    hy = sum(h[2] for h in hot) / len(hot) / (H - 1)
    sat = sum(colorsys.rgb_to_hsv(*p)[1] for p in flat) / len(flat)
    m = max(highlights) or 1
    return {
        'lightness': round(sum(ls) / len(ls), 3),
        'black_point': round(q(0.05), 3),
        'white_point': round(q(0.95), 3),
        'contrast': round(q(0.95) - q(0.05), 3),
        'saturation': round(sat, 3),
        'sky': hexc(sky), 'ground': hexc(ground), 'haze': hexc(haze),
        'shadows': hexc(shadows), 'highlights': hexc(highlights),
        'shadow_warmth': round(warmth(shadows), 3), 'highlight_warmth': round(warmth(highlights), 3),
        'key_color': hexc(tuple(c / m for c in highlights)),
        'side_balance': round(right - left, 3),
        'hot_spot': [round(hx, 2), round(hy, 2)],
        '_rgb': {'sky': sky, 'ground': ground, 'haze': haze, 'shadows': shadows, 'highlights': highlights},
    }


def rig(m):
    """Turn a measurement into the numbers templates/lighting.js takes."""
    side = 'right' if m['side_balance'] > 0.03 else 'left' if m['side_balance'] < -0.03 else 'front or behind'
    # a hot spot high in the frame is a high sun; low near the horizon is a low, long-shadow sun
    elevation = round(max(12, min(70, 75 - m['hot_spot'][1] * 90)))
    azimuth = round((m['hot_spot'][0] - 0.5) * 120)
    hard = m['contrast'] > 0.62
    return {
        'sky': m['sky'], 'ground': m['ground'], 'haze': m['haze'], 'key_color': m['key_color'],
        'key_from': side, 'key_azimuth_deg': azimuth, 'key_elevation_deg': elevation,
        'key_intensity': round(1.2 + m['contrast'] * 2.6, 2), 'fill_intensity': round(max(0.35, 1.25 - m['contrast']), 2),
        'shadow_softness': 'hard edge (clear sun)' if hard else 'soft (overcast or haze)',
        'shadow_tint': 'cool' if m['shadow_warmth'] < -0.02 else 'warm' if m['shadow_warmth'] > 0.02 else 'neutral',
    }


def dist(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def compare(v, g):
    """Plain sentences for what differs, biggest first. Empty when the light matches."""
    out = []
    d = g['lightness'] - v['lightness']
    if abs(d) > 0.06:
        out.append((abs(d) * 3, f"The game is {'brighter' if d > 0 else 'darker'} overall ({g['lightness']} vs {v['lightness']}): "
                    f"{'lower' if d > 0 else 'raise'} exposure or the fill light."))
    d = g['contrast'] - v['contrast']
    if abs(d) > 0.1:
        out.append((abs(d) * 2, f"The game has {'more' if d > 0 else 'less'} contrast ({g['contrast']} vs {v['contrast']}): "
                    + ('raise the fill or lower the key light.' if d > 0 else 'the scene is flat; raise the key light, lower the fill, check shadows are on.')))
    d = g['black_point'] - v['black_point']
    if abs(d) > 0.07:
        out.append((abs(d) * 2, f"Shadows are {'lifted (milky)' if d > 0 else 'crushed'} ({g['black_point']} vs {v['black_point']}): "
                    + ('lower the grade lift or the fog near the camera.' if d > 0 else 'add fill light or raise the grade lift.')))
    d = g['saturation'] - v['saturation']
    if abs(d) > 0.08:
        out.append((abs(d) * 2, f"Colours are {'more' if d > 0 else 'less'} saturated ({g['saturation']} vs {v['saturation']}): fix it in the grade, not in forty materials."))
    d = g['shadow_warmth'] - v['shadow_warmth']
    if abs(d) > 0.05:
        out.append((abs(d) * 3, f"Shadows are too {'warm' if d > 0 else 'cool'} ({g['shadows']} vs {v['shadows']}): shadow colour comes from the sky fill; tint the hemisphere light."))
    d = g['highlight_warmth'] - v['highlight_warmth']
    if abs(d) > 0.05:
        out.append((abs(d) * 3, f"Lit surfaces are too {'warm' if d > 0 else 'cool'} ({g['highlights']} vs {v['highlights']}): change the key light's colour."))
    for part, hint in (('sky', 'the background and the hemisphere sky colour'), ('haze', 'the fog colour and distance'), ('ground', 'the ground material and the hemisphere ground colour')):
        d = dist(v['_rgb'][part], g['_rgb'][part])
        if d > 0.16:
            out.append((d, f"The {part} differs ({g[part]} vs {v[part]}): check {hint}."))
    if abs(g['side_balance'] - v['side_balance']) > 0.08 and v['side_balance'] * g['side_balance'] <= 0:
        want = 'right' if v['side_balance'] > 0 else 'left'
        out.append((0.3, f"The light comes from the wrong side: the video is lit from the {want}."))
    return [s for _, s in sorted(out, reverse=True)]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('video')
    ap.add_argument('game', nargs='?', help='a screenshot or take of the game, to compare')
    ap.add_argument('--time', type=float, default=2.0, help='time in the video, in seconds')
    ap.add_argument('--game-time', type=float, help='time in the take (default: same as --time)')
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args()

    v = measure(frame(a.video, a.time))
    if not a.game:
        pub = {k: x for k, x in v.items() if not k.startswith('_')}
        if a.json:
            print(json.dumps({'measured': pub, 'rig': rig(v)}, indent=1))
        else:
            print(f'Light in {a.video} at {a.time}s')
            for k, x in pub.items():
                print(f'  {k:17} {x}')
            print('Build the rig with (templates/lighting.js):')
            for k, x in rig(v).items():
                print(f'  {k:19} {x}')
        return 0

    g = measure(frame(a.game, a.game_time if a.game_time is not None else a.time))
    diffs = compare(v, g)
    if a.json:
        strip = lambda m: {k: x for k, x in m.items() if not k.startswith('_')}
        print(json.dumps({'video': strip(v), 'game': strip(g), 'differences': diffs, 'match': not diffs}, indent=1))
    else:
        print(f"{'':17} {'video':>10} {'game':>10}")
        for k in ('lightness', 'contrast', 'black_point', 'saturation', 'sky', 'haze', 'ground', 'shadows', 'highlights'):
            print(f'{k:17} {str(v[k]):>10} {str(g[k]):>10}')
        print('\nLight matches.' if not diffs else '\nWhat to fix, biggest first:')
        for s in diffs:
            print(' -', s)
    return 1 if diffs else 0


if __name__ == '__main__':
    sys.exit(main())
