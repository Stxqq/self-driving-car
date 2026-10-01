import { Rng, deriveSeed } from "./rng.js";
import { orientedBox, smoothstep } from "./geometry.js";
import { CAR_SPEC } from "./car.js";

const DEFAULTS = {
  firstSpawn: 70,
  minSpacing: 16,
  maxSpacing: 50,
  // scales how many cars spawn; training starts on emptier roads
  density: 1,
  // desired speeds by lane: the leftmost lane cruises in the top band,
  // each lane to the right one band lower
  topSpeed: 24,
  speedBand: 5,
  laneChangeTime: 3.2,
  // intelligent driver model
  comfortAccel: 1.4,
  comfortBrake: 2.2,
  timeHeadway: 1.3,
  standstillGap: 3,
};

class TrafficCar {
  constructor(id, s, lane, speed, desiredSpeed, nextThink) {
    this.id = id;
    this.s = s;
    this.lane = lane;
    this.targetLane = lane;
    this.changeProgress = 1;
    this.d = 0;
    this.lateralSpeed = 0;
    this.speed = speed;
    this.accel = 0;
    this.desiredSpeed = desiredSpeed;
    this.nextThink = nextThink;
    this.x = 0;
    this.y = 0;
    this.heading = 0;
    this.polygon = new Float64Array(8);
  }

  occupies(lane) {
    return lane === this.lane || lane === this.targetLane;
  }

  get changingLanes() {
    return this.changeProgress < 1;
  }
}

/**
 * Background traffic, simulated in road coordinates (arc length, lateral
 * offset). It never reacts to the learning cars: the caller passes a spawn
 * horizon and a cleanup line that depend only on time, so a seed always
 * produces the same traffic no matter how many cars are learning or how
 * they drive.
 */
export class Traffic {
  constructor(road, seed, options = {}) {
    Object.assign(this, DEFAULTS, options);
    this.road = road;
    this.rng = new Rng(deriveSeed(seed, "traffic"));
    this.cars = [];
    this.nextId = 0;
    this.nextSpawn = this.firstSpawn;
    this.time = 0;
    this.view = { cars: this.cars, start: 0, end: 0 };
    this.pose = { x: 0, y: 0, heading: 0 };
  }

