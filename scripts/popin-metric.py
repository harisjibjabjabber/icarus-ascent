"""Rough pop-in metric for a frames dir: per consecutive frame pair, the share of pixels in the town part of the
frame (top 55 %, away from Ao/track) that change by > 48/255, minus the local median of that share (camera motion
moves everything a little every frame; a pop is a one-frame spike on top). Prints spike stats.
Usage: python3 scripts/popin-metric.py <framesDir> [<framesDir> ...]"""
import sys, glob
import numpy as np
from PIL import Image
for d in sys.argv[1:]:
    fs = sorted(glob.glob(d + '/*.jpg'))
    prev = None; share = []
    for f in fs:
        a = np.asarray(Image.open(f).convert('L'), dtype=np.int16)
        a = a[: int(a.shape[0] * 0.55)]
        if prev is not None: share.append(float((np.abs(a - prev) > 48).mean()))
        prev = a
    s = np.array(share); spikes = []
    for i in range(len(s)):
        lo, hi = max(0, i - 4), min(len(s), i + 5)
        spikes.append(s[i] - np.median(np.r_[s[lo:i], s[i + 1:hi]]))
    sp = np.array(spikes)
    print(d, 'frames', len(fs), 'spikes>2%', int((sp > 0.02).sum()), 'spikes>4%', int((sp > 0.04).sum()), 'p99 spike %.4f' % np.percentile(sp, 99), 'max %.4f' % sp.max(), 'at frame', int(sp.argmax()) + 1)
