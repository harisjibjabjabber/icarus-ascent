#!/usr/bin/env python3
"""Cut Ao review clips from heroine-review.mjs frame dumps into 390x844 MP4 + WebM (chase and side cams).
usage: heroine-cut.py <look>   (reads review/ao/{idle,run,crash}-<look>, writes review/ao/clips/)"""
import json, os, subprocess, sys
look = sys.argv[1]; root = 'review/ao'; out = f'{root}/clips'; os.makedirs(out, exist_ok=True)
def meta(sc): return json.load(open(f'{root}/{sc}-{look}/meta.json'))
def first(m, states, pre=18, post=30, nth=0):
    """frame window around the nth run of any of `states`"""
    runs, cur = [], None
    for x in m:
        if x['state'] in states:
            if cur is None: cur = [x['f'], x['f']]
            else: cur[1] = x['f']
        elif cur: runs.append(cur); cur = None
    if cur: runs.append(cur)
    if len(runs) <= nth: return None
    a, b = runs[nth]; return max(0, a - pre), min(len(m) - 1, b + post)
clips = {}
idle = meta('idle'); clips['idle'] = ('idle', 0, len(idle) - 1)
run = meta('run')
pm = meta('push'); w = first(pm, ['push'], pre=10, post=60)
if w: clips['push'] = ('push', *w)
for name, states, kw in [('grab', ['grabL', 'grabR'], {'pre': 30, 'post': 40}),
                         ('backflip', ['flip'], {'pre': 30, 'post': 45}), ('grind', ['grind'], {}),
                         ('wallride', ['wall'], {}), ('landing', ['landClean', 'landBig', 'landSketchy'], {'pre': 35, 'post': 25})]:
    w = first(run, states, **kw)
    if w: clips[name] = ('run', *w)
    else: print('missing', name)
crash = meta('crash')
fails = [x['f'] for x in crash if x['mode'] == 'failed']
if fails: clips['crash-recover'] = ('crash', max(0, fails[0] - 45), len(crash) - 1)
clips['run-full'] = ('run', 0, len(run) - 1)
for name, (sc, a, b) in clips.items():
    for cam in ('chase', 'side'):
        src = f'{root}/{sc}-{look}/{cam}-%05d.jpg'; base = f'{out}/{look}-{name}-{cam}'
        vf = 'scale=390:844:flags=lanczos'
        common = ['ffmpeg', '-v', 'error', '-y', '-framerate', '30', '-start_number', str(a), '-i', src, '-frames:v', str(b - a + 1), '-vf', vf]
        subprocess.run(common + ['-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', base + '.mp4'], check=True)
        if name != 'run-full':
            subprocess.run(common + ['-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '0', '-row-mt', '1', base + '.webm'], check=True)
    print(f'{look}-{name}: {sc} frames {a}-{b} ({(b - a + 1) / 30:.1f}s)')
json.dump({k: v for k, v in clips.items()}, open(f'{out}/{look}-windows.json', 'w'))
