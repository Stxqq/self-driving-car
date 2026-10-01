// Canvas view of a World. Kept separate from src/sim so the simulation
// stays DOM-free and runs unchanged under Node.

const TRAFFIC_COLORS = ["#FDE68A", "#BAE6FD", "#FBCFE8", "#BBF7D0", "#DDD6FE", "#FED7AA"];

export class Renderer {
  constructor(canvas, { pixelsPerMeter = 8 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.pixelsPerMeter = pixelsPerMeter;
    this.camera = { x: 0, y: 0, angle: 0, ready: false };
    this.pose = { x: 0, y: 0, heading: 0 };
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height } = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.dpr = dpr;
  }

  follow(world, driver) {
    const road = world.road;
    road.pose(driver.s, driver.d, this.pose);
    const target = { x: driver.car.x, y: driver.car.y, angle: this.pose.heading - Math.PI / 2 };
    const cam = this.camera;
    if (!cam.ready) {
      Object.assign(cam, target, { ready: true });
      return;
    }
    cam.x += (target.x - cam.x) * 0.2;
    cam.y += (target.y - cam.y) * 0.2;
    cam.angle += (target.angle - cam.angle) * 0.06;
  }

  draw(world, focus) {
    const { ctx, canvas, camera: cam } = this;
    if (focus) this.follow(world, focus);
    const scale = this.pixelsPerMeter * this.dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#101013";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // world y points up; keep the focused car a little below center
    ctx.translate(canvas.width / 2, canvas.height * 0.68);
    ctx.scale(scale, -scale);
    ctx.rotate(-cam.angle);
    ctx.translate(-cam.x, -cam.y);

    const s = focus ? focus.s : 0;
    const viewMeters = canvas.height / scale;
    this.drawRoad(world.road, s - viewMeters * 0.4, s + viewMeters * 0.9);
    if (world.traffic) this.drawTraffic(world.traffic.within(s - viewMeters * 0.5, s + viewMeters));
    this.drawDrivers(world.drivers, focus);
  }

  drawRoad(road, s0, s1) {
    const ctx = this.ctx;
    const [from, to] = road.span(Math.max(0, s0), s1);
    if (to - from < 2) return;

    ctx.beginPath();
    for (let i = from; i < to; i++) ctx.lineTo(road.left[2 * i], road.left[2 * i + 1]);
    for (let i = to - 1; i >= from; i--) ctx.lineTo(road.right[2 * i], road.right[2 * i + 1]);
    ctx.closePath();
    ctx.fillStyle = "#1b1b1f";
    ctx.fill();

    ctx.lineWidth = 0.18;
    ctx.strokeStyle = "rgba(255,255,255,.85)";
    for (const border of [road.left, road.right]) {
      ctx.beginPath();
      for (let i = from; i < to; i++) ctx.lineTo(border[2 * i], border[2 * i + 1]);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.lineWidth = 0.14;
    ctx.setLineDash([3, 6]);
    for (let lane = 1; lane < road.lanes; lane++) {
      const d = road.halfWidth - lane * road.laneWidth;
      ctx.beginPath();
      for (let i = from; i < to; i++) {
        road.pose(i * road.spacing, d, this.pose);
        ctx.lineTo(this.pose.x, this.pose.y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  drawTraffic(view) {
    const ctx = this.ctx;
    for (let k = view.start; k < view.end; k++) {
      const car = view.cars[k];
      ctx.fillStyle = TRAFFIC_COLORS[car.id % TRAFFIC_COLORS.length];
      this.fillPolygon(car.polygon);
    }
  }

  drawDrivers(drivers, focus) {
    const ctx = this.ctx;
    for (const driver of drivers) {
      if (!driver.alive || driver === focus) continue;
      ctx.fillStyle = "rgba(255,255,255,.16)";
      this.fillPolygon(driver.car.polygon);
    }
    if (!focus) return;

    const { car, sensors } = focus;
    const [ox, oy] = sensors.origin;
    ctx.lineWidth = 0.08;
    for (let r = 0; r < sensors.count; r++) {
      const ex = sensors.ends[2 * r];
      const ey = sensors.ends[2 * r + 1];
      const hot = sensors.readings[r];
      ctx.strokeStyle = `rgba(255,255,255,${0.12 + hot * 0.5})`;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      if (hot > 0) {
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(ex, ey, 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = focus.alive ? "#ffffff" : "#dc2626";
    this.fillPolygon(car.polygon);
  }

  fillPolygon(poly) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(poly[0], poly[1]);
    for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
    ctx.closePath();
    ctx.fill();
  }
}
