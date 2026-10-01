// The network as a keyline drawing: every weight a hairline, blue when
// positive and rose when negative, brighter where signal flows through it.

import { SENSOR_CONFIG } from "../sim/world.js";

const BLUE = "37,99,235";
const ROSE = "219,39,119";
const INK = "17,17,19";
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
// weights are sorted into this many opacity steps per sign so a frame is
// a couple of dozen strokes instead of one per weight
const STEPS = 8;
const RADIUS = [2.2, 2.8, 3, 4];

const RAYS = SENSOR_CONFIG.count + SENSOR_CONFIG.mirrors.length;
// the first row of each group in the key under the canvas; heading (29)
// sits too close to its neighbors for a label of its own
const INPUT_MARKS = [0, SENSOR_CONFIG.count, RAYS, 2 * RAYS, 2 * RAYS + 2];

export class NetworkView {
  constructor(canvas, { outputs = ["Pedal", "Steer"] } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.outputs = outputs;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
  }

  resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
  }

  layout(layers) {
    const left = 24;
    const right = 70;
    const top = 20;
    const bottom = 6;
    const span = this.height - top - bottom;
    return layers.map((n, l) => {
      const x = left + ((this.width - left - right) * l) / (layers.length - 1);
      const pitch = Math.min(span / Math.max(n - 1, 1), 26);
      const y0 = top + (span - pitch * (n - 1)) / 2;
      return Array.from({ length: n }, (_, i) => [x, y0 + pitch * i]);
    });
  }

  draw(brain) {
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    if (!brain) return;

    const { layers, weights, activations } = brain;
    const nodes = this.layout(layers);
    const paths = Array.from({ length: STEPS * 2 }, () => new Path2D());

    let k = 0;
    for (let l = 1; l < layers.length; l++) {
      const nIn = layers[l - 1];
      const nOut = layers[l];
      const input = activations[l - 1];
      for (let o = 0; o < nOut; o++) {
        const [x1, y1] = nodes[l][o];
        for (let i = 0; i < nIn; i++) {
          const w = weights[k + o * nIn + i];
          const strength = Math.min(1, Math.abs(w) * 0.6) * (0.12 + 0.88 * Math.min(1, Math.abs(input[i])));
          const step = Math.min(STEPS - 1, Math.floor(strength * STEPS));
          const path = paths[(w < 0 ? STEPS : 0) + step];
          const [x0, y0] = nodes[l - 1][i];
          path.moveTo(x0, y0);
          path.lineTo(x1, y1);
        }
      }
      k += nOut * (nIn + 1);
    }

    ctx.lineWidth = 0.75;
    for (let p = 0; p < paths.length; p++) {
      const step = p % STEPS;
      ctx.strokeStyle = `rgba(${p < STEPS ? BLUE : ROSE},${0.025 + (step / (STEPS - 1)) ** 1.6 * 0.6})`;
      ctx.stroke(paths[p]);
    }

    for (let l = 0; l < layers.length; l++) {
      const r = RADIUS[Math.min(l, RADIUS.length - 1)];
      const values = activations[l];
      nodes[l].forEach(([x, y], i) => {
        const a = Math.max(-1, Math.min(1, values[i]));
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.fillStyle = `rgba(${a < 0 ? ROSE : BLUE},${Math.abs(a)})`;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(${INK},.55)`;
        ctx.stroke();
      });
    }

    ctx.font = `500 8.5px ${MONO}`;
    ctx.fillStyle = `rgba(${INK},.5)`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    nodes.forEach((column, l) => ctx.fillText(String(layers[l]), column[0][0], 6));

    ctx.textAlign = "right";
    for (const i of INPUT_MARKS) {
      if (i < layers[0]) ctx.fillText(String(i).padStart(2, "0"), nodes[0][i][0] - 7, nodes[0][i][1]);
    }

    const out = nodes[nodes.length - 1];
    const values = activations[activations.length - 1];
    ctx.textAlign = "left";
    out.forEach(([x, y], i) => {
      ctx.font = "700 9px InterVariable, Inter, system-ui, sans-serif";
      ctx.fillStyle = `rgb(${INK})`;
      ctx.fillText((this.outputs[i] ?? `out ${i}`).toUpperCase(), x + 10, y - 6);
      ctx.font = `500 9px ${MONO}`;
      ctx.fillStyle = `rgba(${INK},.5)`;
      ctx.fillText(signed(values[i]), x + 10, y + 6);
    });
  }
}

function signed(v) {
  return `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(2)}`;
}
