import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Brain } from "../src/sim/brain.js";
import { CAR_SPEC, Car } from "../src/sim/car.js";
import { Road } from "../src/sim/road.js";
import { Rng } from "../src/sim/rng.js";
import { DEFAULT_LAYERS, DT, World, runEpisode } from "../src/sim/world.js";

const randomBrains = (n, seed) => {
  const rng = new Rng(seed);
  return Array.from({ length: n }, () => Brain.random(DEFAULT_LAYERS, rng));
};

test("the road curves and is parameterized by arc length", () => {
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
  const { rollingResistance, engineBrake, maxAccel } = car.spec;
  car.control((rollingResistance + engineBrake) / (maxAccel + engineBrake), 0, 1);
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

test("without learning cars, traffic is a pure function of the seed", () => {
  const a = new World({ seed: 5, brains: [] });
  const b = new World({ seed: 5, brains: [] });
  for (let i = 0; i < 60 * 40; i++) {
    a.step();
    b.step();
  }
  const state = (w) => w.traffic.cars.map((c) => [c.id, c.s, c.d, c.speed]);
  assert.ok(a.traffic.cars.length > 10);
  assert.deepEqual(state(a), state(b));
});

test("traffic keeps its distance behind a slow learning car instead of running into it", () => {
  // 40 km/h in the middle lane, never changing lanes
  const crawler = { forward: (inputs) => [(11 - inputs[15] * CAR_SPEC.maxSpeed) / 2, 0] };
  for (const seed of [1, 2, 3, 4]) {
    const [o] = runEpisode([crawler], { seed, seconds: 120 });
    assert.ok(!o.crashed, `seed ${seed}: rear-ended at ${Math.round(o.distance)} m`);
  }
});

test("traffic that comes up behind a slow learning car overtakes it", () => {
  // the pretrained driver for a minute, passing everyone, then 40 km/h
  const driver = Brain.fromJSON(JSON.parse(readFileSync(new URL("../src/brains/pretrained.json", import.meta.url))));
  let steps = 0;
  const slowdown = {
    forward(inputs) {
      if (steps++ < 60 * 60) return driver.forward(inputs);
      return [(11 - inputs[15] * CAR_SPEC.maxSpeed) / 2, 0];
    },
  };
  const world = new World({ seed: 2, brains: [slowdown], traffic: true });
  const behind = new Set();
  const overtook = new Set();
  for (let i = 0; i < 60 * 150; i++) {
    world.step();
    const me = world.drivers[0];
    if (i < 60 * 70) continue;
    for (const car of world.traffic.cars) {
      if (car.s < me.s - 10) behind.add(car.id);
      else if (car.s > me.s + 10 && behind.has(car.id)) overtook.add(car.id);
    }
  }
  assert.ok(world.drivers[0].alive);
  assert.ok(overtook.size >= 3, `only ${overtook.size} overtook`);
});

test("a car that never moves is swept up as stalled", () => {
  const parked = { forward: () => [-1, 0] };
  const [o] = runEpisode([parked], { seed: 1, seconds: 30 });
  assert.ok(o.stalled && !o.crashed);
  assert.equal(o.distance, 0);
});

test("a car that always asks for the left lane ends up there, centered", () => {
  const world = new World({ seed: 1, brains: [{ forward: () => [0.6, 1] }], traffic: false });
  for (let i = 0; i < 60 * 20; i++) world.step();
  const driver = world.drivers[0];
  assert.ok(driver.alive);
  assert.equal(driver.planner.lane, 0);
  assert.ok(Math.abs(driver.d - world.road.laneOffset(0)) < 0.3, `offset ${driver.d}`);
});

test("below the grip limit, the planner keeps a car within half a meter of its lane center", () => {
  // 90 km/h; the tightest bends are about 110 m, which needs 5.7 m/s^2 of the 8 there are
  const cruise = { forward: (inputs) => [(25 - inputs[15] * CAR_SPEC.maxSpeed) / 2, 0] };
  for (const seed of [1, 2, 3, 4]) {
    const world = new World({ seed, brains: [cruise], traffic: false });
    let worst = 0;
    for (let i = 0; i < 60 * 60; i++) {
      world.step();
      worst = Math.max(worst, Math.abs(world.drivers[0].d - world.road.laneOffset(1)));
    }
    assert.ok(world.drivers[0].alive);
    assert.ok(worst < 0.5, `seed ${seed} drifted ${worst.toFixed(2)} m off center`);
  }
});

test("a grid start spreads the cars over lanes and rows, each measured from its own start", () => {
  const world = new World({ seed: 3, brains: randomBrains(9, 4), grid: true });
  const spots = new Set(world.drivers.map((d) => `${d.planner.lane}:${d.s}`));
  assert.equal(spots.size, 9);
  assert.ok(world.drivers.every((d) => d.distance === 0));
  const front = Math.max(...world.drivers.map((d) => d.s));
  assert.ok(world.traffic.cars.every((c) => c.s > front + 20));
});

test("cruising in the left lane next to a free one is counted", () => {
  const left = { forward: () => [0.5, 1] };
  const right = { forward: () => [0.5, -1] };
  const [stayLeft, keepRight] = runEpisode([left, right], { seed: 2, seconds: 30, traffic: false });
  assert.ok(stayLeft.lingered > 20, `left ${stayLeft.lingered}`);
  assert.ok(keepRight.lingered < 1, `right ${keepRight.lingered}`);
});
