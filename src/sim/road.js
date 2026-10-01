import { Rng, deriveSeed } from "./rng.js";
import { clamp } from "./geometry.js";

const NORTH = Math.PI / 2;

const DEFAULTS = {
  lanes: 3,
  laneWidth: 3.6,
  spacing: 2,
  straightStart: 160,
  minRadius: 110,
  maxRadius: 520,
  // soft cap on how far the road turns away from north; it overshoots a
  // little during ramps but stays monotone in y, so it never folds back
  maxDeviation: 1.0,
};

/**
 * A procedurally generated highway, sampled every `spacing` meters along
 * its centerline. Curvature ramps linearly between sections (clothoids),
 * so heading is smooth and there are no kinks for the sensors to trip on.
 * The road is generated lazily: call extendTo(s) before looking past `length`.
 */
export class Road {
  constructor(seed, options = {}) {
    Object.assign(this, DEFAULTS, options);
    this.halfWidth = (this.lanes * this.laneWidth) / 2;
    this.rng = new Rng(deriveSeed(seed, "road"));

    this.xs = [0];
    this.ys = [0];
    this.headings = [NORTH];
    this.left = [-this.halfWidth, 0];
    this.right = [this.halfWidth, 0];

    this.kappa = 0;
    this.kappaStep = 0;
    this.rampLeft = 0;
    this.holdLeft = this.straightStart;
  }

  get length() {
    return (this.xs.length - 1) * this.spacing;
  }

  get count() {
    return this.xs.length;
  }

  /** Lateral offset of a lane center; lane 0 is the leftmost lane. */
  laneOffset(lane) {
    return this.halfWidth - this.laneWidth * (lane + 0.5);
  }

  laneAt(d) {
    return clamp(Math.floor((this.halfWidth - d) / this.laneWidth), 0, this.lanes - 1);
  }

  extendTo(s) {
    while (this.length < s) this.grow();
  }

  grow() {
    if (this.rampLeft <= 0 && this.holdLeft <= 0) this.planSection();

    const ds = this.spacing;
    const last = this.xs.length - 1;
    const h0 = this.headings[last];
    if (this.rampLeft > 0) {
      this.kappa += this.kappaStep;
      this.rampLeft -= ds;
    } else {
      this.holdLeft -= ds;
    }
    const h1 = h0 + this.kappa * ds;
    const mid = (h0 + h1) / 2;
    const x = this.xs[last] + Math.cos(mid) * ds;
    const y = this.ys[last] + Math.sin(mid) * ds;

    this.xs.push(x);
    this.ys.push(y);
    this.headings.push(h1);
    const nx = -Math.sin(h1) * this.halfWidth;
    const ny = Math.cos(h1) * this.halfWidth;
    this.left.push(x + nx, y + ny);
    this.right.push(x - nx, y - ny);
  }

  planSection() {
    const rng = this.rng;
    const deviation = this.headings[this.headings.length - 1] - NORTH;

    let target = 0;
    if (!rng.chance(0.22)) {
      // lean toward turning back so the road wanders instead of drifting off
      const back = deviation > 0 ? -1 : 1;
      const pull = 0.5 + 0.5 * clamp(Math.abs(deviation) / (0.45 * this.maxDeviation), 0, 1);
      const sign = rng.chance(pull) ? back : -back;
      target = sign / rng.range(this.minRadius, this.maxRadius);
    }

    const ramp = rng.range(30, 80);
    let hold = rng.range(40, 220);
    // heading after this ramp, the hold, and roughly the next ramp easing
    // out of it; the hold is cut short so that stays within bounds
    if (target !== 0) {
      const base = deviation + ((this.kappa + target) / 2) * ramp + 40 * target;
      const limit = (Math.sign(target) * this.maxDeviation - base) / target;
      hold = clamp(limit, 0, hold);
    }

    const steps = Math.max(1, Math.round(ramp / this.spacing));
    this.kappaStep = (target - this.kappa) / steps;
    this.rampLeft = steps * this.spacing;
    this.holdLeft = hold;
  }

  /** Sample index range covering arc lengths [s0, s1], clamped to what exists. */
  span(s0, s1) {
    const from = clamp(Math.floor(s0 / this.spacing), 0, this.count - 1);
    const to = clamp(Math.ceil(s1 / this.spacing) + 1, 0, this.count);
    return [from, to];
  }

  /** World pose at arc length s and lateral offset d (left positive). */
  pose(s, d, out) {
    const f = clamp(s / this.spacing, 0, this.count - 1.000001);
    const i = Math.floor(f);
    const t = f - i;
    const h = this.headings[i] + (this.headings[i + 1] - this.headings[i]) * t;
    const x = this.xs[i] + (this.xs[i + 1] - this.xs[i]) * t;
    const y = this.ys[i] + (this.ys[i + 1] - this.ys[i]) * t;
    out.x = x - Math.sin(h) * d;
    out.y = y + Math.cos(h) * d;
    out.heading = h;
    return out;
  }

  /**
   * Arc length and lateral offset of a point, searching outward from a
   * sample index hint. Cars move less than a sample per step, so the
   * search almost always settles in one pass.
   */
  project(x, y, hint, out) {
    const last = this.count - 2;
    let lo = clamp(hint - 4, 0, last);
    let hi = clamp(hint + 4, 0, last);
    for (;;) {
      let bestDist = Infinity;
      let bestIndex = lo;
      let bestT = 0;
      let bestD = 0;
      for (let i = lo; i <= hi; i++) {
        const ax = this.xs[i];
        const ay = this.ys[i];
        const dx = this.xs[i + 1] - ax;
        const dy = this.ys[i + 1] - ay;
        const len2 = dx * dx + dy * dy;
        const t = clamp(((x - ax) * dx + (y - ay) * dy) / len2, 0, 1);
        const px = x - (ax + dx * t);
        const py = y - (ay + dy * t);
        const dist = px * px + py * py;
        if (dist < bestDist) {
          bestDist = dist;
          bestIndex = i;
          bestT = t;
          bestD = (dx * (y - ay) - dy * (x - ax)) / Math.sqrt(len2);
        }
      }
      if (bestIndex === lo && bestT === 0 && lo > 0) {
        hi = lo;
        lo = Math.max(0, lo - 8);
      } else if (bestIndex === hi && bestT === 1 && hi < last) {
        lo = hi;
        hi = Math.min(last, hi + 8);
      } else {
        out.index = bestIndex;
        out.s = (bestIndex + bestT) * this.spacing;
        out.d = bestD;
        return out;
      }
    }
  }
}
