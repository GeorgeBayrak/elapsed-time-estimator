import { test } from "node:test";
import assert from "node:assert/strict";

import { ElapsedTimeEstimator, defaultClock } from "../src/index.js";

/**
 * Build a fake clock backed by an array of pre-set times. Each call to the
 * returned function pops the next time (in seconds) from the front.
 *
 * Tests need deterministic control over the clock; this avoids any real time
 * access and makes the exact sequence of `t` values explicit.
 *
 * @param {number[]} times
 * @returns {() => number}
 */
function fakeClock(times) {
  const queue = [...times];
  return () => {
    if (queue.length === 0) throw new Error("fakeClock exhausted");
    return queue.shift();
  };
}

test("constructing with non-positive totalUnits throws RangeError", () => {
  assert.throws(() => new ElapsedTimeEstimator(0), RangeError);
  assert.throws(() => new ElapsedTimeEstimator(-5), RangeError);
  assert.throws(() => new ElapsedTimeEstimator(NaN), RangeError);
  assert.throws(() => new ElapsedTimeEstimator(Infinity), RangeError);
});

 test("constructing with a negative or non-integer windowSize throws RangeError", () => {
  assert.throws(() => new ElapsedTimeEstimator(100, { windowSize: -1 }), RangeError);
  assert.throws(() => new ElapsedTimeEstimator(100, { windowSize: 2.5 }), RangeError);
  assert.throws(() => new ElapsedTimeEstimator(100, { windowSize: NaN }), RangeError);
});

test("default clock is a function returning a finite positive number", () => {
  assert.equal(typeof defaultClock, "function");
  const t = defaultClock();
  assert.equal(typeof t, "number");
  assert.ok(Number.isFinite(t));
});

test("averageRate returns null before any samples are recorded", () => {
  const e = new ElapsedTimeEstimator(100, { clock: fakeClock([1]) });
  assert.equal(e.averageRate(), null);
});

test("averageRate returns null with only one sample", () => {
  const e = new ElapsedTimeEstimator(100, { clock: fakeClock([1]) });
  e.record(10);
  assert.equal(e.averageRate(), null);
});

test("estimateRemainingSeconds returns null before any samples are recorded", () => {
  const e = new ElapsedTimeEstimator(100, { clock: fakeClock([1]) });
  assert.equal(e.estimateRemainingSeconds(), null);
});

test("estimateRemainingSeconds returns null with only one sample", () => {
  const e = new ElapsedTimeEstimator(100, { clock: fakeClock([1]) });
  e.record(10);
  assert.equal(e.estimateRemainingSeconds(), null);
});

test("simple two-sample estimate divides remaining by average rate", () => {
  const clock = fakeClock([0, 10]);
  const e = new ElapsedTimeEstimator(100, { clock });
  e.record(10);
  e.record(20);
  // rate = (20 - 10) / (10 - 0) = 1 unit/sec; remaining = 80; eta = 80s.
  assert.equal(e.averageRate(), 1);
  assert.equal(e.estimateRemainingSeconds(), 80);
});

test("non-integer rates produce the expected ratio", () => {
  const clock = fakeClock([0, 4]);
  const e = new ElapsedTimeEstimator(100, { clock });
  e.record(0);
  e.record(10);
  // rate = 10 / 4 = 2.5 units/sec; remaining = 90; eta = 36s.
  assert.equal(e.averageRate(), 2.5);
  assert.equal(e.estimateRemainingSeconds(), 36);
});

test("completedUnits is zero before record() and equals the last sample after", () => {
  const clock = fakeClock([5, 7]);
  const e = new ElapsedTimeEstimator(100, { clock });
  assert.equal(e.completedUnits, 0);
  e.record(3);
  assert.equal(e.completedUnits, 3);
  e.record(7);
  assert.equal(e.completedUnits, 7);
});

test("lastSampleTime returns null before any sample and the last t after", () => {
  const clock = fakeClock([3, 8]);
  const e = new ElapsedTimeEstimator(100, { clock });
  assert.equal(e.lastSampleTime(), null);
  e.record(1);
  assert.equal(e.lastSampleTime(), 3);
  e.record(2);
  assert.equal(e.lastSampleTime(), 8);
});

test("sampleCount reflects the number of recorded samples", () => {
  const clock = fakeClock([0, 1, 2]);
  const e = new ElapsedTimeEstimator(100, { clock });
  assert.equal(e.sampleCount, 0);
  e.record(1);
  assert.equal(e.sampleCount, 1);
  e.record(2);
  assert.equal(e.sampleCount, 2);
});

test("a positive windowSize averages only the most recent samples", () => {
  // Three samples: lifetime avg uses (0,0) -> (20,20); window=2 uses (10,10) -> (20,20).
  const clock = fakeClock([0, 10, 20]);
  const e = new ElapsedTimeEstimator(100, { windowSize: 2, clock });
  e.record(0);
  e.record(10);
  e.record(20);
  assert.equal(e.averageRate(), 1); // (20-10)/(20-10) = 1
});

test("windowSize smaller than sample count still yields a usable rate", () => {
  // Four samples, window=2: only the last two contribute.
  const clock = fakeClock([0, 5, 10, 11]);
  const e = new ElapsedTimeEstimator(100, { windowSize: 2, clock });
  e.record(0);
  e.record(10);
  e.record(15);
  e.record(16);
  // window covers samples 3 and 4: (16-15)/(11-10) = 1 unit/sec; remaining = 84; eta = 84.
  assert.equal(e.averageRate(), 1);
  assert.equal(e.estimateRemainingSeconds(), 84);
});

test("two samples at the same time yield null rate (division by zero avoided)", () => {
  const clock = fakeClock([5, 5]);
  const e = new ElapsedTimeEstimator(100, { clock });
  e.record(10);
  e.record(20);
  assert.equal(e.averageRate(), null);
  assert.equal(e.estimateRemainingSeconds(), null);
});

test("completed task returns 0 remaining even if rate would be null", () => {
  const clock = fakeClock([5, 5]);
  const e = new ElapsedTimeEstimator(100, { clock });
  e.record(100);
  e.record(100);
  assert.equal(e.averageRate(), null);
  assert.equal(e.estimateRemainingSeconds(), 0);
});

test("record rejects NaN, negative, and non-finite units", () => {
  const e = new ElapsedTimeEstimator(100, { clock: fakeClock([0, 0, 0, 0]) });
  assert.throws(() => e.record(NaN), RangeError);
  assert.throws(() => e.record(-1), RangeError);
  assert.throws(() => e.record(Infinity), RangeError);
});

test("record rejects units exceeding totalUnits", () => {
  const e = new ElapsedTimeEstimator(100, { clock: fakeClock([0]) });
  assert.throws(() => e.record(101), RangeError);
});

test("record rejects regressions in completed units", () => {
  const e = new ElapsedTimeEstimator(100, { clock: fakeClock([0, 1]) });
  e.record(50);
  assert.throws(() => e.record(40), RangeError);
});

test("record rejects a clock that goes backwards", () => {
  const e = new ElapsedTimeEstimator(100, { clock: fakeClock([10, 5]) });
  e.record(10);
  assert.throws(() => e.record(20), RangeError);
});

test("zero rate from flat window yields Infinity remaining", () => {
  // Samples advance in time but not in units: rate = 0 -> eta = Infinity.
  const clock = fakeClock([0, 10]);
  const e = new ElapsedTimeEstimator(100, { clock });
  e.record(10);
  e.record(10);
  assert.equal(e.averageRate(), 0);
  assert.equal(e.estimateRemainingSeconds(), Infinity);
});
