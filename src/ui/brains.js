import { Brain } from "../sim/brain.js";
import { DEFAULT_LAYERS } from "../sim/world.js";

const KEY = "self-driving-car:brain";

// localStorage throws in some private modes and when blocked; a missing
// save is the right answer in all of those cases
function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function checked(json) {
  const brain = Brain.fromJSON(json);
  if (brain.layers.join() !== DEFAULT_LAYERS.join()) {
    throw new Error(`This brain is [${brain.layers}], the car needs [${DEFAULT_LAYERS}]`);
  }
  return brain;
}

export function savedBrain() {
  try {
    const raw = storage()?.getItem(KEY);
    return raw ? checked(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveBrain(brain) {
  try {
    storage()?.setItem(KEY, JSON.stringify(brain.toJSON()));
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
  return checked(JSON.parse(await file.text()));
}
