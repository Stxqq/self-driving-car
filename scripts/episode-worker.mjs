import { parentPort } from "node:worker_threads";
import { Brain } from "../src/sim/brain.js";
import { runEpisode } from "../src/sim/world.js";

parentPort.on("message", ({ id, layers, genomes, seed, seconds }) => {
  const brains = genomes.map((w) => new Brain(layers, w));
  parentPort.postMessage({ id, outcomes: runEpisode(brains, { seed, seconds }) });
});
