/**
 * Public entry point for the elapsed-time-estimator library.
 *
 * Re-exports everything consumers should need. Keeping a barrel file lets
 * downstream code do `import { ElapsedTimeEstimator } from '...'` without
 * knowing about the internal module layout.
 */
export { ElapsedTimeEstimator, defaultClock } from "./core.js";
