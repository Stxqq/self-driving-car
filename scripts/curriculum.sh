#!/bin/sh
# The schedule behind src/brains/pretrained.json. With the planner holding
# the lane, a random network already drives; what it has to learn is when
# to brake and which lane to be in, so it goes straight into full traffic.
# The first two stages were stopped by hand at the generation counts below.
set -e
cd "$(dirname "$0")/.."
out=src/brains/pretrained.json

node scripts/train.mjs --seed 1 --generations 168 --population 200 --seeds 6 --seconds 120 --out "$out" "$@"
# five-minute episodes, so a crash late in the run still costs something
node scripts/train.mjs --resume --seed 2 --generations 183 --population 200 --seeds 8 --seconds 300 --out "$out" "$@"
# after the own lane started counting cars in the lane being left
node scripts/train.mjs --resume --seed 4 --generations 200 --population 200 --seeds 8 --seconds 300 --out "$out" "$@"
node scripts/train.mjs --resume --seed 5 --generations 150 --population 200 --seeds 12 --seconds 300 --out "$out" "$@"
# fine-tune with the keep-right penalty in the fitness
node scripts/train.mjs --resume --seed 6 --generations 150 --population 200 --seeds 8 --seconds 300 --out "$out" "$@"
node scripts/train.mjs --resume --seed 7 --generations 100 --population 200 --seeds 12 --seconds 300 --out "$out" "$@"
