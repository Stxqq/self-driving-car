// The three things the page can do with a World: let a brain drive, evolve
// a population, or hand the car to the person at the keyboard. Each one
// turns real seconds into fixed 1/60 s sim steps.

import { Evolution, FINE_TUNE, fitness } from "../sim/evolution.js";
import { DEFAULT_LAYERS, DT, World } from "../sim/world.js";

const PAUSE_AFTER_RUN = 1.8;

export const POPULATION = 60;
// a round starts short and grows each time a car is still driving when
// the clock runs out, so early rounds are quick and later ones have room
// to show how far the best car can really go
export const FIRST_ROUND = 45;
export const LONGEST_ROUND = 300;
const ROUND_GROWTH = 1.5;
// sixty cars is a small population; it settles faster than the headless
// trainer's two hundred, and keeps more of the field
const QUICK = { elite: 6, halfLife: 12, mutationRate: [0.12, 0.03], mutationScale: [0.35, 0.08] };
export const SPEEDS = [1, 4, 16, 64];
// meters another car has to gain on the one in focus to take the camera
const LEAD_MARGIN = 25;

export const km = (meters) => (meters / 1000).toFixed(2);

const changesPerKm = (drivers) =>
  (drivers.reduce((n, d) => n + d.planner.changes, 0) / Math.max(1, drivers.reduce((m, d) => m + d.distance, 0))) * 1000;

function ending(driver) {
  const where = `${km(driver.distance)} km`;
  return driver.crashed ? `Crashed at ${where}` : `Too slow, out at ${where}`;
}

class SoloSession {
  constructor({ rng, say }) {
    this.rng = rng;
    this.say = say;
    this.runs = 0;
    this.pending = 0;
    this.pause = 0;
  }

  newRun() {
    this.world = new World({ seed: this.rng.uint(), brains: [this.driverBrain] });
    this.runs++;
    this.pending = 0;
    this.pause = 0;
  }

  get focus() {
    return this.world.drivers[0];
  }

  advance(dt) {
    const driver = this.focus;
    if (!driver.alive) {
      this.pause += dt;
      if (this.pause > PAUSE_AFTER_RUN) this.newRun();
      return;
    }
    this.pending += dt;
    while (this.pending >= DT && driver.alive) {
      this.world.step();
      this.pending -= DT;
    }
    if (!driver.alive) this.finished(driver);
  }

  finished(driver) {
    this.say(ending(driver));
  }
}

/** The loaded brain on a fresh road; a new road whenever it goes out. */
export class WatchSession extends SoloSession {
  constructor({ brain, rng, say }) {
    super({ rng, say });
    this.use(brain);
  }

  use(brain) {
    this.brain = brain;
    this.newRun();
  }

  get driverBrain() {
    return this.brain;
  }

  network() {
    return this.brain;
  }

}

/**
 * The person drives. The network card shows what `shadow` would do from
 * the same inputs, which is a good way to see what it pays attention to.
 */
export class DriveSession extends SoloSession {
  constructor({ pilot, shadow, rng, say }) {
    super({ rng, say });
    this.pilot = pilot;
    this.shadow = shadow;
    this.distances = [];
    this.newRun();
  }

  get driverBrain() {
    return this.pilot;
  }

  newRun() {
    this.pilot.reset();
    super.newRun();
  }

  finished(driver) {
    this.distances.push(driver.distance);
    super.finished(driver);
  }

  get best() {
    return Math.max(this.focus.distance, ...this.distances);
  }

  network() {
    this.shadow.forward(this.focus.inputs);
    return this.shadow;
  }

}

/**
 * Evolution in the page: the whole population drives one road per
 * generation, for a minute at most, then the genetic algorithm picks
 * parents from how far they got.
 */
export class TrainSession {
  constructor({ rng, say, ancestor = null }) {
    this.rng = rng;
    this.say = say;
    this.speed = 1;
    this.pending = 0;
    this.history = [];
    this.champion = null;
    this.roundSeconds = FIRST_ROUND;
    this.evolution = new Evolution({
      layers: DEFAULT_LAYERS,
      size: POPULATION,
      seed: rng.uint(),
      ancestor,
      ...QUICK,
      ...(ancestor && FINE_TUNE),
    });
    this.startGeneration();
  }

  get generation() {
    return this.evolution.generation;
  }

  // a random brain can't learn to steer and dodge at once, so traffic
  // fades in over the first fifteen generations
  get density() {
    return Math.min(1, 0.25 + 0.05 * this.generation);
  }

  startGeneration() {
    this.world = new World({ seed: this.rng.uint(), brains: this.evolution.population, density: this.density, grid: true });
    this.leader = this.world.drivers[0];
  }

  get focus() {
    return this.leader;
  }

  network() {
    return this.leader.brain;
  }


  /** The brain worth keeping: last generation's winner, or the leader before there is one. */
  get best() {
    return this.champion ?? this.leader.brain;
  }

  advance(dt) {
    const started = performance.now();
    this.pending += dt * this.speed;
    while (this.pending >= DT) {
      // at 64x a slow machine can't keep up; drop the time rather than
      // let the backlog make every following frame slower
      if (performance.now() - started > 8) {
        this.pending = 0;
        break;
      }
      this.world.step();
      this.pending -= DT;
      if (this.world.alive === 0 || this.world.time >= this.roundSeconds) this.finishGeneration();
    }
    this.follow();
  }

  // The camera stays on one car until it goes out or another pulls clearly
  // ahead. Following whoever leads this very frame swapped cars every few
  // frames in a tight pack, and the view jittered between them.
  follow() {
    const leader = this.world.leader();
    const current = this.leader;
    if (!current.alive || (leader.alive && leader.best > current.best + LEAD_MARGIN)) this.leader = leader;
  }

  finishGeneration() {
    const drivers = this.world.drivers;
    const scores = drivers.map((d) => fitness({ distance: d.distance, crashed: d.crashed, stalled: d.stalled, lingered: d.lingered }));
    const distances = drivers.map((d) => d.distance);
    const summary = this.evolution.evolve(scores);
    this.champion = summary.champion;
    const best = Math.max(...distances);
    const survived = this.world.alive;
    const crashed = drivers.filter((d) => d.crashed).length;
    this.history.push({
      best,
      mean: distances.reduce((a, b) => a + b, 0) / distances.length,
      survived,
      crashed,
      seconds: this.roundSeconds,
      // over the whole field, so a few weavers don't hide a field that never moves over
      leaderChangesPerKm: (() => { const d = drivers[distances.indexOf(best)]; return (d.planner.changes / Math.max(1, d.distance)) * 1000; })(),
      changesPerKm: (drivers.reduce((n, d) => n + d.planner.changes, 0) / Math.max(1, distances.reduce((a, b) => a + b, 0))) * 1000,
    });
    const why = survived ? `time up, ${survived} still driving` : "everyone out";
    this.say(`Generation ${summary.generation + 1} · ${why} · best ${km(best)} km`);
    if (survived) this.roundSeconds = Math.min(LONGEST_ROUND, Math.round(this.roundSeconds * ROUND_GROWTH));
    this.startGeneration();
  }
}
