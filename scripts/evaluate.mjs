// Drives the saved brain on seeds it never trained or validated on. With
// --write the numbers go to scripts/results.json, which the README, the
// page and test/pretrained.test.mjs all read.
//
//   node scripts/evaluate.mjs [--brain src/brains/pretrained.json] [--write]

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Brain } from "../src/sim/brain.js";
import { runEpisode } from "../src/sim/world.js";

export const HELD_OUT_SEEDS = Array.from({ length: 30 }, (_, i) => 9001 + i);
export const LIMIT_SECONDS = 300;
export const LIMIT_METERS = 6000;

const root = fileURLToPath(new URL("..", import.meta.url));
const { values: args } = parseArgs({
  options: {
    brain: { type: "string", default: "src/brains/pretrained.json" },
    seeds: { type: "string" },
    write: { type: "boolean", default: false },
  },
});

const brain = Brain.fromJSON(JSON.parse(await readFile(resolve(root, args.brain), "utf8")));
const seeds = args.seeds ? args.seeds.split(",").map(Number) : HELD_OUT_SEEDS;

const runs = [];
console.log(" seed   meters      s   km/h  ended");
for (const seed of seeds) {
  const [o] = runEpisode([brain], { seed, seconds: LIMIT_SECONDS, maxDistance: LIMIT_METERS });
  const ended = o.crashed ? "crashed" : o.stalled ? "stalled" : o.distance >= LIMIT_METERS ? "finished" : "time";
  const kmh = (o.distance / o.time) * 3.6;
  runs.push({ seed, meters: Math.round(o.distance), seconds: +o.time.toFixed(1), kmh: +kmh.toFixed(1), ended });
  console.log(
    String(seed).padStart(5),
    String(Math.round(o.distance)).padStart(8),
    o.time.toFixed(1).padStart(6),
    kmh.toFixed(1).padStart(6),
    "",
    ended,
  );
}
const meanMeters = runs.reduce((a, r) => a + r.meters, 0) / runs.length;
const sorted = runs.map((r) => r.meters).sort((a, b) => a - b);
const mid = sorted.length >> 1;
const medianMeters = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
const survived = runs.filter((r) => r.ended === "time" || r.ended === "finished").length;
console.log(`mean ${meanMeters.toFixed(0)} m, median ${medianMeters.toFixed(0)} m, ${survived} of ${runs.length} still on the road at the end`);

if (args.write) {
  const results = {
    brain: args.brain,
    layers: brain.layers,
    limits: { seconds: LIMIT_SECONDS, meters: LIMIT_METERS },
    meanMeters: Math.round(meanMeters),
    medianMeters: Math.round(medianMeters),
    survived,
    runs,
  };
  await writeFile(resolve(root, "scripts/results.json"), JSON.stringify(results, null, 2) + "\n");
}
