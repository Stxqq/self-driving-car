import { Brain } from "../sim/brain.js";
import { Rng } from "../sim/rng.js";
import { Anatomy } from "../render/anatomy.js";
import { drawChart } from "../render/chart.js";
import { NetworkView } from "../render/network.js";
import { Stage, easeFactor } from "../render/stage.js";
import { downloadBrain, readBrainFile, saveBrain, savedBrain } from "./brains.js";
import { Counter } from "./counter.js";
import { Pilot } from "./pilot.js";
import { DriveSession, POPULATION, SPEEDS, TrainSession, WatchSession, km } from "./sessions.js";

const $ = (selector) => document.querySelector(selector);
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const EASE = "cubic-bezier(.32,.72,0,1)";

// set up before the fetches below, so the text further down the page shows
// up even if they fail
const reveal = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("in");
      reveal.unobserve(entry.target);
    }
  },
  { rootMargin: "0px 0px -10% 0px" },
);
document.documentElement.classList.add("reveals");
document.querySelectorAll(".reveal").forEach((el) => reveal.observe(el));

const [pretrained, heldOut] = await Promise.all([
  fetch("src/brains/pretrained.json")
    .then((r) => r.json())
    .then((json) => Brain.fromJSON(json))
    .catch((err) => {
      $("#caption-sub").textContent = "Couldn't load the pretrained brain";
      throw err;
    }),
  fetch("scripts/results.json")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null),
]);

const stageEl = $("#stage");
const canvas = $("#road");
const stage = new Stage(canvas);
const network = new NetworkView($("#net"));
const anatomy = new Anatomy($("#anatomy"));
const chart = $("#chart");

const counters = {
  first: new Counter($("#first")),
  distance: new Counter($("#distance"), { decimals: 2 }),
  speed: new Counter($("#speed")),
  last: new Counter($("#last")),
};

const toast = $("#toast");
let toastTimer = 0;
function say(text) {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

const rng = new Rng((Math.random() * 2 ** 32) >>> 0);
const pilot = new Pilot();
const sessions = {};
function newTraining(ancestor) {
  const session = new TrainSession({ rng, say, ancestor });
  session.speed = trainSpeed;
  return session;
}
const create = {
  watch: () => new WatchSession({ brain: pretrained, rng, say }),
  train: () => newTraining(null),
  drive: () => new DriveSession({ pilot, shadow: pretrained.clone(), rng, say }),
};
let watchSource = "Pretrained";
let trainSpeed = 1;
let mode = null;

const LABELS = {
  watch: { first: ["Road", ""], last: ["Time", "s", 0] },
  train: { first: ["Generation", ""], last: ["Alive", `/ ${POPULATION}`, 0] },
  drive: { first: ["Attempt", ""], last: ["Best", "km", 2] },
};

function markPill(name) {
  const links = [...document.querySelectorAll(".pill-btn")];
  for (const link of links) link.setAttribute("aria-current", String(link.dataset.mode === name));
  const active = links.find((link) => link.dataset.mode === name);
  $(".pill-ind").style.transform = `translateX(${active.offsetLeft}px)`;
}

function setMode(next) {
  if (!create[next]) next = "watch";
  if (next === mode) return;
  mode = next;
  sessions[mode] ??= create[mode]();
  stageEl.dataset.mode = mode;
  pilot.release();

  markPill(mode);

  const { first, last } = LABELS[mode];
  $("#first-label").textContent = first[0];
  $("#first-unit").textContent = first[1];
  $("#last-label").textContent = last[0];
  $("#last-unit").textContent = last[1];
  counters.last.decimals = last[2];
  for (const counter of Object.values(counters)) counter.value = 0;

  shownWorld = null;
  chartKey = "";
  updateBrainStatus();
  if (!motion.matches) {
    canvas.animate([{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }], { duration: 450, easing: EASE });
    const changed = [...document.querySelectorAll(".stats .stat, .chart-card, .controls > *")].filter((el) => el.offsetParent);
    changed.forEach((el, i) =>
      el.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], {
        duration: 450,
        delay: i * 50,
        easing: EASE,
        fill: "backwards",
      }),
    );
  }
}

// the old road leaves before the new one comes in; another click while it
// leaves only changes where it is going
let leaving = null;
let target = null;
async function switchMode(next) {
  target = create[next] ? next : "watch";
  markPill(target);
  if (leaving || target === mode) return;
  if (!motion.matches) {
    leaving = canvas.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(-10px)" }], {
      duration: 220,
      easing: EASE,
      fill: "forwards",
    });
    await leaving.finished;
  }
  setMode(target);
  leaving?.cancel();
  leaving = null;
}

