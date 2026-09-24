export class LatencyWindow {
  readonly capacity: number;
  #samples: number[] = [];
  #cursor = 0;
  #count = 0;

  constructor(capacity = 200) {
    this.capacity = capacity;
  }

  record(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.#samples[this.#cursor] = ms;
    this.#cursor = (this.#cursor + 1) % this.capacity;
    this.#count += 1;
  }

  get count(): number {
    return this.#count;
  }

  percentile(p: number): number {
    if (this.#samples.length === 0) return 0;
    const sorted = [...this.#samples].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return sorted[index] ?? 0;
  }

  get p50(): number {
    return this.percentile(0.5);
  }

  get p95(): number {
    return this.percentile(0.95);
  }

  get max(): number {
    return this.#samples.length === 0 ? 0 : Math.max(...this.#samples);
  }

  snapshot(): LatencySnapshot {
    return { count: this.#count, p50: this.p50, p95: this.p95, max: this.max };
  }
}

export interface LatencySnapshot {
  count: number;
  p50: number;
  p95: number;
  max: number;
}
