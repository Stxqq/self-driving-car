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

// how fast the outputs follow the keys, per second; a tap of the arrow
// key shouldn't throw the car across two lanes
const STEER_RATE = 2.6;
const PEDAL_RATE = 5;

/**
 * Stands in for a Brain: the world calls forward() every step and gets
 * pedal and steer back, only these come from the keyboard or the
 * on-screen buttons instead of a network.
 */
export class Pilot {
  constructor() {
    this.held = { gas: false, brake: false, left: false, right: false };
    this.touches = { gas: 0, brake: 0, left: 0, right: 0 };
    this.output = [0, 0];
  }

  static control(code) {
    return KEYS[code];
  }

  press(control, down) {
    this.held[control] = down;
  }

  touch(control, down) {
    this.touches[control] = Math.max(0, this.touches[control] + (down ? 1 : -1));
  }

  release() {
    for (const k of Object.keys(this.held)) {
      this.held[k] = false;
      this.touches[k] = 0;
    }
  }

  reset() {
    this.output = [0, 0];
  }

  active(control) {
    return this.held[control] || this.touches[control] > 0;
  }

  forward() {
    const pedalTarget = (this.active("gas") ? 1 : 0) - (this.active("brake") ? 1 : 0);
    const steerTarget = (this.active("left") ? 1 : 0) - (this.active("right") ? 1 : 0);
    const [pedal, steer] = this.output;
    this.output[0] = approach(pedal, pedalTarget, PEDAL_RATE * DT);
    this.output[1] = approach(steer, steerTarget, STEER_RATE * DT);
    return this.output;
  }
}

function approach(value, target, step) {
  if (value < target) return Math.min(target, value + step);
  return Math.max(target, value - step);
}
