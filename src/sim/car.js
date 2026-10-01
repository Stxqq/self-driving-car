import { clamp, orientedBox } from "./geometry.js";

/** A mid-size hatchback, in meters, seconds and radians. */
export const CAR_SPEC = Object.freeze({
  length: 4.4,
  width: 1.8,
  wheelbase: 2.7,
  rearToCenter: 1.35,
  maxSpeed: 32,
  maxAccel: 4.2,
  maxBrake: 9,
  maxSteer: 0.55,
  steerRate: 1.6,
  // cornering grip, m/s^2
  maxLateralAccel: 8,
  rollingResistance: 0.25,
  dragPerSpeed2: 0.0011,
});

/**
 * Kinematic bicycle model. Position is the center of the body, heading is
 * counterclockwise from +x. Controls are throttle and brake in [0, 1] and
 * steer in [-1, 1], positive to the left.
 *
 * Steer asks for a fraction of the available cornering grip rather than a
 * wheel angle. At 30 m/s the tires give out past about 1.5 degrees of
 * lock, so a raw angle would leave the network a sliver of its output
 * range to drive with on the highway; this way the same output means the
 * same sideways pull at any speed.
 */
export class Car {
  constructor(x, y, heading, speed = 0, spec = CAR_SPEC) {
    this.spec = spec;
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.speed = speed;
    this.steerAngle = 0;
    this.throttle = 0;
    this.brake = 0;
    this.steer = 0;
    this.polygon = new Float64Array(8);
    this.updatePolygon();
  }

  control(throttle, brake, steer) {
    this.throttle = clamp(throttle, 0, 1);
    this.brake = clamp(brake, 0, 1);
    this.steer = clamp(steer, -1, 1);
  }

  step(dt) {
    const p = this.spec;
    const v = this.speed;

    let accel = this.throttle * p.maxAccel - this.brake * p.maxBrake;
    if (v > 0) accel -= p.rollingResistance + p.dragPerSpeed2 * v * v;
    this.speed = clamp(v + accel * dt, 0, p.maxSpeed);

    const lateral = this.steer * p.maxLateralAccel;
    const target = clamp(Math.atan((lateral * p.wheelbase) / Math.max(v * v, 1e-6)), -p.maxSteer, p.maxSteer);
    const maxDelta = p.steerRate * dt;
    this.steerAngle += clamp(target - this.steerAngle, -maxDelta, maxDelta);

    const slip = Math.atan((p.rearToCenter / p.wheelbase) * Math.tan(this.steerAngle));
    const travel = (v + this.speed) * 0.5;
    this.heading += ((travel / p.rearToCenter) * Math.sin(slip)) * dt;
    this.x += travel * Math.cos(this.heading + slip) * dt;
    this.y += travel * Math.sin(this.heading + slip) * dt;
    this.updatePolygon();
  }

  /** Current cornering as a fraction of the grip limit, in [-1, 1]. */
  get turning() {
    const p = this.spec;
    const lateral = (Math.tan(this.steerAngle) * this.speed * this.speed) / p.wheelbase;
    return clamp(lateral / p.maxLateralAccel, -1, 1);
  }

  updatePolygon() {
    orientedBox(this.polygon, this.x, this.y, this.heading, this.spec.length, this.spec.width);
  }
}
