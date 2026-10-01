import { test } from "node:test";
import assert from "node:assert/strict";
import { Brain } from "../src/sim/brain.js";
import { Rng } from "../src/sim/rng.js";

const layers = [5, 7, 3, 2];
const input = [0.1, -0.4, 0.9, 0, 0.33];

test("genome length matches the layer sizes", () => {
  assert.equal(Brain.genomeLength(layers), 7 * 6 + 3 * 8 + 2 * 4);
  assert.throws(() => new Brain(layers, new Float64Array(3)));
});

test("forward pass matches a hand computation", () => {
  // two inputs, one output: tanh(0.5*1 + -1*2 + 0.25)
  const brain = new Brain([2, 1], Float64Array.from([0.5, -1, 0.25]));
  assert.equal(brain.forward([1, 2])[0], Math.tanh(-1.25));
});

test("outputs stay in (-1, 1)", () => {
  const brain = Brain.random(layers, new Rng(3));
  for (const x of [-100, -1, 0, 1, 100]) {
    for (const y of brain.forward(input.map((v) => v * x))) assert.ok(y > -1 && y < 1);
  }
});

test("JSON round trip gives identical weights and outputs", () => {
  const brain = Brain.random(layers, new Rng(11));
  const copy = Brain.fromJSON(JSON.parse(JSON.stringify(brain)));
  assert.deepEqual(copy.layers, layers);
  assert.deepEqual(Array.from(copy.weights), Array.from(brain.weights));
  assert.deepEqual(Array.from(copy.forward(input)), Array.from(brain.forward(input)));
});

test("same seed, same network; different seed, different network", () => {
  const a = Brain.random(layers, new Rng(5));
  const b = Brain.random(layers, new Rng(5));
  const c = Brain.random(layers, new Rng(6));
  assert.deepEqual(Array.from(a.weights), Array.from(b.weights));
  assert.notDeepEqual(Array.from(a.weights), Array.from(c.weights));
});

test("mutation is deterministic and leaves the parent alone", () => {
  const parent = Brain.random(layers, new Rng(1));
  const before = Array.from(parent.weights);
  const a = parent.mutated(new Rng(9), 0.3, 0.5);
  const b = parent.mutated(new Rng(9), 0.3, 0.5);
  assert.deepEqual(Array.from(parent.weights), before);
  assert.deepEqual(Array.from(a.weights), Array.from(b.weights));
  const changed = a.weights.filter((w, i) => w !== before[i]).length;
  assert.ok(changed > 0 && changed < before.length);
});

test("uniform crossover takes every weight from one parent", () => {
  const rng = new Rng(2);
  const a = Brain.random(layers, rng);
  const b = Brain.random(layers, rng);
  const child = Brain.crossover(a, b, rng, "uniform");
  let fromA = 0;
  child.weights.forEach((w, i) => {
    assert.ok(w === a.weights[i] || w === b.weights[i]);
    if (w === a.weights[i]) fromA++;
  });
  assert.ok(fromA > 0 && fromA < child.weights.length);
});

test("blend crossover stays near the parents", () => {
  const rng = new Rng(4);
  const a = Brain.random(layers, rng);
  const b = Brain.random(layers, rng);
  const child = Brain.crossover(a, b, rng, "blend");
  child.weights.forEach((w, i) => {
    const lo = Math.min(a.weights[i], b.weights[i]);
    const span = Math.abs(a.weights[i] - b.weights[i]);
    assert.ok(w >= lo - 0.25 * span - 1e-12 && w <= lo + 1.25 * span + 1e-12);
  });
});
