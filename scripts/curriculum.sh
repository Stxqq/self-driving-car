#!/bin/sh
# The schedule behind src/brains/pretrained.json: learn to hold a lane at
# speed on an empty road, then fade traffic in, so the early generations
# aren't all wiped out by the first slow car they meet.
set -e
cd "$(dirname "$0")/.."
out=src/brains/pretrained.json

node scripts/train.mjs --seed 1 --generations 40 --seconds 60 --density 0 --out "$out" "$@"
node scripts/train.mjs --resume --seed 2 --generations 60 --density 0.25 --out "$out" "$@"
node scripts/train.mjs --resume --seed 3 --generations 80 --density 0.5 --out "$out" "$@"
node scripts/train.mjs --resume --seed 4 --generations 80 --density 0.75 --out "$out" "$@"
node scripts/train.mjs --resume --seed 5 --generations 150 --seconds 180 --seeds 5 --density 1 --out "$out" "$@"
# last, long episodes so that a crash late in the run still costs something
node scripts/train.mjs --resume --seed 6 --generations 100 --seconds 300 --seeds 5 --density 1 --out "$out" "$@"
# fine-tuning on more roads per generation, after the sim stopped using **
node scripts/train.mjs --resume --seed 7 --generations 60 --seconds 300 --seeds 6 --density 1 --out "$out" "$@"
node scripts/train.mjs --resume --seed 8 --generations 60 --seconds 300 --seeds 10 --density 1 --out "$out" "$@"
