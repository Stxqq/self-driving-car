import { parentPort } from "node:worker_threads";
import { Brain } from "../src/sim/brain.js";
import { runEpisode } from "../src/sim/world.js";

// Each brain drives its road alone: traffic reacts to the cars around it,
// so sharing a road would make one brain's score depend on the others.
parentPort.on("message", ({ id, layers, genomes, seed, seconds, density }) => {
  const outcomes = genomes.map((w) => runEpisode([new Brain(layers, w)], { seed, seconds, density })[0]);
  parentPort.postMessage({ id, outcomes });
});
