// The car in focus, redrawn nose-up at a fixed size for the spec sheet:
// what its lane scan is tracking in each lane, front wheels turned by the
// planner's steering, brake lights and indicators.

import { VIEW } from "../sim/perception.js";

const NS = "http://www.w3.org/2000/svg";
// gaps are drawn on a square-root scale: linear, a car five meters ahead
// would hide under the body while an empty lane ran off the tile
const GAP_SCALE = 19;
const LANE_PITCH = 104;
const WHEEL_TURN = 0.25;

const length = (gap, range) => Math.sqrt(Math.min(Math.max(gap, 0), range)) * GAP_SCALE;

export class Anatomy {
  constructor(root) {
    this.root = root;
    this.layer = root.querySelector("[data-rays]");
    this.wheels = [...root.querySelectorAll("[data-wheel]")];
    this.brakes = root.querySelector("[data-brakes]");
    this.signals = { "-1": root.querySelector('[data-signal="left"]'), 1: root.querySelector('[data-signal="right"]') };
    this.turn = 0;
    this.lanes = [-1, 0, 1].map((k) => {
      const group = document.createElementNS(NS, "g");
      group.setAttribute("transform", `translate(${k * LANE_PITCH} 0)`);
      const make = (tag) => group.appendChild(document.createElementNS(NS, tag));
      const ahead = make("line");
      const behind = make("line");
      const front = make("rect");
      const back = make("rect");
      for (const box of [front, back]) {
        box.setAttribute("x", "-11");
        box.setAttribute("width", "22");
        box.setAttribute("height", "40");
        box.setAttribute("rx", "6");
      }
      this.layer.append(group);
      return { group, ahead, behind, front, back };
    });
  }

  /** `ease` is the share of the way the wheels move toward the steering this frame. */
  update(driver, ease = 1) {
    const { car, planner, scan } = driver;
    scan.lanes.forEach((view, k) => {
      const lane = this.lanes[k];
      lane.group.style.opacity = view.exists ? "1" : "0";
      // the own lane's lines start at the bumpers, not under the body
      const start = k === 1 ? 98 : 0;
      const up = start + length(view.ahead.gap, VIEW.ahead);
      const down = start + length(view.behind.gap, VIEW.behind);
      place(lane.ahead, -start, -up, lane.front, view.ahead.car, -up - 40);
      place(lane.behind, start, down, lane.back, view.behind.car, down);
    });
    this.turn += ((-car.steer * WHEEL_TURN * 180) / Math.PI - this.turn) * ease;
    for (const wheel of this.wheels) wheel.style.transform = `rotate(${this.turn.toFixed(1)}deg)`;
    this.brakes.style.opacity = car.brake > 0.05 || !driver.alive ? "1" : "0";
    for (const side of [-1, 1]) this.signals[side].classList.toggle("on", driver.alive && planner.signal === side);
  }
}

function place(line, from, to, box, tracked, boxY) {
  line.setAttribute("y1", from.toFixed(1));
  line.setAttribute("y2", to.toFixed(1));
  line.style.opacity = tracked ? "0.75" : "0.2";
  box.setAttribute("y", boxY.toFixed(1));
  box.style.opacity = tracked ? "1" : "0";
}
