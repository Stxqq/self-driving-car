/**
 * A small fully connected network with tanh on every layer. All weights
 * live in one flat Float64Array, layer after layer, each layer stored as
 * its weight matrix (row per output) followed by its biases. Evolution
 * only ever sees that flat genome.
 */
export class Brain {
  constructor(layers, weights = new Float64Array(Brain.genomeLength(layers))) {
    if (weights.length !== Brain.genomeLength(layers)) {
      throw new Error(`expected ${Brain.genomeLength(layers)} weights for [${layers}], got ${weights.length}`);
    }
    this.layers = layers.slice();
    this.weights = weights;
    this.activations = layers.map((n) => new Float64Array(n));
  }

  static genomeLength(layers) {
    let n = 0;
    for (let l = 1; l < layers.length; l++) n += layers[l] * (layers[l - 1] + 1);
    return n;
  }

  /** Random weights scaled by fan-in, biases near zero. */
  static random(layers, rng) {
    const brain = new Brain(layers);
    let k = 0;
    for (let l = 1; l < layers.length; l++) {
      const fanIn = layers[l - 1];
      const scale = 1 / Math.sqrt(fanIn);
      for (let i = 0; i < layers[l] * fanIn; i++) brain.weights[k++] = rng.normal() * scale;
      for (let i = 0; i < layers[l]; i++) brain.weights[k++] = rng.normal() * 0.1;
    }
    return brain;
  }

  /** Runs the network; returns the output layer (reused between calls). */
  forward(inputs) {
    const w = this.weights;
    const acts = this.activations;
    acts[0].set(inputs);
    let k = 0;
    for (let l = 1; l < this.layers.length; l++) {
      const input = acts[l - 1];
      const output = acts[l];
      const nIn = input.length;
      const nOut = output.length;
      const biasAt = k + nOut * nIn;
      for (let o = 0; o < nOut; o++) {
        let sum = w[biasAt + o];
        for (let i = 0; i < nIn; i++) sum += w[k + i] * input[i];
        k += nIn;
        output[o] = Math.tanh(sum);
      }
      k += nOut;
    }
    return acts[acts.length - 1];
  }

  clone() {
    return new Brain(this.layers, Float64Array.from(this.weights));
  }

  /**
   * Copy with each weight nudged by N(0, scale) with probability `rate`.
   * Now and then a weight is reset outright, which helps escape plateaus.
   */
  mutated(rng, rate, scale) {
    const child = this.clone();
    const w = child.weights;
    for (let i = 0; i < w.length; i++) {
      if (!rng.chance(rate)) continue;
      w[i] = rng.chance(0.05) ? rng.normal() * 0.5 : w[i] + rng.normal() * scale;
    }
    return child;
  }

  /**
   * Child of two parents with the same shape. "uniform" picks each weight
   * from one parent; "blend" mixes them (BLX-0.25), which can land a bit
   * outside the parents' range.
   */
  static crossover(a, b, rng, mode = "uniform") {
    const child = new Brain(a.layers);
    const w = child.weights;
    if (mode === "blend") {
      for (let i = 0; i < w.length; i++) {
        const t = rng.range(-0.25, 1.25);
        w[i] = a.weights[i] + (b.weights[i] - a.weights[i]) * t;
      }
    } else {
      for (let i = 0; i < w.length; i++) w[i] = rng.chance(0.5) ? a.weights[i] : b.weights[i];
    }
    return child;
  }

  toJSON() {
    return { layers: this.layers, weights: Array.from(this.weights) };
  }

  static fromJSON({ layers, weights }) {
    return new Brain(layers, Float64Array.from(weights));
  }
}
