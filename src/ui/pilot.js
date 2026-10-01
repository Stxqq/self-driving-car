import { SIGNAL_LEAD } from "../sim/planner.js";
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

// how fast the pedal follows the keys, per second
const PEDAL_RATE = 5;
// a tap on left or right is held for the planner long enough to commit
const LANE_HOLD = SIGNAL_LEAD + 0.2;

/**
 * Stands in for a Brain: the world calls forward() every step and gets
 * pedal and lane back, only these come from the keyboard or the
 * on-screen buttons instead of a network. Like a driver-assist stalk, a
 * tap left or right asks for the next lane over; the planner steers.
 */
export class Pilot {
  constructor() {
    this.held = { gas: false, brake: false, left: false, right: false };
    this.touches = { gas: 0, brake: 0, left: 0, right: 0 };
    this.output = [0, 0];
    this.lane = 0;
    this.laneHold = 0;
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
  }

  active(control) {
    return this.held[control] || this.touches[control] > 0;
  }

  forward() {
    const pedalTarget = (this.active("gas") ? 1 : 0) - (this.active("brake") ? 1 : 0);
    this.output[0] = approach(this.output[0], pedalTarget, PEDAL_RATE * DT);
    this.output[1] = this.laneHold > 0 ? this.lane : 0;
    this.laneHold = Math.max(0, this.laneHold - DT);
    return this.output;
  }
}

function approach(value, target, step) {
  if (value < target) return Math.min(target, value + step);
  return Math.max(target, value - step);
}
