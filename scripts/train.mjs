// Headless training. Each generation drives the whole population on a few
// fresh seeds, spread over worker threads; every few generations the top
// of the field is re-checked on fixed validation seeds and the best of
// those is written to disk.
//
//   node scripts/train.mjs --generations 200 --population 140
//   node scripts/train.mjs --resume            # continue from the saved brain

import { availableParallelism } from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Worker } from "node:worker_threads";
import { Brain } from "../src/sim/brain.js";
import { Evolution, fitness } from "../src/sim/evolution.js";
import { DEFAULT_LAYERS } from "../src/sim/world.js";

const { values: args } = parseArgs({
  options: {
    generations: { type: "string", default: "200" },
    population: { type: "string", default: "140" },
    seeds: { type: "string", default: "3" },
    seconds: { type: "string", default: "75" },
    workers: { type: "string", default: String(Math.max(1, availableParallelism() - 1)) },
    seed: { type: "string", default: "1" },
    resume: { type: "boolean", default: false },
    out: { type: "string", default: "src/brains/pretrained.json" },
  },
});

const GENERATIONS = Number(args.generations);
const SEEDS_PER_GEN = Number(args.seeds);
const SECONDS = Number(args.seconds);
const VALIDATION_SEEDS = [5001, 5002, 5003, 5004];
const VALIDATION_SECONDS = 120;
const VALIDATE_EVERY = 5;
const VALIDATE_TOP = 6;
const outPath = resolve(fileURLToPath(new URL("..", import.meta.url)), args.out);

class EpisodePool {
  constructor(size) {
    this.size = size;
    this.idle = [];
    this.queue = [];
    this.pending = new Map();
    this.nextId = 0;
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL("./episode-worker.mjs", import.meta.url));
      worker.on("message", ({ id, outcomes }) => {
        this.pending.get(id)(outcomes);
        this.pending.delete(id);
        this.release(worker);
      });
      worker.on("error", (err) => {
        console.error(err);
        process.exit(1);
      });
      this.idle.push(worker);
    }
  }

  release(worker) {
    const job = this.queue.shift();
    if (job) worker.postMessage(job);
    else this.idle.push(worker);
  }

  run(job) {
    return new Promise((resolve) => {
      const id = this.nextId++;
      this.pending.set(id, resolve);
      const msg = { id, ...job };
      const worker = this.idle.pop();
      if (worker) worker.postMessage(msg);
      else this.queue.push(msg);
    });
  }

  /** Drives brains on each seed; returns outcomes[brain][seed]. */
  async drive(brains, seeds, seconds) {
    // about two jobs per worker keeps them all busy without much overhead
    const chunk = Math.ceil(brains.length / Math.ceil((this.size * 2) / seeds.length));
    const jobs = [];
    for (const [k, seed] of seeds.entries()) {
      for (let start = 0; start < brains.length; start += chunk) {
        const part = brains.slice(start, start + chunk);
        const job = this.run({ layers: part[0].layers, genomes: part.map((b) => b.weights), seed, seconds });
        jobs.push(job.then((outcomes) => ({ k, start, outcomes })));
      }
    }
    const table = brains.map(() => new Array(seeds.length));
    for (const { k, start, outcomes } of await Promise.all(jobs)) {
      outcomes.forEach((o, i) => (table[start + i][k] = o));
    }
    return table;
  }

  close() {
    for (const worker of this.idle) worker.terminate();
    this.idle = [];
  }
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pad = (v, n) => String(v).padStart(n);

async function loadAncestor() {
  try {
    return Brain.fromJSON(JSON.parse(await readFile(outPath, "utf8")));
  } catch {
    console.error(`no brain at ${args.out}, starting from scratch`);
    return null;
  }
}

const ancestor = args.resume ? await loadAncestor() : null;
const evolution = new Evolution({
  layers: ancestor ? ancestor.layers : DEFAULT_LAYERS,
  size: Number(args.population),
  seed: Number(args.seed),
  ancestor,
  // a resumed run starts from a good driver; don't shake it too hard
  ...(ancestor && { mutationRate: [0.05, 0.02], mutationScale: [0.15, 0.05] }),
});
const pool = new EpisodePool(Number(args.workers));

let record = -Infinity;
if (ancestor) {
  const [scores] = await pool.drive([ancestor], VALIDATION_SEEDS, VALIDATION_SECONDS);
  record = mean(scores.map((o) => o.distance));
  console.log(`resuming from ${args.out}: ${record.toFixed(0)} m on validation`);
}

console.log(`${pool.size} workers, population ${evolution.size}, ${SEEDS_PER_GEN} seeds x ${SECONDS} s`);
console.log(" gen   best m   mean m  alive    mut     s");

const started = performance.now();
for (let g = 0; g < GENERATIONS; g++) {
  const t0 = performance.now();
  const seeds = Array.from({ length: SEEDS_PER_GEN }, (_, j) => 100000 * Number(args.seed) + evolution.generation * SEEDS_PER_GEN + j);
  const table = await pool.drive(evolution.population, seeds, SECONDS);

  const scores = table.map((runs) => mean(runs.map(fitness)));
  const distances = table.map((runs) => mean(runs.map((o) => o.distance)));
  const alive = table.filter((runs) => runs.every((o) => !o.crashed && !o.stalled)).length;
  const ranked = evolution.population.map((brain, i) => ({ brain, score: scores[i] })).sort((a, b) => b.score - a.score);
  const summary = evolution.evolve(scores);

  console.log(
    pad(summary.generation, 4),
    pad(Math.max(...distances).toFixed(0), 8),
    pad(mean(distances).toFixed(0), 8),
    pad(alive, 6),
    pad(summary.rate.toFixed(3), 6),
    pad(((performance.now() - t0) / 1000).toFixed(1), 5),
  );

  if ((g + 1) % VALIDATE_EVERY === 0 || g === GENERATIONS - 1) {
    const top = ranked.slice(0, VALIDATE_TOP).map((r) => r.brain);
    const results = await pool.drive(top, VALIDATION_SEEDS, VALIDATION_SECONDS);
    const valid = results.map((runs) => mean(runs.map((o) => o.distance)));
    const i = valid.indexOf(Math.max(...valid));
    if (valid[i] > record) {
      record = valid[i];
      const saved = { ...top[i].toJSON(), generation: summary.generation, validation: Math.round(record) };
      await writeFile(outPath, JSON.stringify(saved) + "\n");
      console.log(`      validation ${record.toFixed(0)} m, saved ${args.out}`);
    }
  }
}

pool.close();
console.log(`done in ${((performance.now() - started) / 60000).toFixed(1)} min, best validation ${record.toFixed(0)} m`);
