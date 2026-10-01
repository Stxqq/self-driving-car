// The car in focus, redrawn nose-up at a fixed size for the spec sheet:
// its ray fan, front wheels turned by the steer output, brake lights.

const NS = "http://www.w3.org/2000/svg";
// rays are drawn on a square-root scale: linear, a ray stopping at the
// road edge five meters out would hide under the body while the long
// ones ran off the tile
const RAY_SCALE = 23;
const WHEEL_TURN = 0.25;

export class Anatomy {
  constructor(root) {
    this.root = root;
    this.layer = root.querySelector("[data-rays]");
    this.wheels = [...root.querySelectorAll("[data-wheel]")];
    this.brakes = root.querySelector("[data-brakes]");
    this.rays = [];
  }

  build(count) {
    this.layer.replaceChildren();
    this.rays = Array.from({ length: count }, () => {
      const line = document.createElementNS(NS, "line");
      const dot = document.createElementNS(NS, "circle");
      line.setAttribute("x1", "0");
      line.setAttribute("y1", "0");
      dot.setAttribute("r", "2.4");
      this.layer.append(line, dot);
      return { line, dot };
    });
  }

  update(driver, outputs) {
    const { sensors } = driver;
    if (this.rays.length !== sensors.count) this.build(sensors.count);
    for (let r = 0; r < sensors.count; r++) {
      const proximity = sensors.readings[r];
      const length = Math.sqrt(sensors.ranges[r] * (1 - proximity)) * RAY_SCALE;
      // nose up, positive angles to the car's left
      const a = sensors.angles[r];
      const x = (-Math.sin(a) * length).toFixed(1);
      const y = (-Math.cos(a) * length).toFixed(1);
      const { line, dot } = this.rays[r];
      line.setAttribute("x2", x);
      line.setAttribute("y2", y);
      line.style.opacity = (0.22 + proximity * 0.6).toFixed(2);
      dot.setAttribute("cx", x);
      dot.setAttribute("cy", y);
      dot.style.opacity = proximity > 0 ? "1" : "0";
    }
    const [pedal, steer] = outputs;
    const turn = (-steer * WHEEL_TURN * 180) / Math.PI;
    for (const wheel of this.wheels) wheel.style.transform = `rotate(${turn.toFixed(1)}deg)`;
    this.brakes.style.opacity = pedal < -0.05 || !driver.alive ? "1" : "0";
  }
}
