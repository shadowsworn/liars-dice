#!/bin/sh
# Self-play calibration: play, fit, and repeat so the bots and the coach settle on parameters
# that match how this engine actually plays. Writes js/params.js.
#   sh tools/calibrate.sh [rounds per table size] [passes]
set -e
cd "$(dirname "$0")/.."
ROUNDS=${1:-15000}
PASSES=${2:-3}
WORK=$(mktemp -d)
PREV=${START:--}
for pass in $(seq 1 "$PASSES"); do
  # 1 on 1 uses a fixed model (see js/solver.js), so only 3–6 players are calibrated.
  for n in 3 4 5 6; do
    node tools/selfplay.js "$n" "$ROUNDS" "$PREV" "$WORK/run-$pass-$n.json" &
  done
  wait
  node tools/fit.js "$PREV" "$WORK/params-$pass.json" "$WORK"/run-"$pass"-*.json
  PREV="$WORK/params-$pass.json"
done
echo "Wrote js/params.js"
