import { test } from "node:test";
import assert from "node:assert/strict";
import { Car } from "../src/sim/car.js";
import { Road } from "../src/sim/road.js";
import { RayFan, fanAngles } from "../src/sim/sensors.js";

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

function centeredCar(road, s = 40) {
  const pose = road.pose(s, 0, {});
  return new Car(pose.x, pose.y, pose.heading);
}

test("fan is symmetric, sorted, and packed toward the front", () => {
  const angles = fanAngles(11, Math.PI);
  assert.equal(angles.length, 11);
  assert.equal(angles[5], 0);
  for (let i = 0; i < 11; i++) assert.ok(close(angles[i], -angles[10 - i]));
  for (let i = 1; i < 11; i++) assert.ok(angles[i] > angles[i - 1]);
  assert.ok(angles[6] - angles[5] < angles[10] - angles[9]);
  assert.ok(close(angles[10], Math.PI / 2));
});

test("side rays on a straight road read the distance to the borders", () => {
  // the first 160 m are straight
  const road = new Road(7);
  road.extendTo(400);
  const car = centeredCar(road);
  const fan = new RayFan({ count: 3, spread: Math.PI, range: 20 });
  const [left, ahead, right] = fan.sense(car, road, 40, null);
  const expected = 1 - road.halfWidth / 20;
  assert.ok(close(left, expected), `left ${left}`);
  assert.ok(close(right, expected), `right ${right}`);
  assert.equal(ahead, 0);
});

test("readings rise as an obstacle gets closer", () => {
  const road = new Road(7);
  road.extendTo(400);
  const car = centeredCar(road);
  const fan = new RayFan({ count: 1, spread: 0, range: 50 });
  // rays start at the center of the car; this puts the obstacle's rear
  // bumper `gap` meters ahead of it
  const readingAt = (gap) => {
    const obstacle = centeredCar(road, 40 + car.spec.length / 2 + gap);
    const traffic = { within: () => ({ cars: [obstacle], start: 0, end: 1 }) };
    return fan.sense(car, road, 40, traffic)[0];
  };
  assert.ok(close(readingAt(10), 1 - 10 / 50));
  assert.ok(close(readingAt(30), 1 - 30 / 50));
  assert.ok(readingAt(5) > readingAt(25));
  assert.equal(readingAt(80), 0);
});

test("mirror rays see a car coming up from behind", () => {
  const road = new Road(7);
  road.extendTo(400);
  const car = centeredCar(road, 60);
  const fan = new RayFan({ count: 1, spread: 0, range: 50, mirrors: [Math.PI], mirrorRange: 30 });
  const follower = centeredCar(road, 60 - car.spec.length / 2 - 9);
  const [ahead, behind] = fan.sense(car, road, 60, { within: () => ({ cars: [follower], start: 0, end: 1 }) });
  assert.equal(ahead, 0);
  assert.ok(close(behind, 1 - 9 / 30));
});

test("ray endpoints stop where they hit", () => {
  const road = new Road(7);
  road.extendTo(400);
  const car = centeredCar(road);
  const fan = new RayFan({ count: 1, spread: 0, range: 30 });
  const obstacle = centeredCar(road, 40 + car.spec.length / 2 + 12);
  fan.sense(car, road, 40, { within: () => ({ cars: [obstacle], start: 0, end: 1 }) });
  assert.ok(close(fan.ends[1] - car.y, 12));
});
