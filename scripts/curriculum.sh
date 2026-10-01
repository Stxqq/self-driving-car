#!/bin/sh
# The schedule behind src/brains/pretrained.json: learn to hold a lane at
# speed on an empty road, then fade traffic in, so the early generations
# aren't all wiped out by the first slow car they meet.
set -e
cd "$(dirname "$0")/.."

node scripts/train.mjs --seed 1 --generations 40 --seconds 60 --density 0 "$@"
node scripts/train.mjs --resume --seed 2 --generations 60 --density 0.25 "$@"
node scripts/train.mjs --resume --seed 3 --generations 80 --density 0.5 "$@"
node scripts/train.mjs --resume --seed 4 --generations 80 --density 0.75 "$@"
node scripts/train.mjs --resume --seed 5 --generations 150 --seconds 180 --seeds 5 --density 1 "$@"
# last, long episodes so that a crash late in the run still costs something
node scripts/train.mjs --resume --seed 6 --generations 100 --seconds 300 --seeds 5 --density 1 "$@"