  /** Advances traffic by dt, spawning cars up to `horizon` and dropping those behind `cleanup`. */
  step(dt, cleanup, horizon) {
    const cars = this.cars;
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      if (this.time >= car.nextThink) this.think(car, i);
    }
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      car.accel = this.followAccel(car, i);
    }
    for (const car of cars) {
      const v = car.speed;
      car.speed = Math.max(0, v + car.accel * dt);
      car.s += (v + car.speed) * 0.5 * dt;
      if (car.changingLanes) {
        car.changeProgress = Math.min(1, car.changeProgress + dt / this.laneChangeTime);
        if (car.changeProgress === 1) car.lane = car.targetLane;
      }
    }
    this.time += dt;
    this.sort();
    this.prune(cleanup);
    this.spawn(horizon);
    for (const car of cars) this.place(car, dt);
  }

  /** Cars whose arc length lies in [s0, s1], as a slice view of the sorted list. */
  within(s0, s1) {
    this.view.start = this.lowerBound(s0);
    this.view.end = this.lowerBound(s1);
    return this.view;
  }

  lowerBound(s) {
    let lo = 0;
    let hi = this.cars.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cars[mid].s < s) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  leaderIn(lane, i, s, maxGap) {
    const cars = this.cars;
    for (let j = i + 1; j < cars.length && cars[j].s - s < maxGap; j++) {
      if (cars[j].occupies(lane)) return cars[j];
    }
    return null;
  }

  followAccel(car, i) {
    const v = car.speed;
    // plain multiplies, not **: V8's pow changed between Node releases and a
    // last-bit difference here grows into a different run five minutes later
    const ratio = v / car.desiredSpeed;
    const freeRoad = 1 - ratio * ratio * ratio * ratio;
    let leader = this.leaderIn(car.lane, i, car.s, 150);
    const other = car.changingLanes ? this.leaderIn(car.targetLane, i, car.s, 150) : null;
    if (other && (!leader || other.s < leader.s)) leader = other;
    if (!leader) return this.comfortAccel * freeRoad;

    // overlapping after a cut-in; keep desiredGap / gap finite
    const gap = Math.max(0.1, leader.s - car.s - CAR_SPEC.length);
    const closing = v - leader.speed;
    const desiredGap =
      this.standstillGap +
      Math.max(0, v * this.timeHeadway + (v * closing) / (2 * Math.sqrt(this.comfortAccel * this.comfortBrake)));
    const crowding = desiredGap / gap;
    const accel = this.comfortAccel * (freeRoad - crowding * crowding);
    // IDM asks for unbounded braking when someone cuts in; tires can't give it
    return Math.max(accel, -CAR_SPEC.maxBrake);
  }

  /** Speeds a car spawned in `lane` wants to drive. */
  laneBand(lane) {
    const top = this.topSpeed - lane * this.speedBand;
    return [top - this.speedBand, top];
  }

  // Overtake on the left when stuck behind someone slower, if quick enough
  // for that lane; drift back to the right once it is clear. Nobody changes
  // lanes for no reason, which keeps the fast lane fast.
  think(car, i) {
    const rng = this.rng;
    car.nextThink = this.time + rng.range(1.5, 5);
    if (car.changingLanes) return;

    const leader = this.leaderIn(car.lane, i, car.s, 60);
    const blocked = leader && leader.speed < car.desiredSpeed - 1.5;
    let lane = car.lane;
    if (blocked && car.lane > 0 && car.desiredSpeed > this.laneBand(car.lane - 1)[0] - 1) {
      lane = car.lane - 1;
    } else if (!blocked && car.lane < this.road.lanes - 1 && car.desiredSpeed <= this.laneBand(car.lane + 1)[1] + 1) {
      lane = car.lane + 1;
    }
    if (lane !== car.lane && this.laneIsClear(lane, car)) {
      car.targetLane = lane;
      car.changeProgress = 0;
    }
  }

  laneIsClear(lane, car) {
    for (const other of this.cars) {
      if (other === car || !other.occupies(lane)) continue;
      const ahead = other.s - car.s;
      const needAhead = 12 + Math.max(0, car.speed - other.speed) * 3;
      const needBehind = 10 + Math.max(0, other.speed - car.speed) * 3;
      if (ahead < needAhead && ahead > -needBehind) return false;
    }
    return true;
  }

  sort() {
    const cars = this.cars;
    for (let i = 1; i < cars.length; i++) {
      const car = cars[i];
      let j = i - 1;
      while (j >= 0 && cars[j].s > car.s) {
        cars[j + 1] = cars[j];
        j--;
      }
      cars[j + 1] = car;
    }
  }

  prune(cleanup) {
    let n = 0;
    while (n < this.cars.length && this.cars[n].s < cleanup) n++;
    if (n > 0) this.cars.splice(0, n);
  }

  spawn(horizon) {
    const rng = this.rng;
    const road = this.road;
    while (this.nextSpawn < horizon) {
      const s = this.nextSpawn;
      this.nextSpawn += rng.range(this.minSpacing, this.maxSpacing) / this.density;
      const pick = rng.next();
      const jitter = rng.next();

      const free = [];
      for (let lane = 0; lane < road.lanes; lane++) {
        if (this.cars.every((c) => !c.occupies(lane) || Math.abs(c.s - s) > 22)) free.push(lane);
      }
      // keep at least one lane open at every spawn point
      if (free.length < 2) continue;
      const lane = free[Math.floor(pick * free.length)];
      const [slow, fast] = this.laneBand(lane);
      const desired = slow + (fast - slow) * jitter;

      let speed = desired;
      const at = this.lowerBound(s);
      const ahead = this.leaderIn(lane, at - 1, s, 80);
      if (ahead) speed = Math.min(speed, ahead.speed);

      const car = new TrafficCar(this.nextId++, s, lane, speed, desired, this.time + rng.range(1, 6));
      this.cars.splice(at, 0, car);
      this.place(car, 0);
    }
  }

  place(car, dt) {
    const road = this.road;
    const from = road.laneOffset(car.lane);
    const to = road.laneOffset(car.targetLane);
    const d = car.changingLanes ? from + (to - from) * smoothstep(car.changeProgress) : from;
    car.lateralSpeed = dt > 0 ? (d - car.d) / dt : 0;
    car.d = d;
    road.pose(car.s, d, this.pose);
    car.x = this.pose.x;
    car.y = this.pose.y;
    car.heading = this.pose.heading + Math.atan2(car.lateralSpeed, Math.max(car.speed, 1));
    orientedBox(car.polygon, car.x, car.y, car.heading, CAR_SPEC.length, CAR_SPEC.width);
  }
}
