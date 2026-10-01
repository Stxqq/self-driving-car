// Polygons and polylines are flat number arrays [x0, y0, x1, y1, ...].
// Everything takes scalars instead of point objects because these run
// a few million times per training generation.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);

export function wrapAngle(a) {
  return a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
}

/**
 * Where segment AB crosses segment CD, as a fraction along AB in [0, 1],
 * or -1 if they don't touch. Parallel segments count as not touching.
 */
export function segmentHit(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const denom = rx * sy - ry * sx;
  if (denom === 0) return -1;
  const qx = cx - ax;
  const qy = cy - ay;
  const t = (qx * sy - qy * sx) / denom;
  if (t < 0 || t > 1) return -1;
  const u = (qx * ry - qy * rx) / denom;
  if (u < 0 || u > 1) return -1;
  return t;
}

export function pointInPolygon(px, py, poly) {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = poly[i];
    const yi = poly[i + 1];
    const xj = poly[j];
    const yj = poly[j + 1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function edgesCross(a, b) {
  const na = a.length;
  const nb = b.length;
  for (let i = 0; i < na; i += 2) {
    const i2 = (i + 2) % na;
    for (let j = 0; j < nb; j += 2) {
      const j2 = (j + 2) % nb;
      if (segmentHit(a[i], a[i + 1], a[i2], a[i2 + 1], b[j], b[j + 1], b[j2], b[j2 + 1]) >= 0) {
        return true;
      }
    }
  }
  return false;
}

/** True if two closed polygons touch or one contains the other. */
export function polygonsOverlap(a, b) {
  return edgesCross(a, b) || pointInPolygon(a[0], a[1], b) || pointInPolygon(b[0], b[1], a);
}

/** True if any edge of a closed polygon crosses points [from, to) of a polyline. */
export function polygonTouchesPolyline(poly, line, from, to) {
  const n = poly.length;
  for (let i = 0; i < n; i += 2) {
    const i2 = (i + 2) % n;
    for (let p = from; p < to - 1; p++) {
      const k = 2 * p;
      const hit = segmentHit(
        poly[i], poly[i + 1], poly[i2], poly[i2 + 1],
        line[k], line[k + 1], line[k + 2], line[k + 3],
      );
      if (hit >= 0) return true;
    }
  }
  return false;
}

/**
 * Writes the four corners of an oriented rectangle into `out`
 * (front-left, front-right, rear-right, rear-left).
 */
export function orientedBox(out, x, y, heading, length, width) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const hl = length / 2;
  const hw = width / 2;
  out[0] = x + c * hl - s * hw;
  out[1] = y + s * hl + c * hw;
  out[2] = x + c * hl + s * hw;
  out[3] = y + s * hl - c * hw;
  out[4] = x - c * hl + s * hw;
  out[5] = y - s * hl - c * hw;
  out[6] = x - c * hl - s * hw;
  out[7] = y - s * hl + c * hw;
  return out;
}
