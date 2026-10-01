import { test } from "node:test";
import assert from "node:assert/strict";
import {
  orientedBox,
  pointInPolygon,
  polygonsOverlap,
  polygonTouchesPolyline,
  segmentHit,
  wrapAngle,
} from "../src/sim/geometry.js";

const square = [0, 0, 2, 0, 2, 2, 0, 2];

test("crossing segments report the fraction along the first one", () => {
  assert.equal(segmentHit(0, 0, 4, 0, 1, -1, 1, 1), 0.25);
  assert.equal(segmentHit(0, 0, 4, 4, 0, 4, 4, 0), 0.5);
});

test("disjoint, parallel and too-short segments do not hit", () => {
  assert.equal(segmentHit(0, 0, 1, 0, 2, -1, 2, 1), -1);
  assert.equal(segmentHit(0, 0, 4, 0, 0, 1, 4, 1), -1);
  assert.equal(segmentHit(0, 0, 4, 0, 1, 0.5, 1, 3), -1);
});

test("point in polygon", () => {
  assert.ok(pointInPolygon(1, 1, square));
  assert.ok(!pointInPolygon(3, 1, square));
  assert.ok(!pointInPolygon(-0.01, 1, square));
});

test("polygon overlap covers crossing edges and full containment", () => {
  assert.ok(polygonsOverlap(square, [1, 1, 3, 1, 3, 3, 1, 3]));
  assert.ok(polygonsOverlap(square, [0.5, 0.5, 1, 0.5, 1, 1, 0.5, 1]));
  assert.ok(polygonsOverlap([0.5, 0.5, 1, 0.5, 1, 1, 0.5, 1], square));
  assert.ok(!polygonsOverlap(square, [3, 3, 4, 3, 4, 4, 3, 4]));
});

test("polygon against a polyline window", () => {
  const line = [-5, 1, 0, 1, 5, 1, 10, 1];
  assert.ok(polygonTouchesPolyline(square, line, 0, 4));
  assert.ok(!polygonTouchesPolyline(square, line, 2, 4));
});

test("oriented box keeps its dimensions under rotation", () => {
  const box = orientedBox(new Float64Array(8), 3, -2, 0.7, 4.5, 1.8);
  const edge = (i, j) => Math.hypot(box[j] - box[i], box[j + 1] - box[i + 1]);
  assert.ok(Math.abs(edge(0, 2) - 1.8) < 1e-12);
  assert.ok(Math.abs(edge(2, 4) - 4.5) < 1e-12);
  const cx = (box[0] + box[4]) / 2;
  const cy = (box[1] + box[5]) / 2;
  assert.ok(Math.abs(cx - 3) < 1e-12 && Math.abs(cy + 2) < 1e-12);
  // front-left corner sits to the left of the heading
  const fx = Math.cos(0.7);
  const fy = Math.sin(0.7);
  assert.ok(fx * (box[1] - cy) - fy * (box[0] - cx) > 0);
});

test("wrapAngle maps into [-pi, pi)", () => {
  assert.ok(Math.abs(wrapAngle(3 * Math.PI) + Math.PI) < 1e-12);
  assert.ok(Math.abs(wrapAngle(-0.5) + 0.5) < 1e-12);
  assert.ok(Math.abs(wrapAngle(7) - (7 - 2 * Math.PI)) < 1e-12);
});
