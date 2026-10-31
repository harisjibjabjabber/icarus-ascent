#!/usr/bin/env bash
# Fetch the spike placeholder model (pixiv VRM1_Constraint_Twist_Sample, VRM Public License 1.0:
# modification + redistribution allowed, commercial OK, credit not required). See art/LICENSES.md.
set -euo pipefail
cd "$(dirname "$0")"; mkdir -p public
curl -sL -o public/heroine.vrm https://raw.githubusercontent.com/vrm-c/vrm-specification/master/samples/VRM1_Constraint_Twist_Sample/vrm/VRM1_Constraint_Twist_Sample.vrm
echo "saved public/heroine.vrm ($(stat -c %s public/heroine.vrm) bytes)"
