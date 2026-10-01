import { clamp, wrapAngle } from "./geometry.js";

// seconds the indicator blinks before the car starts to move over, and
// how long the move itself takes; both roughly what a driver-assist
// system does on a highway
export const SIGNAL_LEAD = 0.7;
export const CHANGE_TIME = 2.6;
// after settling into the new lane, before the next change may start
const SETTLE_TIME = 1;
// below this speed, in m/s, a lane change slows down with the car
const CRAWL = 10;
// the network asks for a lane change by pushing its lane output past
// this, and calls it off before the car moves by letting go of it
const ASK = 0.5;
const LET_GO = 0.2;
// The one thing the planner decides by itself: it won't start moving over
// while a car in the target lane is level with this one or about to be,
// the way blind-spot monitoring holds a driver-assist lane change. It
// keeps blinking and goes when the gap opens, if it is still asked to.
const CLEAR_AHEAD = 6;
const CLEAR_BEHIND = 5;
const CLOSING_TIME = 1.5;

function clear(view, speed) {
  const { ahead, behind } = view;
  if (ahead.gap < CLEAR_AHEAD + Math.max(0, speed - ahead.speed) * CLOSING_TIME) return false;
  return behind.gap >= CLEAR_BEHIND + Math.max(0, behind.speed - speed) * CLOSING_TIME;
}

/** Quintic ease: zero lateral speed and acceleration at both ends. */
export const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * Turns "this lane" or "the next one over" into a path and steers along
 * it. The network only ever picks the lane; this keeps the car centered,
 * blinks before a change, moves over on a smooth S-curve and settles.
 */
export class LanePlanner {
  constructor(lane, lanes) {
    this.lanes = lanes;
    this.lane = lane;
    this.from = lane;
    this.progress = 1;
    // -1 left, +1 right, 0 off; it keeps blinking until the change is done
    this.signal = 0;
    this.signalTime = 0;
    this.cooldown = 0;
    this.changes = 0;
    this.target = { x: 0, y: 0, heading: 0 };
  }

  get changing() {
    return this.progress < 1;
  }

  /** Lane change from -1 (one to the left) to +1 (one to the right) in progress, 0 when holding a lane. */
  get shift() {
    return this.changing ? (this.lane - this.from) * this.progress : 0;
  }

  /** `intent` > 0 asks for the lane to the left, < 0 for the one to the right. */
  update(intent, speed, scan, dt) {
    if (this.changing) {
      // a crawling car can't move sideways any faster than it moves on
      this.progress = Math.min(1, this.progress + (dt / CHANGE_TIME) * Math.min(1, speed / CRAWL));
      if (!this.changing) {
        this.signal = 0;
        this.cooldown = SETTLE_TIME;
      }
      return;
    }
    if (this.signal !== 0) {
      if (Math.abs(intent) < LET_GO || Math.sign(-intent) !== this.signal) {
        this.signal = 0;
        return;
      }
      this.signalTime += dt;
      if (this.signalTime >= SIGNAL_LEAD && clear(scan.lanes[1 + this.signal], speed)) {
        this.from = this.lane;
        this.lane += this.signal;
        this.progress = 0;
        this.changes++;
      }
      return;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.cooldown > 0 || Math.abs(intent) < ASK) return;
    // lane 0 is the leftmost, so left is down
    const step = intent > 0 ? -1 : 1;
    if (this.lane + step < 0 || this.lane + step >= this.lanes) return;
    this.signal = step;
    this.signalTime = 0;
  }

  /** Planned lateral offset `ahead` seconds from now. */
  offsetAt(road, ahead = 0) {
    const to = road.laneOffset(this.lane);
    if (!this.changing && ahead === 0) return to;
    const from = road.laneOffset(this.from);
    const p = Math.min(1, this.progress + ahead / CHANGE_TIME);
    return p >= 1 ? to : from + (to - from) * smootherstep(p);
  }

  /**
   * Pure pursuit toward the planned path a speed-dependent distance down
   * the road. Returns steer as a share of the grip limit, like Car wants it.
   */
  steer(car, road, s) {
    const v = Math.max(car.speed, 1);
    const lookahead = clamp(v * 0.55, 6, 20);
    const p = road.pose(s + lookahead, this.offsetAt(road, lookahead / v), this.target);
    const alpha = wrapAngle(Math.atan2(p.y - car.y, p.x - car.x) - car.heading);
    const curvature = (2 * Math.sin(alpha)) / lookahead;
    return clamp((car.speed * car.speed * curvature) / car.spec.maxLateralAccel, -1, 1);
  }
}
