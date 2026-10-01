import { Car, CAR_SPEC } from "./car.js";
import { Road } from "./road.js";
import { RayFan } from "./sensors.js";
import { Traffic } from "./traffic.js";
import { clamp, polygonsOverlap, polygonTouchesPolyline, wrapAngle } from "./geometry.js";

export const DT = 1 / 60;

export const SENSOR_CONFIG = Object.freeze({
  count: 11,
  spread: Math.PI * 0.9,
  range: 70,
  mirrors: [Math.PI * 0.75, Math.PI, -Math.PI * 0.75],
  mirrorRange: 40,
});

const RAY_COUNT = SENSOR_CONFIG.count + SENSOR_CONFIG.mirrors.length;

/**
 * Inputs: each ray's reading and how fast it is closing in (one frame of
 * distances can't tell a parked car from one doing 100 km/h), then what a
 * lane-keeping camera would report (offset from the road's center line and
 * heading relative to it), then speed and how hard the car is turning.
 */
export const INPUT_SIZE = RAY_COUNT * 2 + 4;
export const DEFAULT_LAYERS = Object.freeze([INPUT_SIZE, 20, 10, 2]);

// closing rates are scaled so this many m/s reads as 1
const CLOSING_SCALE = 30;
// and heading error so this many radians does
const HEADING_SCALE = 0.5;

const START_S = 12;

const RULES = {
  // the sweeper: a line moving up the road at 18 km/h, anyone behind it is
  // out. It depends only on time, so traffic can be spawned and cleaned up
  // without ever looking at the learning cars.
  sweepGrace: 8,
  sweepPace: 5,
  // and a car that hasn't gained a meter in this long has given up
  idleLimit: 5,
};

export class Driver {
  constructor(brain, car, index) {
    this.brain = brain;
    this.car = car;
    this.index = index;
    this.sensors = new RayFan(SENSOR_CONFIG);
    this.inputs = new Float64Array(INPUT_SIZE);
    this.previous = null;
    this.alive = true;
    this.crashed = false;
    this.stalled = false;
    this.s = START_S;
    this.d = 0;
    this.roadIndex = 0;
    this.best = START_S;
    this.lastGain = 0;
    this.time = 0;
  }

  /** Meters of road covered, measured along the centerline. */
  get distance() {
    return this.best - START_S;
  }
}

/**
 * One road, its traffic, and any number of learning cars that don't see
 * each other. Stepped at a fixed 1/60 s; the same seed and brains always
 * give the same trajectories.
 */
export class World {
  constructor({ seed, brains, traffic = true, density = 1, lanes = 3 }) {
    this.seed = seed;
    this.time = 0;
    this.steps = 0;
    this.road = new Road(seed, { lanes });
    this.traffic = traffic && density > 0 ? new Traffic(this.road, seed, { density }) : null;
    this.projection = { s: 0, d: 0, index: 0 };
    this.pose = { x: 0, y: 0, heading: 0 };
    this.road.extendTo(this.horizon() + 200);

    const start = this.road.pose(START_S, this.road.laneOffset(Math.floor(lanes / 2)), {});
    this.drivers = brains.map((brain, i) => {
      const driver = new Driver(brain, new Car(start.x, start.y, start.heading), i);
      driver.d = this.road.laneOffset(Math.floor(lanes / 2));
      driver.roadIndex = Math.floor(START_S / this.road.spacing);
      return driver;
    });
    this.alive = this.drivers.length;
    if (this.traffic) this.traffic.spawn(this.horizon());
  }

  /** Arc length below which every car is out of the race at the current time. */
  sweepLine() {
    return START_S + RULES.sweepPace * Math.max(0, this.time - RULES.sweepGrace);
  }

  /** Arc length no car could have reached yet, plus room so spawns are never seen. */
  horizon() {
    return START_S + CAR_SPEC.maxSpeed * this.time + 260;
  }

  step() {
    const road = this.road;
    road.extendTo(this.horizon() + 200);
    if (this.traffic) this.traffic.step(DT, this.sweepLine() - 120, this.horizon());

    for (const driver of this.drivers) {
      if (driver.alive) this.drive(driver);
    }
    this.time += DT;
    this.steps++;
  }

  drive(driver) {
    const { car, sensors, inputs } = driver;
    const road = this.road;

    const readings = sensors.sense(car, road, driver.s, this.traffic);
    const n = readings.length;
    if (!driver.previous) driver.previous = Float64Array.from(readings);
    for (let r = 0; r < n; r++) {
      const closing = ((readings[r] - driver.previous[r]) * sensors.ranges[r]) / DT / CLOSING_SCALE;
      inputs[r] = readings[r];
      // a ray that swaps targets jumps; the clamp keeps that from shouting
      inputs[n + r] = clamp(closing, -1, 1);
      driver.previous[r] = readings[r];
    }
    road.pose(driver.s, 0, this.pose);
    const headingError = wrapAngle(car.heading - this.pose.heading) / HEADING_SCALE;
    inputs[2 * n] = driver.d / road.halfWidth;
    inputs[2 * n + 1] = clamp(headingError, -1, 1);
    inputs[2 * n + 2] = car.speed / car.spec.maxSpeed;
    inputs[2 * n + 3] = car.turning;
    const [pedal, steer] = driver.brain.forward(inputs);
    car.control(pedal, -pedal, steer);
    car.step(DT);

    const p = road.project(car.x, car.y, driver.roadIndex, this.projection);
    driver.s = p.s;
    driver.d = p.d;
    driver.roadIndex = p.index;
    driver.time = this.time + DT;
    if (p.s > driver.best + 1) {
      driver.best = p.s;
      driver.lastGain = driver.time;
    }

    if (this.collides(driver)) {
      this.retire(driver, "crashed");
    } else if (driver.best < this.sweepLine() || driver.time - driver.lastGain > RULES.idleLimit) {
      this.retire(driver, "stalled");
    }
  }

  collides(driver) {
    const { car, s } = driver;
    const road = this.road;
    if (Math.abs(driver.d) > road.halfWidth) return true;
    const [from, to] = road.span(s - car.spec.length, s + car.spec.length);
    if (polygonTouchesPolyline(car.polygon, road.left, from, to)) return true;
    if (polygonTouchesPolyline(car.polygon, road.right, from, to)) return true;
    if (this.traffic) {
      const near = this.traffic.within(s - 8, s + 8);
      for (let k = near.start; k < near.end; k++) {
        if (polygonsOverlap(car.polygon, near.cars[k].polygon)) return true;
      }
    }
    return false;
  }

  retire(driver, reason) {
    driver.alive = false;
    driver[reason] = true;
    this.alive--;
  }

  /** The driver furthest down the road, preferring ones still alive. */
  leader() {
    let best = null;
    for (const driver of this.drivers) {
      if (!best || (driver.alive && !best.alive) || (driver.alive === best.alive && driver.best > best.best)) {
        best = driver;
      }
    }
    return best;
  }
}

/**
 * Drives every brain on one seed until all are out, the clock runs out or
 * every survivor has covered `maxDistance`. Returns one outcome per brain.
 */
export function runEpisode(brains, { seed, seconds = 90, maxDistance = Infinity, traffic = true, density = 1 }) {
  const world = new World({ seed, brains, traffic, density });
  const limit = Math.round(seconds / DT);
  while (world.alive > 0 && world.steps < limit) {
    world.step();
    if (maxDistance < Infinity && world.drivers.every((d) => !d.alive || d.distance >= maxDistance)) break;
  }
  return world.drivers.map((d) => ({
    distance: d.distance,
    time: d.time,
    crashed: d.crashed,
    stalled: d.stalled,
  }));
}
