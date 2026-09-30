# elapsed-time-estimator

Estimate the remaining time for a task of known size by averaging the observed rate of progress over completed units, with an optional sliding window.

## Usage

```js
import { ElapsedTimeEstimator, defaultClock } from "elapsed-time-estimator";

const e = new ElapsedTimeEstimator(1000, { windowSize: 5, clock: defaultClock });
e.record(100);  // 100 units done now
e.record(250);  // 250 units done now

const remaining = e.estimateRemainingSeconds(); // number | null
```

Exports:
- `ElapsedTimeEstimator` — the estimator class.
- `defaultClock` — a `() => number` returning `Date.now() / 1000`. Override via the `clock` option for deterministic tests.

Constructor: `new ElapsedTimeEstimator(totalUnits, { windowSize = 0, clock = defaultClock })`.
- `totalUnits` must be a finite positive number.
- `windowSize` is a non-negative integer. `0` means "use every sample ever recorded" (lifetime average). Positive `N` means "average over the most recent `N` samples".

Methods:
- `record(units)` — record that `units` total work has completed at the current clock time. `units` is cumulative, not a delta. Must be `>= 0`, `<= totalUnits`, and `>=` the previous sample's value.
- `averageRate()` — units/second over the active window, or `null` if the rate cannot be computed (fewer than two samples, or zero elapsed time in the window).
- `estimateRemainingSeconds()` — seconds until `totalUnits` is reached. Returns `0` when complete, `null` when the rate is unavailable, and `Infinity` when the rate is non-positive (the task is stalled and cannot finish).
- `sampleCount`, `completedUnits` — read-only accessors.
- `lastSampleTime()` — the most recent sample's time, or `null` before any `record()` call.

## Why this exists

Progress-bar ETAs are notoriously jittery because they are usually computed from the last two samples. This library takes the deliberately boring route: the average rate over either the entire history or a fixed recent window. That trades responsiveness for stability — the estimate will not jump around when one sample is slow, but it will also lag behind genuine rate changes. For most user-facing progress displays that is the right trade-off.

## Edge cases

- **Fewer than two samples** — no rate is available. `averageRate()` and `estimateRemainingSeconds()` return `null` rather than `0`; the caller decides how to render "unknown". The exception is when the task is already complete (`completedUnits >= totalUnits`), in which case `estimateRemainingSeconds()` returns `0` regardless of rate.
- **Zero elapsed time within the window** — two samples with the same timestamp produce a division-by-zero. `averageRate()` returns `null` and the estimate stays `null`.
- **Stalled progress** — if units do not advance across the window the rate is `0` and `estimateRemainingSeconds()` returns `Infinity`. This is deliberate so callers can distinguish "still going" from "stuck" without a separate status field.
- **Regressions** — `record()` rejects `units` lower than the previous sample, `units` beyond `totalUnits`, non-finite `units`, and a clock that goes backwards. These are surfaced as `RangeError` rather than silently clamped, because a regression almost always indicates a caller bug and a silent clamp would produce silently wrong estimates.
- **Injectable clock** — pass `{ clock: () => seconds }` to make behaviour deterministic in tests. `defaultClock` returns `Date.now() / 1000`.
