#!/bin/sh
# Rebuild the web VRMs from the VRoid Hub downloads (sources are not committed: 25 MB each).
# Sources: https://hub.vroid.com/en/characters/-/models/8534999798317965556 (long hair)
#          https://hub.vroid.com/en/characters/-/models/2338813411564378208 (witch)
set -e
SRC=${SRC:-/workspace/freevrm/downloads}
OUT=$(dirname "$0")/../../../public/heroine
mkdir -p "$OUT"
node "$(dirname "$0")/optimize-vrm.mjs" "$SRC/8534999798317965556.vrm" "$OUT/ao-longhair.vrm" --hair 0.4
node "$(dirname "$0")/optimize-vrm.mjs" "$SRC/2338813411564378208.vrm" "$OUT/ao-witch.vrm" --hair 0.35
