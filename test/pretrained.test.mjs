import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Brain } from "../src/sim/brain.js";
import { DEFAULT_LAYERS, runEpisode } from "../src/sim/world.js";

const load = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const results = await load("../scripts/results.json");
const brain = Brain.fromJSON(await load("../src/brains/pretrained.json"));

test("pretrained brain fits the current input layout", () => {
  assert.deepEqual(brain.layers, DEFAULT_LAYERS);
});

test("pretrained brain covers 4 km on average on held-out seeds", () => {
  assert.ok(results.meanMeters >= 4000, `mean ${results.meanMeters} m`);
});

// The README and the page quote results.json; this keeps them honest. Any
// change to the sim that moves a single car by a millimeter shows up here.
// Math.tanh/atan2 differ in the last bit between x64 and arm64 builds of V8,
// and a long episode amplifies that, so the exact numbers only hold on the
// machine type they were recorded on. Elsewhere we check determinism and
// that the brain still drives well.
const recordedHere = `${process.platform}-${process.arch}` === "darwin-arm64";

for (const run of results.runs) {
  test(`held-out seed ${run.seed} reproduces ${run.meters} m`, { skip: !recordedHere && "numbers recorded on darwin-arm64" }, () => {
    const [o] = runEpisode([brain], { seed: run.seed, seconds: results.limits.seconds, maxDistance: results.limits.meters });
    assert.equal(Math.round(o.distance), run.meters);
    assert.equal(+o.time.toFixed(1), run.seconds);
  });
}

test("held-out episodes are deterministic and still average 4 km", () => {
  const opts = { seconds: results.limits.seconds, maxDistance: results.limits.meters };
  const seeds = results.runs.slice(0, 10).map((r) => r.seed);
  const first = seeds.map((seed) => runEpisode([brain], { ...opts, seed })[0].distance);
  const again = seeds.map((seed) => runEpisode([brain], { ...opts, seed })[0].distance);
  assert.deepEqual(again, first);
  const mean = first.reduce((a, b) => a + b, 0) / first.length;
  assert.ok(mean >= 4000, `mean ${Math.round(mean)} m`);
});
