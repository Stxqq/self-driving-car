import { Car, CAR_SPEC } from "./car.js";
import { Road } from "./road.js";
import { LaneScan, VIEW } from "./perception.js";
import { LanePlanner } from "./planner.js";
import { Traffic } from "./traffic.js";
import { clamp, polygonsOverlap, polygonTouchesPolyline } from "./geometry.js";

export const DT = 1 / 60;

/**
 * Inputs, for the lane to the left, the car's own lane and the one to the
 * right: whether the lane is there, how close the nearest car ahead is and
 * how fast the gap to it is closing, and the same for the nearest car
 * behind. Then speed, how sharp the road gets in the next 100 m, and the
 * state of the planner: a lane change blinking or under way.
 */
export const INPUT_SIZE = 3 * 5 + 4;
export const DEFAULT_LAYERS = Object.freeze([INPUT_SIZE, 12, 8, 2]);

// closing speeds are scaled so this many m/s reads as 1
const CLOSING_SCALE = 15;
// and curvature so a 100 m radius does
const CURVE_SCALE = 100;
const CURVE_LOOKAHEAD = 100;

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
  constructor(brain, car, index, planner) {
    this.brain = brain;
    this.car = car;
    this.index = index;
    this.planner = planner;
    this.scan = new LaneScan();
    this.inputs = new Float64Array(INPUT_SIZE);
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

    const lane = Math.floor(lanes / 2);
    const start = this.road.pose(START_S, this.road.laneOffset(lane), {});
    this.drivers = brains.map((brain, i) => {
      const driver = new Driver(brain, new Car(start.x, start.y, start.heading), i, new LanePlanner(lane, lanes));
      driver.d = this.road.laneOffset(lane);
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
    const { car, planner, inputs } = driver;
    const road = this.road;
    const v = car.speed;

    const scan = driver.scan.scan(this.traffic, road, driver.s, planner.lane, planner.changing ? planner.from : planner.lane);
    let j = 0;
    for (const view of scan.lanes) {
      inputs[j++] = view.exists ? 1 : 0;
      // a lane that isn't there reads as blocked both ways
      inputs[j++] = view.exists ? 1 - clamp(view.ahead.gap / VIEW.ahead, 0, 1) : 1;
      inputs[j++] = view.ahead.car ? clamp((v - view.ahead.speed) / CLOSING_SCALE, -1, 1) : 0;
      inputs[j++] = view.exists ? 1 - clamp(view.behind.gap / VIEW.behind, 0, 1) : 1;
      inputs[j++] = view.behind.car ? clamp((view.behind.speed - v) / CLOSING_SCALE, -1, 1) : 0;
    }
    inputs[j++] = v / car.spec.maxSpeed;
    inputs[j++] = clamp(road.sharpest(driver.s, driver.s + CURVE_LOOKAHEAD) * CURVE_SCALE, 0, 1);
    inputs[j++] = planner.shift;
    inputs[j++] = planner.changing ? 0 : planner.signal;

    const [pedal, lane] = driver.brain.forward(inputs);
    planner.update(lane, v, scan, DT);
    car.control(pedal, -pedal, planner.steer(car, road, driver.s));
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
    laneChanges: d.planner.changes,
  }));
}
