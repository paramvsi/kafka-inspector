// Time series kept by the simulator: 60 s resolution for old data, 1 s for the last 15 minutes.

const KEEP_FINE_MS = 15 * 60 * 1000;

export class History {
  times: number[] = [];
  private data = new Map<string, number[]>();

  /** Append one sample; keys missing from `values` repeat their previous value. */
  push(t: number, values: Map<string, number>): void {
    const n = this.times.length;
    this.times.push(t);
    for (const [k, v] of values) {
      let arr = this.data.get(k);
      if (!arr) {
        arr = new Array<number>(n).fill(NaN);
        this.data.set(k, arr);
      }
      arr.push(v);
    }
    for (const [k, arr] of this.data) {
      if (arr.length === n) arr.push(values.get(k) ?? arr[n - 1] ?? NaN);
    }
  }

  /** Drop 1 s samples older than 15 min, keeping one per minute. */
  compact(now: number): void {
    const keep: number[] = [];
    let lastMinute = -1;
    for (let i = 0; i < this.times.length; i++) {
      const t = this.times[i]!;
      if (now - t <= KEEP_FINE_MS) {
        keep.push(i);
        continue;
      }
      const minute = Math.floor(t / 60000);
      if (minute !== lastMinute) {
        keep.push(i);
        lastMinute = minute;
      }
    }
    if (keep.length === this.times.length) return;
    this.times = keep.map((i) => this.times[i]!);
    for (const [k, arr] of this.data)
      this.data.set(
        k,
        keep.map((i) => arr[i]!),
      );
  }

  has(key: string): boolean {
    return this.data.has(key);
  }

  series(key: string, from: number, maxPoints = 400): Array<[number, number]> {
    const arr = this.data.get(key);
    if (!arr) return [];
    const start = lowerBound(this.times, from);
    const n = this.times.length - start;
    const step = Math.max(1, Math.ceil(n / maxPoints));
    const out: Array<[number, number]> = [];
    for (let i = start; i < this.times.length; i += step) {
      const v = arr[i]!;
      if (!Number.isNaN(v)) out.push([this.times[i]!, v]);
    }
    // always include the newest point
    const last = this.times.length - 1;
    if (last >= start && out.at(-1)?.[0] !== this.times[last])
      out.push([this.times[last]!, arr[last]!]);
    return out;
  }

  /** Value of `key` at time t, linearly interpolated. */
  at(key: string, t: number): number | undefined {
    const arr = this.data.get(key);
    if (!arr || this.times.length === 0) return undefined;
    const i = lowerBound(this.times, t);
    if (i === 0) return arr[0];
    if (i >= this.times.length) return arr.at(-1);
    const t0 = this.times[i - 1]!,
      t1 = this.times[i]!;
    const v0 = arr[i - 1]!,
      v1 = arr[i]!;
    return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0 || 1);
  }

  /** First time the (non-decreasing) series reached `value`, interpolated; undefined if before history. */
  timeOf(key: string, value: number): number | undefined {
    const arr = this.data.get(key);
    if (!arr || arr.length === 0 || value < arr[0]!) return undefined;
    let lo = 0,
      hi = arr.length - 1;
    if (value > arr[hi]!) return this.times[hi];
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid]! < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return this.times[0];
    const v0 = arr[lo - 1]!,
      v1 = arr[lo]!;
    const t0 = this.times[lo - 1]!,
      t1 = this.times[lo]!;
    return t0 + ((value - v0) * (t1 - t0)) / (v1 - v0 || 1);
  }

  get first(): number | undefined {
    return this.times[0];
  }
}

export function lowerBound(xs: number[], v: number): number {
  let lo = 0,
    hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