let shownWorld = null;
let shownTime = 0;
function updateCaption(world) {
  const traffic = world.traffic ? `traffic ${Math.round(world.traffic.density * 100)}%` : "no traffic";
  const who = {
    watch: `${watchSource.toLowerCase()} driver`,
    train: `${POPULATION} cars per generation`,
    drive: "you are driving",
  }[mode];
  $("#caption-sub").textContent = `Seed ${world.seed} · ${traffic} · ${who}`;
}

function updateBrainStatus() {
  const status = $("#brain-status");
  if (mode === "watch") {
    status.textContent = watchSource === "Pretrained" && heldOut
      ? `Pretrained, ${km(heldOut.meanMeters)} km mean on held-out roads`
      : watchSource;
  } else if (mode === "train") {
    const train = sessions.train;
    status.textContent = train.champion
      ? `Winner of generation ${train.generation}`
      : "Random weights, first generation";
  } else {
    status.textContent = "The network shows what the pretrained brain would do in your place.";
  }
  $('[data-brain="load"]').disabled = !savedBrain();
}

// the chart only changes between runs and generations, not every frame
let chartKey = "";
function updateChart(session) {
  const legend = $("#chart-legend");
  const reference = heldOut && { value: heldOut.meanMeters, label: `network ${km(heldOut.meanMeters)}` };
  let key;
  let chartFor;
  if (mode === "train") {
    const history = session.history;
    key = `train:${history.length}`;
    chartFor = () => {
      $("#chart-title").textContent = "Distance";
      $("#chart-note").textContent = "per generation";
      legend.innerHTML = '<i style="background:#111113"></i><span>best</span><i style="background:#9a9aa2"></i><span>mean</span>';
      return {
        series: [
          { values: history.map((g) => g.mean), stroke: "#9a9aa2", width: 1.25 },
          { values: history.map((g) => g.best), stroke: "#111113", width: 1.5 },
        ],
        empty: "The first generation is on the road",
      };
    };
  } else if (mode === "drive") {
    key = `drive:${session.distances.length}`;
    chartFor = () => {
      $("#chart-title").textContent = "Your runs";
      $("#chart-note").textContent = `${session.distances.length} so far`;
      legend.textContent = "Dashed: the pretrained network's mean on held-out roads.";
      return {
        series: [{ values: session.distances, stroke: "#111113", width: 1.5, dots: true }],
        reference,
        empty: "Finish a run to see it here",
      };
    };
  } else {
    key = "watch";
    chartFor = () => {
      $("#chart-title").textContent = "Held-out roads";
      $("#chart-note").textContent = heldOut ? `${heldOut.runs.length} seeds · ${heldOut.limits.seconds / 60} min` : "";
      legend.textContent = "The pretrained brain on roads it never saw.";
      return {
        series: [{ values: heldOut ? heldOut.runs.map((r) => r.meters) : [], stroke: "#111113", width: 1.25, dots: true }],
        reference: reference && { ...reference, label: `mean ${km(heldOut.meanMeters)}` },
        empty: "No results file",
      };
    };
  }
  if (key === chartKey) return;
  chartKey = key;
  const spec = chartFor();
  legend.hidden = spec.series.every((s) => s.values.length === 0) && !spec.reference;
  drawChart(chart, spec);
}

let anatomyVisible = false;
new IntersectionObserver(([entry]) => {
  anatomyVisible = entry.isIntersecting;
}).observe($("#anatomy"));

let last = performance.now();
let raf = 0;
function frame(now) {
  // clamped so a stalled tab doesn't fast-forward the cars on its return
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const session = sessions[mode];
  session.advance(dt);

  const world = session.world;
  // the camera eases in sim time, or at 64x it would trail by half a kilometer
  let simulated = world.time - shownTime;
  if (world !== shownWorld) {
    if (shownWorld) stage.snap();
    shownWorld = world;
    simulated = 0;
    updateCaption(world);
    if (mode === "train") updateBrainStatus();
  }
  shownTime = world.time;
  const focus = session.focus;
  const k = motion.matches ? 1 : easeFactor(0.085, dt);
  stage.draw(world, focus, simulated, { ghosts: mode === "train" });
  network.draw(session.network());
  if (anatomyVisible) anatomy.update(focus, session.outputs(), k);
  updateChart(session);

  counters.first.set(mode === "train" ? session.generation + 1 : session.runs);
  counters.distance.set(focus.distance / 1000);
  counters.speed.set(focus.car.speed * 3.6);
  counters.last.set(mode === "watch" ? focus.time : mode === "train" ? world.alive : session.best / 1000);
  for (const counter of Object.values(counters)) counter.tick(k);
  stageEl.dataset.ready = "";

  raf = requestAnimationFrame(frame);
}

