/** A number in the page that eases toward its target instead of jumping. */
export class Counter {
  constructor(el, { decimals = 0 } = {}) {
    this.el = el;
    this.decimals = decimals;
    this.value = null;
    this.target = 0;
    this.shown = "";
  }

  set(target, { snap = false } = {}) {
    this.target = target;
    if (snap || this.value === null) this.value = target;
  }

  tick(k) {
    this.value += (this.target - this.value) * k;
    const step = 0.5 * 10 ** -this.decimals;
    if (Math.abs(this.target - this.value) < step) this.value = this.target;
    const text = this.value.toFixed(this.decimals);
    if (text !== this.shown) {
      this.el.textContent = text;
      this.shown = text;
    }
  }
}
