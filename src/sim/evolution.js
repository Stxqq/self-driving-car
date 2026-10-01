import { Brain } from "./brain.js";
import { Rng, deriveSeed } from "./rng.js";

const CRASH_PENALTY = 300;
const STALL_PENALTY = 300;

/** Meters of road covered, minus a flat penalty for how the run ended. */
export function fitness(outcome) {
  let score = outcome.distance;
  if (outcome.crashed) score -= CRASH_PENALTY;
  if (outcome.stalled) score -= STALL_PENALTY;
  return score;
}

const DEFAULTS = {
  size: 120,
  elite: 4,
  tournament: 4,
  crossover: "blend",
  crossoverRate: 0.7,
  // per-weight mutation probability and step size both decay toward their
  // floor with this half-life in generations
  mutationRate: [0.15, 0.03],
  mutationScale: [0.45, 0.08],
  halfLife: 40,
};

/**
 * A generational genetic algorithm over Brain weights: elitism, tournament
 * selection, crossover and annealed gaussian mutation. Deterministic for a
 * given seed and sequence of scores.
 */
export class Evolution {
  constructor({ layers, seed = 1, ancestor = null, ...options }) {
    Object.assign(this, DEFAULTS, options);
    this.layers = layers;
    this.rng = new Rng(deriveSeed(seed, "evolution"));
    this.generation = 0;
    if (ancestor) {
      this.population = [ancestor.clone()];
      while (this.population.length < this.size) {
        this.population.push(ancestor.mutated(this.rng, this.annealed(this.mutationRate), this.annealed(this.mutationScale)));
      }
    } else {
      this.population = Array.from({ length: this.size }, () => Brain.random(layers, this.rng));
    }
  }

  annealed([start, end]) {
    return end + (start - end) * Math.exp((-Math.LN2 * this.generation) / this.halfLife);
  }

  pick(order, scores) {
    let best = order[this.rng.int(order.length)];
    for (let i = 1; i < this.tournament; i++) {
      const other = order[this.rng.int(order.length)];
      if (scores[other] > scores[best]) best = other;
    }
    return this.population[best];
  }

  /**
   * Scores line up with `population`. Replaces the population with the next
   * generation and returns a summary of the one that was just scored.
   */
  evolve(scores) {
    const n = this.population.length;
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => scores[b] - scores[a] || a - b);
    const champion = this.population[order[0]];
    const mean = scores.reduce((sum, x) => sum + x, 0) / n;

    const rate = this.annealed(this.mutationRate);
    const scale = this.annealed(this.mutationScale);
    const next = order.slice(0, this.elite).map((i) => this.population[i]);
    while (next.length < this.size) {
      const a = this.pick(order, scores);
      let child;
      if (this.rng.chance(this.crossoverRate)) {
        const b = this.pick(order, scores);
        child = Brain.crossover(a, b, this.rng, this.crossover).mutated(this.rng, rate, scale);
      } else {
        child = a.mutated(this.rng, rate, scale);
      }
      next.push(child);
    }

    this.population = next;
    this.generation++;
    return { generation: this.generation - 1, best: scores[order[0]], mean, champion, rate, scale };
  }
}
