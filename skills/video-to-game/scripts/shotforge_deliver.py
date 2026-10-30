#!/usr/bin/env python3
"""Report progress on a ShotForge build, deliver the finished game to ShotForge, or report a failure.

ShotForge's Video to Game tab starts a Claude Code session with a request that holds the game id,
the delivery URL and a one-time delivery token. This script talks back to it: short progress notes
shown on the page, the game folder uploaded into ShotForge storage, then the game marked playable.

Usage:
  python3 shotforge_deliver.py note "Generating the 3D models" --game ID --url URL --token TOKEN
  python3 shotforge_deliver.py upload path/to/game --game ID --url URL --token TOKEN [--entry index.html]
  python3 shotforge_deliver.py fail "Why the game could not be finished" --game ID --url URL --token TOKEN

--game, --url and --token can also come from SHOTFORGE_GAME, SHOTFORGE_URL and SHOTFORGE_TOKEN.
upload sends every file under the folder (hidden files skipped) and keeps relative paths, so the
game must load its files relatively (assets/hero.glb, src/main.js), never from absolute paths.
"""
import argparse
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.request

TYPES = {
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.webp': 'image/webp',
    '.ktx2': 'image/ktx2',
    '.hdr': 'application/octet-stream',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.html': 'text/html',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
}
BATCH = 50
WARN_BYTES = 50 * 1024 * 1024


def post(url, body, attempts=3):
    data = json.dumps(body).encode()
    for i in range(attempts):
        req = urllib.request.Request(url, data=data, method='POST', headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                return json.loads(res.read() or b'{}')
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors='replace')[:400]
            if e.code < 500 or i == attempts - 1:
                sys.exit(f'ShotForge answered {e.code}: {detail}')
        except urllib.error.URLError as e:
            if i == attempts - 1:
                sys.exit(f'Could not reach ShotForge: {e.reason}')
        time.sleep(2 * (i + 1))


def put(url, path, content_type, attempts=3):
    with open(path, 'rb') as f:
        data = f.read()
    for i in range(attempts):
        req = urllib.request.Request(url, data=data, method='PUT', headers={'Content-Type': content_type, 'x-upsert': 'true'})
        try:
            with urllib.request.urlopen(req, timeout=300) as res:
                res.read()
                return
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors='replace')[:300]
            if e.code < 500 or i == attempts - 1:
                sys.exit(f'Upload of {path} failed ({e.code}): {detail}')
        except urllib.error.URLError as e:
            if i == attempts - 1:
                sys.exit(f'Upload of {path} failed: {e.reason}')
        time.sleep(2 * (i + 1))


def game_files(folder):
    for d, dirs, files in os.walk(folder):
        dirs[:] = sorted(x for x in dirs if not x.startswith('.') and x != 'node_modules')
        for name in sorted(files):
            if name.startswith('.'):
                continue
            full = os.path.join(d, name)
            yield full, os.path.relpath(full, folder).replace(os.sep, '/')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('action', choices=['note', 'upload', 'fail'])
    ap.add_argument('value', help='the note or failure reason, or the game folder for upload')
    ap.add_argument('--game', default=os.environ.get('SHOTFORGE_GAME'))
    ap.add_argument('--url', default=os.environ.get('SHOTFORGE_URL'))
    ap.add_argument('--token', default=os.environ.get('SHOTFORGE_TOKEN'))
    ap.add_argument('--entry', default='index.html', help='the page that starts the game, relative to the folder')
    ap.add_argument('--note', default='', help='upload only: the line shown once the game is playable')
    a = ap.parse_args()
    if not (a.game and a.url and a.token):
        sys.exit('--game, --url and --token are required (or SHOTFORGE_GAME, SHOTFORGE_URL, SHOTFORGE_TOKEN)')
    auth = {'gameId': a.game, 'token': a.token}

    if a.action in ('note', 'fail'):
        post(a.url, {'action': a.action, 'note': a.value, **auth})
        print(f'{a.action} sent')
        return

    folder = a.value
    if not os.path.isfile(os.path.join(folder, a.entry)):
        sys.exit(f'{a.entry} not found in {folder}')
    files = list(game_files(folder))
    total = sum(os.path.getsize(p) for p, _ in files)
    for p, rel in files:
        if os.path.getsize(p) > WARN_BYTES:
            print(f'warning: {rel} is {os.path.getsize(p) // 1_000_000} MB; storage may refuse files over 50 MB')
    print(f'uploading {len(files)} files, {total / 1_000_000:.1f} MB')
    for start in range(0, len(files), BATCH):
        batch = files[start:start + BATCH]
        answer = post(a.url, {'action': 'upload-urls', 'paths': [rel for _, rel in batch], **auth})
        urls = {u['path']: u['url'] for u in answer.get('uploads', [])}
        for p, rel in batch:
            ext = os.path.splitext(rel)[1].lower()
            put(urls[rel], p, TYPES.get(ext) or mimetypes.guess_type(rel)[0] or 'application/octet-stream')
            print(f'  {rel}')
    answer = post(a.url, {'action': 'deliver', 'entry': a.entry, 'note': a.note, **auth})
    print(f'delivered: {answer.get("url")}')


if __name__ == '__main__':
    main()
