import { test } from "node:test";
import assert from "node:assert/strict";
import { Brain } from "../src/sim/brain.js";
import { Car } from "../src/sim/car.js";
import { Road } from "../src/sim/road.js";
import { Rng } from "../src/sim/rng.js";
import { DEFAULT_LAYERS, DT, World, runEpisode } from "../src/sim/world.js";

const randomBrains = (n, seed) => {
  const rng = new Rng(seed);
  return Array.from({ length: n }, () => Brain.random(DEFAULT_LAYERS, rng));
};

test("the road curves and is parameterised by arc length", () => {
  const road = new Road(42);
  road.extendTo(3000);
  const turn = Math.max(...road.headings) - Math.min(...road.headings);
  assert.ok(turn > 0.5, `heading only varies by ${turn}`);

  const a = road.pose(1200, 0, {});
  const b = road.pose(1210, 0, {});
  assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - 10) < 0.01);

  for (const [s, d] of [[300, 2.5], [1777.7, -4], [2500, 0]]) {
    const p = road.pose(s, d, {});
    const back = road.project(p.x, p.y, Math.floor(s / road.spacing) - 20, {});
    assert.ok(Math.abs(back.s - s) < 0.05 && Math.abs(back.d - d) < 0.01, `${s},${d} -> ${back.s},${back.d}`);
  }
});

test("the road never turns back on itself", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const road = new Road(seed);
    road.extendTo(6000);
    for (let i = 1; i < road.count; i++) assert.ok(road.ys[i] > road.ys[i - 1]);
  }
});

test("roads are a pure function of the seed, however they are grown", () => {
  const a = new Road(9);
  a.extendTo(2000);
  const b = new Road(9);
  for (let s = 10; s <= 2000; s += 37) b.extendTo(s);
  assert.deepEqual(a.left.slice(0, b.left.length), b.left);
});

test("a car on full throttle tops out at its max speed", () => {
  const car = new Car(0, 0, Math.PI / 2);
  car.control(1, 0, 0);
  for (let i = 0; i < 60 * 30; i++) car.step(DT);
  assert.equal(car.speed, car.spec.maxSpeed);
  assert.ok(Math.abs(car.x) < 1e-9);
});

test("full lock at walking pace traces a circle of the bicycle radius", () => {
  const car = new Car(0, 0, 0, 3);
  car.control(0, 0, 1);
  for (let i = 0; i < 60; i++) car.step(DT);
  car.control(car.spec.rollingResistance / car.spec.maxAccel, 0, 1);
  const xs = [];
  const ys = [];
  for (let i = 0; i < 60 * 20; i++) {
    car.step(DT);
    xs.push(car.x);
    ys.push(car.y);
  }
  const diameter = Math.max(...xs) - Math.min(...xs);
  const { wheelbase, rearToCenter, maxSteer } = car.spec;
  const slip = Math.atan((rearToCenter / wheelbase) * Math.tan(maxSteer));
  const radius = rearToCenter / Math.sin(slip);
  assert.ok(Math.abs(diameter / 2 - radius) < 0.1, `radius ${diameter / 2} vs ${radius}`);
});

test("same seed and brains give the same trajectory", () => {
  const trace = () => {
    const world = new World({ seed: 77, brains: randomBrains(20, 1) });
    const out = [];
    for (let i = 0; i < 60 * 20; i++) {
      world.step();
      if (i % 60 === 0) out.push(...world.drivers.map((d) => d.car.x), ...world.traffic.cars.map((c) => c.s));
    }
    return out;
  };
  assert.deepEqual(trace(), trace());
});

test("traffic does not depend on the learning cars", () => {
  const empty = new World({ seed: 5, brains: [] });
  const busy = new World({ seed: 5, brains: randomBrains(30, 2) });
  for (let i = 0; i < 60 * 40; i++) {
    empty.step();
    busy.step();
  }
  const state = (w) => w.traffic.cars.map((c) => [c.id, c.s, c.d, c.speed]);
  assert.ok(empty.traffic.cars.length > 20);
  assert.deepEqual(state(busy), state(empty));
});

test("a brain scores the same alone as in a crowd", () => {
  const brains = randomBrains(25, 3);
  const crowd = runEpisode(brains, { seed: 12, seconds: 40 });
  for (const i of [0, 7, 19]) {
    const [solo] = runEpisode([brains[i]], { seed: 12, seconds: 40 });
    assert.deepEqual(solo, crowd[i]);
  }
});

test("a car that never moves is swept up as stalled", () => {
  const parked = { forward: () => [-1, 0] };
  const [o] = runEpisode([parked], { seed: 1, seconds: 30 });
  assert.ok(o.stalled && !o.crashed);
  assert.equal(o.distance, 0);
});

test("a car that steers hard left hits the border", () => {
  const reckless = { forward: () => [1, 1] };
  const [o] = runEpisode([reckless], { seed: 1, seconds: 30 });
  assert.ok(o.crashed);
  assert.ok(o.time < 5);
});
