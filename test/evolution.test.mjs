import { test } from "node:test";
import assert from "node:assert/strict";
import { Evolution, fitness } from "../src/sim/evolution.js";

const XOR = [
  [[0, 0], -1],
  [[0, 1], 1],
  [[1, 0], 1],
  [[1, 1], -1],
];

function xorScore(brain) {
  let err = 0;
  for (const [x, y] of XOR) err += (brain.forward(x)[0] - y) ** 2;
  return -err;
}

function train(seed, generations) {
  const evo = new Evolution({ layers: [2, 4, 1], size: 60, seed });
  const history = [];
  for (let g = 0; g < generations; g++) {
    const scores = evo.population.map(xorScore);
    history.push(evo.evolve(scores));
  }
  return history;
}

test("evolution learns xor", () => {
  const history = train(1, 80);
  const first = history[0].best;
  const last = history.at(-1).best;
  assert.ok(last > first + 1, `best went from ${first} to ${last}`);
  assert.ok(last > -0.2, `final squared error ${-last}`);
  for (const [x, y] of XOR) assert.equal(Math.sign(history.at(-1).champion.forward(x)[0]), y);
});

test("elitism never loses the best genome", () => {
  const history = train(2, 30);
  for (let g = 1; g < history.length; g++) assert.ok(history[g].best >= history[g - 1].best);
});

test("same seed, same run", () => {
  const a = train(3, 10).at(-1).champion.weights;
  const b = train(3, 10).at(-1).champion.weights;
  assert.deepEqual(Array.from(a), Array.from(b));
});

test("mutation anneals toward its floor", () => {
  const history = train(4, 60);
  assert.ok(history[0].rate > history[59].rate);
  assert.ok(history[59].rate > 0.03);
});

test("fitness is distance minus penalties", () => {
  assert.equal(fitness({ distance: 500, crashed: false, stalled: false }), 500);
  assert.ok(fitness({ distance: 500, crashed: true, stalled: false }) < 500);
  assert.ok(fitness({ distance: 500, crashed: false, stalled: true }) <= fitness({ distance: 500, crashed: true, stalled: false }));
});
