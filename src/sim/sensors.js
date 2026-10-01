import { rayPolygonHit, rayPolylineHit } from "./geometry.js";

/**
 * Ray angles relative to the car's heading. Squaring packs them toward the
 * front: a car 40 m ahead in the next lane over is only a few degrees off
 * the nose, and evenly spaced rays look straight past it.
 */
export function fanAngles(count, spread) {
  if (count === 1) return [0];
  const angles = [];
  for (let i = 0; i < count; i++) {
    const u = (i / (count - 1)) * 2 - 1;
    angles.push((spread / 2) * Math.sign(u) * u * u);
  }
  return angles;
}

/**
 * Range finders on the roof: a fan looking ahead plus a few mirror rays
 * looking back, without which a car can't tell whether the next lane is
 * clear before it moves over. Readings are proximities in [0, 1]:
 * 0 means nothing within range, 1 means touching.
 */
export class RayFan {
  constructor({ count = 11, spread = Math.PI * 0.9, range = 70, mirrors = [], mirrorRange = 40 } = {}) {
    this.angles = [...fanAngles(count, spread), ...mirrors];
    this.ranges = this.angles.map((_, i) => (i < count ? range : mirrorRange));
    this.maxRange = Math.max(...this.ranges);
    this.readings = new Float64Array(this.angles.length);
    // ray origin and endpoints in world space, kept for drawing
    this.origin = new Float64Array(2);
    this.ends = new Float64Array(this.angles.length * 2);
    this.visible = [];
  }

  get count() {
    return this.angles.length;
  }

  /**
   * Casts every ray from `car` against the road borders near arc length
   * `s` and against traffic cars whose arc length is within range.
   */
  sense(car, road, s, traffic) {
    const range = this.maxRange;
    const ox = car.x;
    const oy = car.y;
    this.origin[0] = ox;
    this.origin[1] = oy;
    // chords are shorter than arcs on a curve, so look a bit past the range
    const reach = range * 1.15 + road.halfWidth;
    const [from, to] = road.span(s - reach, s + reach);
    const visible = this.visible;
    visible.length = 0;
    if (traffic) {
      const near = traffic.within(s - reach, s + reach);
      const cutoff = (range + car.spec.length) ** 2;
      for (let k = near.start; k < near.end; k++) {
        const other = near.cars[k];
        if ((other.x - ox) ** 2 + (other.y - oy) ** 2 < cutoff) visible.push(other.polygon);
      }
    }

    for (let r = 0; r < this.angles.length; r++) {
      const a = car.heading + this.angles[r];
      const ex = ox + Math.cos(a) * this.ranges[r];
      const ey = oy + Math.sin(a) * this.ranges[r];
      let hit = rayPolylineHit(ox, oy, ex, ey, road.left, from, to);
      const right = rayPolylineHit(ox, oy, ex, ey, road.right, from, to);
      if (right >= 0 && (hit < 0 || right < hit)) hit = right;
      for (const polygon of visible) {
        const t = rayPolygonHit(ox, oy, ex, ey, polygon);
        if (t >= 0 && (hit < 0 || t < hit)) hit = t;
      }
      const fraction = hit < 0 ? 1 : hit;
      this.readings[r] = 1 - fraction;
      this.ends[2 * r] = ox + (ex - ox) * fraction;
      this.ends[2 * r + 1] = oy + (ey - oy) * fraction;
    }
    return this.readings;
  }
}
