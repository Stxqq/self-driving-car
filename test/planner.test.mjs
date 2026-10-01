import { test } from "node:test";
import assert from "node:assert/strict";
import { Car } from "../src/sim/car.js";
import { LaneScan } from "../src/sim/perception.js";
import { CHANGE_TIME, LanePlanner, SIGNAL_LEAD, smootherstep } from "../src/sim/planner.js";
import { Road } from "../src/sim/road.js";
import { DT } from "../src/sim/world.js";

const emptyScan = () => new LaneScan().scan(null, { lanes: 3 }, 0, 1);

function hold(planner, intent, seconds, scan = emptyScan()) {
  for (let t = 0; t < seconds; t += DT) planner.update(intent, 30, scan, DT);
}

test("smootherstep starts and ends flat", () => {
  assert.equal(smootherstep(0), 0);
  assert.equal(smootherstep(1), 1);
  assert.equal(smootherstep(0.5), 0.5);
  assert.ok(smootherstep(0.01) < 1e-5);
});

test("a lane change blinks first, then moves over and settles", () => {
  const planner = new LanePlanner(1, 3);
  hold(planner, 1, SIGNAL_LEAD / 2);
  assert.equal(planner.signal, -1);
  assert.equal(planner.lane, 1);
  hold(planner, 1, SIGNAL_LEAD / 2 + 0.05);
  assert.ok(planner.changing);
  assert.equal(planner.lane, 0);
  hold(planner, 0, CHANGE_TIME);
  assert.ok(!planner.changing);
  assert.equal(planner.signal, 0);
});

test("letting go while it blinks calls the change off", () => {
  const planner = new LanePlanner(1, 3);
  hold(planner, -1, 0.3);
  assert.equal(planner.signal, 1);
  hold(planner, 0, 0.1);
  assert.equal(planner.signal, 0);
  hold(planner, 0, 2);
  assert.equal(planner.lane, 1);
});

test("there is no lane left of the leftmost", () => {
  const planner = new LanePlanner(0, 3);
  hold(planner, 1, 3);
  assert.equal(planner.lane, 0);
  assert.equal(planner.signal, 0);
});

test("it waits, blinking, while a car is level with it in the target lane", () => {
  const planner = new LanePlanner(1, 3);
  const scan = emptyScan();
  scan.lanes[0].ahead.set({ speed: 30 }, -2);
  hold(planner, 1, 2, scan);
  assert.equal(planner.signal, -1);
  assert.ok(!planner.changing);
  scan.lanes[0].ahead.clear();
  hold(planner, 1, DT * 2, scan);
  assert.ok(planner.changing);
});

test("the planned offset eases from one lane center to the next", () => {
  const road = new Road(7);
  road.extendTo(400);
  const planner = new LanePlanner(1, 3);
  assert.equal(planner.offsetAt(road), road.laneOffset(1));
  hold(planner, -1, SIGNAL_LEAD + 0.05);
  const from = road.laneOffset(1);
  const to = road.laneOffset(2);
  assert.ok(Math.abs(planner.offsetAt(road) - from) < 0.01);
  assert.ok(Math.abs(planner.offsetAt(road, CHANGE_TIME / 2) - (from + to) / 2) < 0.1);
  assert.equal(planner.offsetAt(road, CHANGE_TIME), to);
});

test("pure pursuit steers toward the lane it is told to hold", () => {
  const road = new Road(7);
  road.extendTo(400);
  const pose = road.pose(60, road.laneOffset(1), {});
  const car = new Car(pose.x, pose.y, pose.heading, 25);
  assert.ok(Math.abs(new LanePlanner(1, 3).steer(car, road, 60)) < 1e-9);
  // lane 0 is to the left, and positive steer turns left
  assert.ok(new LanePlanner(0, 3).steer(car, road, 60) > 0);
  assert.ok(new LanePlanner(2, 3).steer(car, road, 60) < 0);
});
