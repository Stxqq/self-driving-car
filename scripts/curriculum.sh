#!/bin/sh
# The schedule behind src/brains/pretrained.json: learn to drive fast on an
# empty road, then fade traffic in. A driver trained on full traffic from
# the start settles for sitting behind it at 50 km/h.
set -e
cd "$(dirname "$0")/.."

node scripts/train.mjs --seed 1 --generations 40 --seconds 60 --density 0 "$@"
node scripts/train.mjs --resume --seed 2 --generations 60 --density 0.25 "$@"
node scripts/train.mjs --resume --seed 3 --generations 80 --density 0.5 "$@"
node scripts/train.mjs --resume --seed 4 --generations 80 --density 0.75 "$@"
node scripts/train.mjs --resume --seed 5 --generations 150 --seconds 180 --seeds 5 --density 1 "$@"
