// sfc32 seeded through splitmix32. Every source of randomness in the sim
// goes through one of these so a seed fully determines a run.

function splitmix32(state) {
  return () => {
    state = (state + 0x9e3779b9) | 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** Mixes a seed with a string label into a new 32-bit seed. */
export function deriveSeed(seed, label = "") {
  let h = (seed >>> 0) ^ 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    h = Math.imul(h ^ label.charCodeAt(i), 0x01000193);
  }
  return splitmix32(h)();
}

export class Rng {
  constructor(seed) {
    const mix = splitmix32(seed >>> 0);
    this.a = mix();
    this.b = mix();
    this.c = mix();
    this.d = mix();
    this.spareNormal = null;
    for (let i = 0; i < 12; i++) this.uint();
  }

  uint() {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform in [0, 1). */
  next() {
    return this.uint() / 4294967296;
  }

  range(lo, hi) {
    return lo + (hi - lo) * this.next();
  }

  int(n) {
    return Math.floor(this.next() * n);
  }

  chance(p) {
    return this.next() < p;
  }

  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }

  normal() {
    if (this.spareNormal !== null) {
      const z = this.spareNormal;
      this.spareNormal = null;
      return z;
    }
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spareNormal = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }

  fork(label) {
    return new Rng(deriveSeed(this.uint(), label));
  }
}
