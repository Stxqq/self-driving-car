import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../src/sim/rng.js";
import { TrainSession } from "../src/ui/sessions.js";

// The speed buttons only change how many fixed steps run per frame; a
// generation has to come out the same at 64x as at 1x.
test("training at 64x gives the same generations as at 1x", () => {
  const run = (speed) => {
    const session = new TrainSession({ rng: new Rng(7), say: () => {} });
    session.speed = speed;
    while (session.generation < 2) session.advance(1 / 60);
    return session.history;
  };
  assert.deepEqual(run(64), run(1));
});

test("starting from the pretrained brain, the field changes lanes from the first round", async () => {
  const { readFile } = await import("node:fs/promises");
  const { Brain } = await import("../src/sim/brain.js");
  const ancestor = Brain.fromJSON(JSON.parse(await readFile(new URL("../src/brains/pretrained.json", import.meta.url), "utf8")));
  const session = new TrainSession({ rng: new Rng(1), say: () => {}, ancestor });
  session.speed = 1e9;
  while (session.generation < 2) session.advance(1);
  assert.ok(session.history[1].changesPerKm > 1, `${session.history[1].changesPerKm.toFixed(2)} per km`);
});
