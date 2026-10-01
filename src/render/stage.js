// Canvas view of a World, drawn like the rest of the site: a pale road on
// the gray tile, ink borders, pastel traffic. Kept apart from src/sim so
// the simulation stays DOM-free and runs unchanged under Node.

import { CAR_SPEC } from "../sim/car.js";
import { smoothstep } from "../sim/geometry.js";

const INK = "#111113";
const TILE = "#f5f5f6";
const CRASH = "#dc2626";
const PLAN = "37,99,235";
const SIGNAL = "#f59e0b";
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const TRAFFIC = [
  ["#FDE68A", "rgba(120,53,15,.22)"],
  ["#BAE6FD", "rgba(12,74,110,.2)"],
  ["#FBCFE8", "rgba(131,24,67,.18)"],
  ["#BBF7D0", "rgba(20,83,45,.2)"],
  ["#DDD6FE", "rgba(76,29,149,.18)"],
  ["#FED7AA", "rgba(124,45,18,.2)"],
];
const FOLLOW = 0.085;

/**
 * The share of the remaining distance to close this frame, so that
 * cur += (target - cur) * rate looks the same at 30, 60 or 144 Hz.
 */
export const easeFactor = (rate, dt) => 1 - (1 - rate) ** (dt * 60);
const DOT_SPACING = 3;
const MARKER_EVERY = 100;
const CAR_LENGTH = CAR_SPEC.length;
const CAR_WIDTH = CAR_SPEC.width;

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.camera = { x: 0, y: 0, angle: 0, ready: false };
    this.pose = { x: 0, y: 0, heading: 0 };
    this.point = { x: 0, y: 0 };
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.ppm = 7;
    this.anchorY = 0.62;
    this.labels = [];
    this.reducedMotion = false;
  }

  resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    // roughly 70 m of road top to bottom whatever the tile size: close
    // enough to read the lanes, far enough to see the planned path end
    this.ppm = Math.min(11, Math.max(5, height / 70));
  }

  /** Jump straight to the next target instead of easing there. */
  snap() {
    this.camera.ready = false;
  }

  // The camera looks a little down the road, more the faster the car goes,
  // and sideways toward where the car is heading rather than where it is,
  // so a lane change pans the view early instead of dragging it along.
  follow(world, driver, dt) {
    const cam = this.camera;
    const { car, planner } = driver;
    const lookahead = Math.min(car.speed * 0.4, 10);
    const d = driver.d * 0.5 + planner.offsetAt(world.road) * 0.5;
    world.road.pose(driver.s + lookahead, d, this.pose);
    const { x, y } = this.pose;
    const angle = this.pose.heading - Math.PI / 2;
    if (!cam.ready || this.reducedMotion) {
      Object.assign(cam, { x, y, angle, ready: true });
      return;
    }
    const k = easeFactor(FOLLOW, dt);
    cam.x += (x - cam.x) * k;
    cam.y += (y - cam.y) * k;
    const turn = Math.atan2(Math.sin(angle - cam.angle), Math.cos(angle - cam.angle));
    cam.angle += turn * k * 0.7;
  }

  toScreen(x, y, out) {
    const { camera: cam, ppm } = this;
    const dx = x - cam.x;
    const dy = y - cam.y;
    const c = Math.cos(cam.angle);
    const s = Math.sin(cam.angle);
    out.x = this.width / 2 + (dx * c + dy * s) * ppm;
    out.y = this.height * this.anchorY - (dy * c - dx * s) * ppm;
    return out;
  }

  draw(world, focus, dt, { ghosts = true } = {}) {
    const { ctx, camera: cam, dpr } = this;
    if (focus) this.follow(world, focus, dt);
    const scale = this.ppm * dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = TILE;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.translate((this.width / 2) * dpr, this.height * this.anchorY * dpr);
    ctx.scale(scale, -scale);
    ctx.rotate(-cam.angle);
    ctx.translate(-cam.x, -cam.y);

    const s = focus ? focus.s : 0;
    const reach = Math.hypot(this.width, this.height) / this.ppm;
    this.drawDots(reach);
    this.drawRoad(world.road, s - reach, s + reach);
    // the road starts at s = 0, heading north from the origin; let it come
    // out of the tile instead of stopping dead behind the first car
    const atStart = s - reach < 0;
    if (atStart) this.fadeToTile(reach, world.road.halfWidth + 2, 22, 0, 0);
    this.labels.length = 0;
    if (focus && focus.alive) {
      this.drawTargetLane(world.road, focus);
      this.drawPath(world.road, focus);
    }
    this.drawSweep(world);
    if (world.traffic) this.drawTraffic(world.traffic.within(s - reach, s + reach), world.time);
    if (focus && focus.alive) this.drawTracks(focus);
    if (ghosts) this.drawGhosts(world.drivers, focus);
    if (focus) this.drawFocus(focus, world.time);
    // and the rear rays that run on past it
    if (atStart) this.fadeToTile(reach, reach, 0, -10, -reach);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawMarkers(world.road, s - reach, s + reach);
    this.drawLabels();
  }

  pathLength(car) {
    return Math.min(90, Math.max(24, car.speed * 3.2));
  }

  // the lane the planner is moving into, washed in from the car forward
  drawTargetLane(road, driver) {
    const { planner, car } = driver;
    const lane = planner.changing ? planner.lane : planner.signal ? planner.lane + planner.signal : -1;
    if (lane < 0) return;
    const ctx = this.ctx;
    const s0 = driver.s - 4;
    const s1 = driver.s + this.pathLength(car) + 10;
    const half = road.laneWidth / 2;
    const center = road.laneOffset(lane);
    const near = road.pose(s0, center, {});
    const far = road.pose(s1, center, {});
    const wash = ctx.createLinearGradient(near.x, near.y, far.x, far.y);
    wash.addColorStop(0, `rgba(${PLAN},0)`);
    wash.addColorStop(0.15, `rgba(${PLAN},.09)`);
    wash.addColorStop(1, `rgba(${PLAN},0)`);
    ctx.beginPath();
    for (let u = s0; u <= s1; u += 2) {
      const p = road.pose(u, center + half, this.pose);
      ctx.lineTo(p.x, p.y);
    }
    for (let u = s1; u >= s0; u -= 2) {
      const p = road.pose(u, center - half, this.pose);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = wash;
    ctx.fill();
  }

  // The planned path: from where the car is now onto the planner's line,
  // which bends into the next lane during a change. It fades with distance.
  drawPath(road, driver) {
    const { car, planner } = driver;
    const ctx = this.ctx;
    const length = this.pathLength(car);
    const v = Math.max(car.speed, 4);
    const half = CAR_WIDTH * 0.42;
    const left = [];
    const right = [];
    const middle = [];
    for (let u = 0; u <= length; u += 1.5) {
      const settle = smoothstep(Math.min(1, u / 14));
      const d = driver.d + (planner.offsetAt(road, u / v) - driver.d) * settle;
      const p = road.pose(driver.s + u, d + half, this.pose);
      left.push(p.x, p.y);
      const q = road.pose(driver.s + u, d - half, this.pose);
      right.push(q.x, q.y);
      middle.push((p.x + q.x) / 2, (p.y + q.y) / 2);
    }
    const n = middle.length;
    const fade = ctx.createLinearGradient(middle[0], middle[1], middle[n - 2], middle[n - 1]);
    fade.addColorStop(0, `rgba(${PLAN},.22)`);
    fade.addColorStop(0.6, `rgba(${PLAN},.12)`);
    fade.addColorStop(1, `rgba(${PLAN},0)`);
    ctx.beginPath();
    for (let i = 0; i < n; i += 2) ctx.lineTo(left[i], left[i + 1]);
    for (let i = n - 2; i >= 0; i -= 2) ctx.lineTo(right[i], right[i + 1]);
    ctx.closePath();
    ctx.fillStyle = fade;
    ctx.fill();

    const line = ctx.createLinearGradient(middle[0], middle[1], middle[n - 2], middle[n - 1]);
    line.addColorStop(0, `rgba(${PLAN},.85)`);
    line.addColorStop(1, `rgba(${PLAN},0)`);
    ctx.beginPath();
    for (let i = 0; i < n; i += 2) ctx.lineTo(middle[i], middle[i + 1]);
    ctx.lineWidth = this.px(1.5);
    ctx.strokeStyle = line;
    ctx.stroke();
  }

  // Corner brackets around every car the lane scan is tracking, the one
  // the car is following in blue, with the gap to it in meters.
  drawTracks(driver) {
    const ctx = this.ctx;
    const own = driver.scan.lanes[1].ahead.car;
    ctx.lineWidth = this.px(1.25);
    for (const view of driver.scan.lanes) {
      for (const track of [view.ahead, view.behind]) {
        const car = track.car;
        if (!car) continue;
        const lead = car === own;
        ctx.strokeStyle = lead ? `rgb(${PLAN})` : "rgba(17,17,19,.38)";
        this.brackets(car.x, car.y, car.heading);
        if (lead || track.gap < 25) {
          this.labels.push(car.x, car.y, Math.max(0, Math.round(track.gap)), lead);
        }
      }
    }
  }

  brackets(x, y, heading) {
    const ctx = this.ctx;
    const hl = CAR_LENGTH / 2 + 0.6;
    const hw = CAR_WIDTH / 2 + 0.5;
    const arm = 0.9;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
    ctx.beginPath();
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      ctx.moveTo(sx * hl - sx * arm, sy * hw);
      ctx.lineTo(sx * hl, sy * hw);
      ctx.lineTo(sx * hl, sy * hw - sy * arm);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawLabels() {
    const { ctx, point, labels } = this;
    if (!labels.length) return;
    ctx.font = `500 9px ${MONO}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const offset = (CAR_WIDTH / 2 + 1.2) * this.ppm;
    for (let i = 0; i < labels.length; i += 4) {
      this.toScreen(labels[i], labels[i + 1], point);
      ctx.fillStyle = labels[i + 3] ? `rgb(${PLAN})` : "rgba(17,17,19,.5)";
      ctx.fillText(`${labels[i + 2]} m`, point.x + offset, point.y);
    }
  }

  px(n) {
    return n / this.ppm;
  }

  // a dot grid fixed to the ground, so speed reads even on a straight
  drawDots(reach, fill = "rgba(17,17,19,.11)") {
    const { ctx, camera: cam } = this;
    const half = reach / 2 + DOT_SPACING;
    const r = this.px(0.6);
    const x0 = Math.floor((cam.x - half) / DOT_SPACING) * DOT_SPACING;
    const y0 = Math.floor((cam.y - half) / DOT_SPACING) * DOT_SPACING;
    ctx.beginPath();
    for (let x = x0; x < cam.x + half; x += DOT_SPACING) {
      for (let y = y0; y < cam.y + half; y += DOT_SPACING) ctx.rect(x - r, y - r, 2 * r, 2 * r);
    }
    ctx.fillStyle = fill;
    ctx.fill();
  }

  // Washes a band `w` either side of x = 0 into the tile between `clear` and
  // `solid` (world y), and on to `far`; the ground dots come back in as it
  // fades.
  fadeToTile(reach, w, clear, solid, far) {
    const ctx = this.ctx;
    const band = (from, to) => {
      const g = ctx.createLinearGradient(0, clear, 0, solid);
      g.addColorStop(0, from);
      g.addColorStop(1, to);
      return g;
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(-w, Math.min(clear, far), 2 * w, Math.abs(far - clear));
    ctx.clip();
    ctx.fillStyle = band("rgba(245,245,246,0)", TILE);
    ctx.fill();
    this.drawDots(reach, band("rgba(17,17,19,0)", "rgba(17,17,19,.11)"));
    ctx.restore();
  }

  drawRoad(road, s0, s1) {
    const ctx = this.ctx;
    const [from, to] = road.span(Math.max(0, s0), s1);
    if (to - from < 2) return;

    ctx.beginPath();
    for (let i = from; i < to; i++) ctx.lineTo(road.left[2 * i], road.left[2 * i + 1]);
    for (let i = to - 1; i >= from; i--) ctx.lineTo(road.right[2 * i], road.right[2 * i + 1]);
    ctx.closePath();
    ctx.fillStyle = "#fff";
    ctx.fill();

    ctx.lineWidth = this.px(1);
    ctx.strokeStyle = "rgba(17,17,19,.13)";
    this.strokeOffset(road, from, to, road.halfWidth + 1.2);
    this.strokeOffset(road, from, to, -road.halfWidth - 1.2);

    ctx.lineWidth = this.px(1.5);
    ctx.strokeStyle = INK;
    this.strokeOffset(road, from, to, road.halfWidth);
    this.strokeOffset(road, from, to, -road.halfWidth);

    // dashes anchored to the ground rather than to the first sample drawn
    ctx.lineWidth = this.px(1);
    ctx.strokeStyle = "rgba(17,17,19,.28)";
    ctx.setLineDash([3, 9]);
    ctx.lineDashOffset = (from * road.spacing) % 12;
    for (let lane = 1; lane < road.lanes; lane++) {
      this.strokeOffset(road, from, to, road.halfWidth - lane * road.laneWidth);
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    ctx.strokeStyle = "rgba(17,17,19,.35)";
    ctx.beginPath();
    for (const s of this.markers(road, from, to)) {
      const a = road.pose(s, -road.halfWidth, this.pose);
      ctx.moveTo(a.x, a.y);
      const b = road.pose(s, -road.halfWidth - 1.8, this.pose);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  *markers(road, from, to) {
    const first = Math.max(1, Math.ceil((from * road.spacing) / MARKER_EVERY));
    for (let k = first; k * MARKER_EVERY < (to - 1) * road.spacing; k++) yield k * MARKER_EVERY;
  }

  strokeOffset(road, from, to, d) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = from; i < to; i++) {
      const h = road.headings[i];
      ctx.lineTo(road.xs[i] - Math.sin(h) * d, road.ys[i] + Math.cos(h) * d);
    }
    ctx.stroke();
  }

  drawMarkers(road, s0, s1) {
    const { ctx, point } = this;
    const [from, to] = road.span(Math.max(0, s0), s1);
    ctx.font = "500 9px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "rgba(17,17,19,.45)";
    ctx.textBaseline = "middle";
    for (const s of this.markers(road, from, to)) {
      const p = road.pose(s, -road.halfWidth - 3, this.pose);
      this.toScreen(p.x, p.y, point);
      ctx.fillText(`${(s / 1000).toFixed(1)} km`, point.x, point.y);
    }
  }

  // the line everyone has to stay ahead of; see RULES in world.js
  drawSweep(world) {
    const { ctx, pose } = this;
    const road = world.road;
    const s = world.sweepLine();
    ctx.beginPath();
    road.pose(s, road.halfWidth, pose);
    ctx.moveTo(pose.x, pose.y);
    road.pose(s, -road.halfWidth, pose);
    ctx.lineTo(pose.x, pose.y);
    ctx.lineWidth = this.px(1.25);
    ctx.strokeStyle = "rgba(220,38,38,.55)";
    ctx.setLineDash([this.px(4), this.px(3)]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawTraffic(view, time) {
    const ctx = this.ctx;
    const down = this.shadowOffset(0.45);
    ctx.fillStyle = "rgba(17,17,19,.06)";
    for (let k = view.start; k < view.end; k++) {
      const car = view.cars[k];
      this.body(car.x + down.x, car.y + down.y, car.heading, 0.55);
    }
    for (let k = view.start; k < view.end; k++) {
      const car = view.cars[k];
      const [fill, glass] = TRAFFIC[car.id % TRAFFIC.length];
      ctx.fillStyle = fill;
      this.body(car.x, car.y, car.heading, 0);
      ctx.fillStyle = glass;
      this.glass(car.x, car.y, car.heading);
    }
    // traffic never looks for the learning cars, but it does indicate
    if ((time + 0.05) % 0.7 >= 0.4) return;
    ctx.fillStyle = SIGNAL;
    for (let k = view.start; k < view.end; k++) {
      const car = view.cars[k];
      if (!car.changingLanes) continue;
      const side = car.targetLane < car.lane ? 1 : -1;
      this.lamps(car, 1, side);
      this.lamps(car, -1, side);
    }
  }

  drawGhosts(drivers, focus) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(17,17,19,.1)";
    for (const driver of drivers) {
      if (!driver.alive || driver === focus) continue;
      this.body(driver.car.x, driver.car.y, driver.car.heading, 0);
    }
  }

  drawFocus(driver, time) {
    const { ctx, dpr } = this;
    const { car, planner } = driver;

    // shadow offsets are in device pixels and ignore the transform
    ctx.shadowColor = "rgba(0,0,0,.28)";
    ctx.shadowBlur = 14 * dpr;
    ctx.shadowOffsetY = 7 * dpr;
    ctx.fillStyle = driver.alive ? INK : CRASH;
    this.body(car.x, car.y, car.heading, 0);
    ctx.shadowColor = "transparent";
    ctx.fillStyle = "rgba(255,255,255,.22)";
    this.glass(car.x, car.y, car.heading);

    if (!driver.alive) return;
    if (car.brake > 0.05) {
      ctx.fillStyle = CRASH;
      this.lamps(car, -1, 1);
      this.lamps(car, -1, -1);
    }
    // on for 0.4 s, off for 0.3, like a real relay; sim time, so it blinks
    // faster when the sim does
    if (planner.signal !== 0 && (time + 0.05) % 0.7 < 0.4) {
      const side = -planner.signal;
      ctx.shadowColor = SIGNAL;
      ctx.shadowBlur = 10 * dpr;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = SIGNAL;
      this.lamps(car, 1, side);
      this.lamps(car, -1, side);
      ctx.shadowColor = "transparent";
    }
  }

  // a lamp at one corner: `end` 1 front, -1 rear; `side` 1 left, -1 right
  lamps(car, end, side) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.heading);
    ctx.beginPath();
    const x = end > 0 ? CAR_LENGTH / 2 - 0.42 : -CAR_LENGTH / 2;
    const y = side > 0 ? CAR_WIDTH / 2 - 0.55 : -CAR_WIDTH / 2;
    ctx.roundRect(x, y, 0.42, 0.55, 0.12);
    ctx.fill();
    ctx.restore();
  }

  shadowOffset(meters) {
    const a = this.camera.angle;
    return { x: Math.sin(a) * meters, y: -Math.cos(a) * meters };
  }

  body(x, y, heading, grow) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
    ctx.beginPath();
    ctx.roundRect(-CAR_LENGTH / 2 - grow, -CAR_WIDTH / 2 - grow, CAR_LENGTH + 2 * grow, CAR_WIDTH + 2 * grow, 0.45 + grow);
    ctx.fill();
    ctx.restore();
  }

  // windshield and rear window; the nose is +x in the car's frame
  glass(x, y, heading) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading);
    ctx.beginPath();
    ctx.roundRect(CAR_LENGTH * 0.06, -CAR_WIDTH * 0.38, CAR_LENGTH * 0.17, CAR_WIDTH * 0.76, 0.18);
    ctx.roundRect(-CAR_LENGTH * 0.38, -CAR_WIDTH * 0.34, CAR_LENGTH * 0.1, CAR_WIDTH * 0.68, 0.14);
    ctx.fill();
    ctx.restore();
  }
}
