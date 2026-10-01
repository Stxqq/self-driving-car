import { SIGNAL_LEAD } from "../sim/planner.js";
import { CAR_SPEC } from "../sim/car.js";
import { DT } from "../sim/world.js";

const KEYS = {
  ArrowUp: "gas",
  KeyW: "gas",
  ArrowDown: "brake",
  KeyS: "brake",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
};

// how fast the pedal moves, per second: a foot, not a switch
const PEDAL_RATE = 1.6;
const BRAKE_RATE = 1.2;
const KMH = 1 / 3.6;
const START_SET = 70 * KMH;
// holding up raises the set speed this much per second
const SET_RATE = 15 * KMH;
// cruise control: pedal per m/s of error, and how far it may push either way
const CRUISE_GAIN = 0.3;
const CRUISE_THROTTLE = 0.6;
const CRUISE_BRAKE = 0.25;
// a tap on left or right is held for the planner long enough to commit
const LANE_HOLD = SIGNAL_LEAD + 0.2;

/**
 * Stands in for a Brain: the world calls forward() every step and gets
 * pedal and lane back, only these come from the keyboard or the
 * on-screen buttons instead of a network. It drives like cruise control
 * with a stalk: up raises the set speed, down brakes and the set speed
 * follows the car down, a tap left or right asks for the next lane over
 * and the planner steers.
 */
export class Pilot {
  constructor() {
    this.held = { gas: false, brake: false, left: false, right: false };
    this.touches = { gas: 0, brake: 0, left: 0, right: 0 };
    this.output = [0, 0];
    this.lane = 0;
    this.laneHold = 0;
    this.setSpeed = START_SET;
  }

  static control(code) {
    return KEYS[code];
  }

  press(control, down) {
    if (down && !this.held[control]) this.ask(control);
    this.held[control] = down;
  }

  touch(control, down) {
    if (down) this.ask(control);
    this.touches[control] = Math.max(0, this.touches[control] + (down ? 1 : -1));
  }

  ask(control) {
    if (control !== "left" && control !== "right") return;
    this.lane = control === "left" ? 1 : -1;
    this.laneHold = LANE_HOLD;
  }

  release() {
    for (const k of Object.keys(this.held)) {
      this.held[k] = false;
      this.touches[k] = 0;
    }
  }

  reset() {
    this.output = [0, 0];
    this.laneHold = 0;
    this.setSpeed = START_SET;
  }

  active(control) {
    return this.held[control] || this.touches[control] > 0;
  }

  forward(inputs) {
    const v = inputs[15] * CAR_SPEC.maxSpeed;
    let target;
    let rate = PEDAL_RATE;
    if (this.active("brake")) {
      target = -1;
      rate = BRAKE_RATE;
      this.setSpeed = v;
    } else {
      if (this.active("gas")) this.setSpeed = Math.min(CAR_SPEC.maxSpeed, this.setSpeed + SET_RATE * DT);
      target = Math.min(CRUISE_THROTTLE, Math.max(-CRUISE_BRAKE, (this.setSpeed - v) * CRUISE_GAIN));
    }
    this.output[0] = approach(this.output[0], target, rate * DT);
    this.output[1] = this.laneHold > 0 ? this.lane : 0;
    this.laneHold = Math.max(0, this.laneHold - DT);
    return this.output;
  }
}

function approach(value, target, step) {
  if (value < target) return Math.min(target, value + step);
  return Math.max(target, value - step);
}
