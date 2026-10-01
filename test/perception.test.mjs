import { test } from "node:test";
import assert from "node:assert/strict";
import { CAR_SPEC } from "../src/sim/car.js";
import { LaneScan } from "../src/sim/perception.js";

const road = { lanes: 3 };

function trafficOf(...cars) {
  const sorted = cars
    .map(([s, lane, speed, targetLane = lane]) => ({ s, speed, occupies: (l) => l === lane || l === targetLane }))
    .sort((a, b) => a.s - b.s);
  return {
    within(s0, s1) {
      const start = sorted.findIndex((c) => c.s >= s0);
      const end = sorted.findIndex((c) => c.s >= s1);
      return { cars: sorted, start: start < 0 ? sorted.length : start, end: end < 0 ? sorted.length : end };
    },
  };
}

test("lanes are ordered left, own, right, and the edge ones may be missing", () => {
  const scan = new LaneScan().scan(null, road, 100, 0);
  assert.deepEqual(scan.lanes.map((v) => v.lane), [-1, 0, 1]);
  assert.deepEqual(scan.lanes.map((v) => v.exists), [false, true, true]);
});

test("the nearest car ahead and behind in each lane, bumper to bumper", () => {
  const traffic = trafficOf([140, 1, 20], [125, 1, 18], [90, 1, 25], [110, 2, 22], [60, 0, 30]);
  const [left, own, right] = new LaneScan().scan(traffic, road, 100, 1).lanes;
  assert.equal(own.ahead.gap, 25 - CAR_SPEC.length);
  assert.equal(own.ahead.speed, 18);
  assert.equal(own.behind.gap, 10 - CAR_SPEC.length);
  assert.equal(right.ahead.gap, 10 - CAR_SPEC.length);
  assert.equal(right.behind.car, null);
  assert.equal(left.ahead.car, null);
  assert.equal(left.behind.gap, 40 - CAR_SPEC.length);
});

test("a car changing lanes shows up in both", () => {
  const traffic = trafficOf([130, 2, 20, 1]);
  const [, own, right] = new LaneScan().scan(traffic, road, 100, 1).lanes;
  assert.equal(own.ahead.gap, 30 - CAR_SPEC.length);
  assert.equal(right.ahead.gap, 30 - CAR_SPEC.length);
});

test("cars out of range are not tracked", () => {
  const traffic = trafficOf([300, 1, 20], [10, 1, 20]);
  const [, own] = new LaneScan().scan(traffic, road, 100, 1).lanes;
  assert.equal(own.ahead.car, null);
  assert.equal(own.behind.car, null);
  assert.equal(own.ahead.gap, Infinity);
});

test("while moving over, the own lane counts cars in the lane being left", () => {
  const traffic = trafficOf([120, 2, 18]);
  const [, own] = new LaneScan().scan(traffic, road, 100, 1, 2).lanes;
  assert.equal(own.ahead.gap, 20 - CAR_SPEC.length);
});