function resize() {
  stage.resize();
  network.resize();
  chartKey = "";
}
new ResizeObserver(resize).observe(canvas);
new ResizeObserver(resize).observe($("#net"));

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelAnimationFrame(raf);
    raf = 0;
    pilot.release();
  } else if (!raf) {
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
});
stage.reducedMotion = motion.matches;
motion.addEventListener("change", () => (stage.reducedMotion = motion.matches));

const speeds = $("#speeds");
for (const speed of SPEEDS) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "chip";
  chip.textContent = `${speed}x`;
  chip.setAttribute("aria-pressed", String(speed === 1));
  chip.addEventListener("click", () => {
    trainSpeed = speed;
    sessions.train.speed = speed;
    for (const other of speeds.children) other.setAttribute("aria-pressed", String(other === chip));
  });
  speeds.append(chip);
}

$("#new-road").addEventListener("click", () => sessions.watch.newRun());

function adopt(brain, source) {
  if (mode === "train") {
    sessions.train = newTraining(brain);
    say("Evolving from the loaded brain");
  } else {
    watchSource = source;
    sessions.watch.use(brain);
    say(`${source} brain on a new road`);
  }
  updateBrainStatus();
}

const brainActions = {
  save() {
    const brain = mode === "train" ? sessions.train.best : sessions.watch.brain;
    say(saveBrain(brain) ? "Saved in this browser" : "This browser won't keep it");
    updateBrainStatus();
  },
  load() {
    const brain = savedBrain();
    if (brain) adopt(brain, "Saved");
  },
  export() {
    const brain = mode === "train" ? sessions.train.best : sessions.watch.brain;
    const name = mode === "train" ? `brain-generation-${sessions.train.generation}.json` : "brain.json";
    downloadBrain(brain, name);
  },
  import() {
    $("#import-file").click();
  },
  reset() {
    if (mode === "train") {
      sessions.train = newTraining(null);
      say("Back to random weights");
    } else {
      watchSource = "Pretrained";
      sessions.watch.use(pretrained);
      say("Pretrained brain on a new road");
    }
    updateBrainStatus();
  },
};
for (const button of document.querySelectorAll("[data-brain]")) {
  button.addEventListener("click", () => brainActions[button.dataset.brain]());
}
$("#import-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    adopt(await readBrainFile(file), "Imported");
  } catch (err) {
    say(err instanceof SyntaxError ? "That file isn't JSON" : err.message);
  }
});

addEventListener("keydown", (event) => {
  if (mode !== "drive" || event.metaKey || event.ctrlKey || event.altKey) return;
  const control = Pilot.control(event.code);
  if (control) {
    // the arrow keys would otherwise leave a focus ring on the Drive tab
    if (document.activeElement?.closest(".pill")) document.activeElement.blur();
    pilot.press(control, true);
    event.preventDefault();
  } else if (event.code === "KeyR" && !event.repeat) {
    sessions.drive.newRun();
  }
});
addEventListener("keyup", (event) => {
  const control = Pilot.control(event.code);
  if (control) pilot.press(control, false);
});
addEventListener("blur", () => pilot.release());

for (const button of document.querySelectorAll("[data-control]")) {
  const control = button.dataset.control;
  const up = () => {
    if (!button.classList.contains("down")) return;
    button.classList.remove("down");
    pilot.touch(control, false);
  };
  button.addEventListener("pointerdown", (event) => {
    button.setPointerCapture(event.pointerId);
    button.classList.add("down");
    pilot.touch(control, true);
  });
  button.addEventListener("pointerup", up);
  button.addEventListener("pointercancel", up);
  button.addEventListener("contextmenu", (event) => event.preventDefault());
}

const fact = (name, text) => document.querySelectorAll(`[data-fact="${name}"]`).forEach((el) => (el.textContent = text));
if (heldOut) {
  const runs = heldOut.runs;
  fact("mean", `${km(heldOut.meanMeters)} km`);
  fact("median", `${km(heldOut.medianMeters)} km`);
  fact("survived", `${heldOut.survived} of ${runs.length} roads`);
  fact("speed", `${Math.round(runs.reduce((sum, r) => sum + r.kmh, 0) / runs.length)} km/h`);
  fact("seeds", String(runs.length));
}
fact("weights", String(pretrained.weights.length));

addEventListener("hashchange", () => switchMode(location.hash.slice(1)));
setMode(location.hash.slice(1));
resize();
raf = requestAnimationFrame(frame);
