import { Brain } from "../sim/brain.js";
import { DEFAULT_LAYERS } from "../sim/world.js";

const KEY = "self-driving-car:brain";

function brainForThisCar(json) {
  const brain = Brain.fromJSON(json);
  if (brain.layers.join() !== DEFAULT_LAYERS.join()) {
    throw new Error(`This brain is [${brain.layers}], the car needs [${DEFAULT_LAYERS}]`);
  }
  return brain;
}

// private modes and blocked storage throw; so does a brain saved for an
// older sensor layout. All of them mean "nothing saved".
export function savedBrain() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? brainForThisCar(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveBrain(brain) {
  try {
    localStorage.setItem(KEY, JSON.stringify(brain.toJSON()));
    return true;
  } catch {
    return false;
  }
}

export function downloadBrain(brain, filename) {
  const blob = new Blob([JSON.stringify(brain.toJSON())], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readBrainFile(file) {
  return brainForThisCar(JSON.parse(await file.text()));
}
