#!/usr/bin/env bash
# Fetch the free temp-heroine candidates into ../public (gitignored). No accounts needed.
set -euo pipefail
cd "$(dirname "$0")/.."; mkdir -p public
get() { curl -fsSL "$2" -o "public/$1.vrm"; echo "ok $1"; }
# pixiv VRM1_Constraint_Twist_Sample: VRM Public License 1.0 (same file as heroine.vrm)
get pixiv-TwistSample https://raw.githubusercontent.com/vrm-c/vrm-specification/master/samples/VRM1_Constraint_Twist_Sample/vrm/VRM1_Constraint_Twist_Sample.vrm
# Polygonal Mind 100Avatars (CC0), Arweave URLs from github.com/ToxSam/open-source-avatars data/avatars/100avatars-r1.json
get 100av-Rose   https://arweave.net/Ea1KXujzJatQgCFSMzGOzp_UtHqB1pyia--U3AtkMAY
get 100av-Lydia  https://arweave.net/x48D7v037irPQYG7e0vZLDV1E3x5-KookbP9-vaXvYE
get 100av-Kate   https://arweave.net/1q4IQwLQXJVS0JGSpeXlRdazmZYdwJbmLbTv7o0s5Y8
get 100av-Erika  https://arweave.net/GZkfa0SNnrBWluRL_pXpakg7T3K3d4l87__wR4mD3UM
get 100av-Olivia https://arweave.net/MgsNlTetzAoVEC6E-lswj65vp7StkOZXXd5OjjqzYZI
# Quaternius (CC0): download "Universal Base Characters[Standard].zip" and "Modular Character Outfits - Fantasy[Standard].zip"
# from quaternius.itch.io (free, "No thanks, just take me to the downloads"), unzip into one dir Q, then:
#   python build_quaternius_peasant.py  (edit Q at the top)  ->  quat-Peasant.vrm  (headless Blender 5.2 + VRM add-on 4.x)
