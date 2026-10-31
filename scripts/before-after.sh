#!/usr/bin/env bash
# before-after.sh <before.mp4> <after.mp4> <out.mp4> [beforeLabel] [afterLabel]
set -e
F=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf; [ -f "$F" ] || F=/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf
L1=${4:-before}; L2=${5:-after}
ffmpeg -v error -y -i "$1" -i "$2" -filter_complex \
 "[0:v]scale=390:844,drawtext=fontfile=$F:text='$L1':x=12:y=12:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=6[a];\
  [1:v]scale=390:844,drawtext=fontfile=$F:text='$L2':x=12:y=12:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=6[b];\
  [a][b]hstack=inputs=2:shortest=1" -c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p -movflags +faststart "$3"
