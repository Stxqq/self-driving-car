// Canvas view of a World, drawn like the rest of the site: a pale road on
// the gray tile, ink borders, pastel traffic. Kept apart from src/sim so
// the simulation stays DOM-free and runs unchanged under Node.

import { CAR_SPEC } from "../sim/car.js";

const INK = "#111113";
const TILE = "#f5f5f6";
const CRASH = "#dc2626";
const TRAFFIC = [
  ["#FDE68A", "rgba(120,53,15,.22)"],
  ["#BAE6FD", "rgba(12,74,110,.2)"],
  ["#FBCFE8", "rgba(131,24,67,.18)"],
  ["#BBF7D0", "rgba(20,83,45,.2)"],
  ["#DDD6FE", "rgba(76,29,149,.18)"],
  ["#FED7AA", "rgba(124,45,18,.2)"],
];
const FOLLOW = 0.085;
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
    this.anchorY = 0.7;
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
    // roughly 88 m of road top to bottom whatever the tile size, so the
    // forward rays (70 m) always fit above the car
    this.ppm = Math.min(9, Math.max(4.5, height / 88));
  }

  /** Jump straight to the next target instead of easing there. */
  snap() {
    this.camera.ready = false;
  }

  follow(world, driver, dt) {
    const cam = this.camera;
    world.road.pose(driver.s, 0, this.pose);
    const x = driver.car.x;
    const y = driver.car.y;
    const angle = this.pose.heading - Math.PI / 2;
    if (!cam.ready || this.reducedMotion) {
      Object.assign(cam, { x, y, angle, ready: true });
      return;
    }
    // frame-rate independent form of cur += (target - cur) * 0.085 at 60 Hz
    const k = 1 - (1 - FOLLOW) ** (dt * 60);
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
    this.drawSweep(world);
    if (world.traffic) this.drawTraffic(world.traffic.within(s - reach, s + reach));
    if (ghosts) this.drawGhosts(world.drivers, focus);
    if (focus) this.drawFocus(focus);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawMarkers(world.road, s - reach, s + reach);
  }

  px(n) {
    return n / this.ppm;
  }

  // a dot grid fixed to the ground, so speed reads even on a straight
  drawDots(reach) {
    const { ctx, camera: cam } = this;
    const half = reach / 2 + DOT_SPACING;
    const r = this.px(0.6);
    const x0 = Math.floor((cam.x - half) / DOT_SPACING) * DOT_SPACING;
    const y0 = Math.floor((cam.y - half) / DOT_SPACING) * DOT_SPACING;
    ctx.beginPath();
    for (let x = x0; x < cam.x + half; x += DOT_SPACING) {
      for (let y = y0; y < cam.y + half; y += DOT_SPACING) ctx.rect(x - r, y - r, 2 * r, 2 * r);
    }
    ctx.fillStyle = "rgba(17,17,19,.11)";
    ctx.fill();
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

  drawTraffic(view) {
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
  }

  drawGhosts(drivers, focus) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(17,17,19,.1)";
    for (const driver of drivers) {
      if (!driver.alive || driver === focus) continue;
      this.body(driver.car.x, driver.car.y, driver.car.heading, 0);
    }
  }

  drawFocus(driver) {
    const { ctx, dpr } = this;
    const { car, sensors } = driver;
    const [ox, oy] = sensors.origin;

    ctx.lineWidth = this.px(1);
    for (let r = 0; r < sensors.count; r++) {
      const proximity = sensors.readings[r];
      ctx.strokeStyle = `rgba(17,17,19,${0.14 + proximity * 0.5})`;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(sensors.ends[2 * r], sensors.ends[2 * r + 1]);
      ctx.stroke();
    }
    ctx.fillStyle = INK;
    ctx.beginPath();
    const dot = this.px(2.2);
    for (let r = 0; r < sensors.count; r++) {
      if (sensors.readings[r] <= 0) continue;
      const x = sensors.ends[2 * r];
      const y = sensors.ends[2 * r + 1];
      ctx.moveTo(x + dot, y);
      ctx.arc(x, y, dot, 0, Math.PI * 2);
    }
    ctx.fill();

    // shadow offsets are in device pixels and ignore the transform
    ctx.shadowColor = "rgba(0,0,0,.28)";
    ctx.shadowBlur = 14 * dpr;
    ctx.shadowOffsetY = 7 * dpr;
    ctx.fillStyle = driver.alive ? INK : CRASH;
    this.body(car.x, car.y, car.heading, 0);
    ctx.shadowColor = "transparent";
    ctx.fillStyle = "rgba(255,255,255,.22)";
    this.glass(car.x, car.y, car.heading);
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
