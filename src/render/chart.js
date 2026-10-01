// A small line chart in SVG, sized to its element in CSS pixels so the
// hairlines stay one pixel wide.

const NS = "http://www.w3.org/2000/svg";

function el(name, attrs, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.append(node);
  return node;
}

function niceCeil(x) {
  if (x <= 0) return 1;
  const base = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * base >= x) return m * base;
  return 10 * base;
}

const km = (m) => (m / 1000).toFixed(m >= 10000 ? 0 : 1);

/**
 * series: [{ values, stroke, width, dots }] in meters, one value per x step.
 * reference: optional { value, label } drawn as a dashed hairline.
 */
export function drawChart(svg, { series, reference = null, empty = "" }) {
  const width = svg.clientWidth || 280;
  const height = svg.clientHeight || 120;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.replaceChildren();

  const count = Math.max(0, ...series.map((s) => s.values.length));
  if (count === 0) {
    el("text", { x: width / 2, y: height / 2, class: "chart-empty", "text-anchor": "middle" }, svg).textContent = empty;
    return;
  }

  const left = 30;
  const right = 8;
  const top = 8;
  const bottom = 16;
  const ceiling = niceCeil(Math.max(1, reference?.value ?? 0, ...series.flatMap((s) => s.values)) * 1.08);
  const x = (i) => left + (count === 1 ? (width - left - right) / 2 : ((width - left - right) * i) / (count - 1));
  const y = (v) => top + (height - top - bottom) * (1 - Math.max(0, v) / ceiling);

  for (const v of [0, ceiling / 2, ceiling]) {
    el("line", { x1: left, x2: width - right, y1: y(v), y2: y(v), class: "chart-grid" }, svg);
    el("text", { x: left - 6, y: y(v) + 3, class: "chart-tick", "text-anchor": "end" }, svg).textContent = km(v);
  }
  el("text", { x: width - right, y: height - 3, class: "chart-tick", "text-anchor": "end" }, svg).textContent = String(count);
  el("text", { x: left, y: height - 3, class: "chart-tick" }, svg).textContent = "1";

  if (reference) {
    el("line", { x1: left, x2: width - right, y1: y(reference.value), y2: y(reference.value), class: "chart-ref" }, svg);
    const label = el("text", { x: width - right, y: y(reference.value) - 4, class: "chart-tick", "text-anchor": "end" }, svg);
    label.textContent = reference.label;
  }

  for (const { values, stroke, width: w = 1.5, dots = false } of series) {
    if (values.length > 1) {
      const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
      el("polyline", { points, fill: "none", stroke, "stroke-width": w, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    }
    if (dots || values.length === 1) {
      values.forEach((v, i) => el("circle", { cx: x(i), cy: y(v), r: 2.5, fill: "#fff", stroke, "stroke-width": 1.25 }, svg));
    }
  }
}
