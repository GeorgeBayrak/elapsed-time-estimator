/**
 * Core implementation of the elapsed-time estimator.
 *
 * The model is intentionally simple: the average rate of progress is taken as
 * completedUnits / elapsedSeconds, with an optional sliding window that only
 * considers the most recent samples. This gives an estimate that tracks the
 * current rate better than a full lifetime average while remaining far more
 * stable than a last-sample delta.
 *
 * Time is obtained through an injected clock function so that tests can be
 * fully deterministic. No wall-clock access happens inside this module.
 */

/**
 * A function that returns the current time in seconds. Injected so tests
 * never touch the real clock.
 *
 * @typedef {() => number} ClockFn
 */

/**
 * A single progress sample.
 *
 * @typedef {Object} Sample
 * @property {number} t       Time in seconds at which the sample was taken.
 * @property {number} units   Number of units completed at time `t`.
 */

/**
 * Default clock: epoch milliseconds from `Date.now` divided by 1000.
 * Kept here rather than inlined so the type is obvious and overridable.
 *
 * @type {ClockFn}
 */
export function defaultClock() {
  return Date.now() / 1000;
}

/**
 * ElapsedTimeEstimator estimates remaining time for a task of a known total
 * size by tracking completed units over time and averaging the observed rate.
 *
 * The window size controls how many recent samples contribute to the average
 * rate. A window of 0 (the default) means "use every sample ever recorded" —
 * i.e. the lifetime average. This is the most stable choice but lags behind
 * genuine rate changes. A positive window trades stability for responsiveness.
 */
export class ElapsedTimeEstimator {
  /** @type {Sample[]} */
  #samples = [];
  /** @type {number} */
  #totalUnits;
  /** @type {number} */
  #windowSize;
  /** @type {ClockFn} */
  #clock;

 /**
  * @param {number} totalUnits      Total units the task comprises. Must be finite and > 0.
  * @param {Object}  [opts]
  * @param {number}  [opts.windowSize=0] Number of most recent samples to average over.
  *                                      0 means "all samples" (lifetime average).
  * @param {ClockFn} [opts.clock=defaultClock] Time source in seconds.
  */
  constructor(totalUnits, opts = {}) {
    if (!Number.isFinite(totalUnits) || totalUnits <= 0) {
      throw new RangeError("totalUnits must be a finite, positive number");
    }
    const windowSize = opts.windowSize ?? 0;
    if (!Number.isFinite(windowSize) || windowSize < 0 || !Number.isInteger(windowSize)) {
      throw new RangeError("windowSize must be a non-negative integer or 0");
    }
    this.#totalUnits = totalUnits;
    this.#windowSize = windowSize;
    this.#clock = opts.clock ?? defaultClock;
  }

  /**
   * Record that `units` total work has been completed at the current clock time.
   *
   * Units must be monotonically non-decreasing between calls. We deliberately
   * reject regressions rather than silently clamping: a regression almost
   * always indicates a caller bug (e.g. double-counting after a retry), and a
   * silent clamp would produce silently wrong estimates that are hard to debug.
   *
   * We also reject `NaN`/`Infinity` and values beyond `totalUnits` for the same
   * reason: the estimator's contract is that progress advances toward a fixed
   * total, and anything outside that contract is a bug worth surfacing.
   *
   * @param {number} units Total units completed so far (not a delta).
   * @returns {void}
   */
  record(units) {
    if (!Number.isFinite(units) || units < 0) {
      throw new RangeError("units must be a finite, non-negative number");
    }
    if (units > this.#totalUnits) {
      throw new RangeError(`units (${units}) cannot exceed totalUnits (${this.#totalUnits})`);
    }
    const last = this.#samples[this.#samples.length - 1];
    if (last && units < last.units) {
      throw new RangeError(`units (${units}) cannot regress below previous sample (${last.units})`);
    }
    const t = this.#clock();
    if (last && t < last.t) {
      // Non-monotonic clock would divide by a negative or zero delta and
      // produce nonsensical rates. Surface it rather than emit garbage.
      throw new RangeError(`clock (${t}) went backwards below previous sample (${last.t})`);
    }
    this.#samples.push({ t, units });
  }

  /**
   * Number of samples currently stored. Bounded by `windowSize` when > 0.
   * @returns {number}
   */
  get sampleCount() {
    return this.#samples.length;
  }

  /**
   * Units completed so far, or 0 if no samples have been recorded.
   @returns {number}
   */
  get completedUnits() {
    if (this.#samples.length === 0) return 0;
    return this.#samples[this.#samples.length - 1].units;
  }

  /**
   * The most recent time sample, or `null` before any record() call.
   * Exposed for diagnostics; not used by estimateRemainingSeconds itself.
   *
   * @returns {number|null}
   */
  lastSampleTime() {
    if (this.#samples.length === 0) return null;
    return this.#samples[this.#samples.length - 1].t;
  }

  /**
   * Compute the average rate of progress (units/second) over the active window.
   *
   * Returns `null` when the rate cannot be computed: either there are fewer
   * than two samples (no span to average over), or the time span between the
   * window's first and last sample is exactly zero (division by zero).
   *
   * @returns {number|null}
   */
  averageRate() {
    if (this.#samples.length < 2) return null;
    const start = this.#windowSize > 0 && this.#samples.length >= this.#windowSize
      ? this.#samples[this.#samples.length - this.#windowSize]
      : this.#samples[0];
    const end = this.#samples[this.#samples.length - 1];
    const dt = end.t - start.t;
    const du = end.units - start.units;
    if (dt === 0) return null;
    return du / dt;
  }

  /**
   * Estimate seconds remaining until `totalUnits` is reached, based on the
   * current average rate over the active window.
   *
   * Returns:
   *   - `null`   if the rate is unavailable (see averageRate).
   *   - `0`      if the task is already complete (no work left).
   *   - `Infinity` if the rate is non-positive (stalled or backward progress
   *     within the window), because the task can never complete at that rate.
   *
   * Returning `Infinity` for a stalled task is deliberate: it lets callers
   * distinguish "still progressing" from "not progressing" without a separate
   * status enum, and it composes correctly with min/max reductions.
   *
   * @returns {number|null}
   */
  estimateRemainingSeconds() {
    const remaining = this.#totalUnits - this.completedUnits;
    if (remaining <= 0) return 0;
    const rate = this.averageRate();
    if (rate === null) return null;
    if (rate <= 0) return Infinity;
    return remaining / rate;
  }
}
