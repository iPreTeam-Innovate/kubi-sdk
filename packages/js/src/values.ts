/**
 * Public constants. The ranges were confirmed on real devices.
 */
import type { Range } from './types.js';
import { RAW_SPEED_MAX, RAW_SPEED_MIN, rawToDegPerSec } from './protocol/index.js';

/** Range of motion of pan, in degrees. 0° faces forward; positive is to the right as seen by the person facing the device. */
export const panRange: Range = { min: -150, max: 150 };

/** Range of motion of tilt, in degrees. 0° is level; positive is upward. */
export const tiltRange: Range = { min: -20, max: 40 };

/** Accepted speed range, in degrees per second. Excludes `0`. Values in this range are accepted; reaching that speed is not guaranteed. */
export const speedRange: Range = { min: rawToDegPerSec(RAW_SPEED_MIN), max: rawToDegPerSec(RAW_SPEED_MAX) };

/** Default speed in degrees per second, the same for both axes. */
export const defaultSpeed = 60;

/** Clamp a value to a range. */
export function clampTo(v: number, r: Range): number {
  return Math.min(r.max, Math.max(r.min, v));
}
