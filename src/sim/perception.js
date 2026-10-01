import { CAR_SPEC } from "./car.js";

/** How far the lane scan looks, in meters of road. */
export const VIEW = Object.freeze({ ahead: 90, behind: 45 });

class Track {
  constructor() {
    this.car = null;
    this.gap = Infinity;
    this.speed = 0;
  }

  set(car, gap) {
    this.car = car;
    this.gap = gap;
    this.speed = car.speed;
  }

  clear() {
    this.car = null;
    this.gap = Infinity;
    this.speed = 0;
  }
}

class LaneView {
  constructor() {
    this.lane = -1;
    this.exists = false;
    this.ahead = new Track();
    this.behind = new Track();
  }
}

/**
 * What a camera stack hands its planner, instead of raw pixels: for the
 * lane the car is heading for and the lanes either side, the nearest car
 * ahead and behind, bumper to bumper, and how fast each one is going.
 * `lanes[0]` is the lane to the left, `lanes[1]` the car's own, `lanes[2]`
 * the one to the right. While the car is moving over it is in two lanes
 * at once, and its own lane counts cars in either.
 */
export class LaneScan {
  constructor() {
    this.lanes = [new LaneView(), new LaneView(), new LaneView()];
  }

  scan(traffic, road, s, lane, leaving = lane) {
    for (let k = 0; k < 3; k++) {
      const view = this.lanes[k];
      view.lane = lane + k - 1;
      view.exists = view.lane >= 0 && view.lane < road.lanes;
      view.ahead.clear();
      view.behind.clear();
    }
    if (!traffic) return this;
    const near = traffic.within(s - VIEW.behind - CAR_SPEC.length, s + VIEW.ahead + CAR_SPEC.length);
    for (let i = near.start; i < near.end; i++) {
      const other = near.cars[i];
      const ahead = other.s >= s;
      const gap = Math.abs(other.s - s) - CAR_SPEC.length;
      for (let k = 0; k < 3; k++) {
        const view = this.lanes[k];
        if (!view.exists) continue;
        if (!other.occupies(view.lane) && !(k === 1 && other.occupies(leaving))) continue;
        const track = ahead ? view.ahead : view.behind;
        if (gap < track.gap) track.set(other, gap);
      }
    }
    return this;
  }
}
