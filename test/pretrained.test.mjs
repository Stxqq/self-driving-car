import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Brain } from "../src/sim/brain.js";
import { DEFAULT_LAYERS, runEpisode } from "../src/sim/world.js";

const load = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const results = await load("../scripts/results.json");
const brain = Brain.fromJSON(await load("../src/brains/pretrained.json"));

test("pretrained brain fits the current sensor layout", () => {
  assert.deepEqual(brain.layers, DEFAULT_LAYERS);
});

test("pretrained brain covers 2 km on average on held-out seeds", () => {
  assert.ok(results.meanMeters >= 2000, `mean ${results.meanMeters} m`);
});

// The README quotes results.json; this keeps it honest. Any change to the
// sim that moves a single car by a millimeter shows up here.
for (const run of results.runs) {
  test(`held-out seed ${run.seed} reproduces ${run.meters} m`, () => {
    const [o] = runEpisode([brain], { seed: run.seed, seconds: results.limits.seconds, maxDistance: results.limits.meters });
    assert.equal(Math.round(o.distance), run.meters);
    assert.equal(+o.time.toFixed(1), run.seconds);
  });
}
