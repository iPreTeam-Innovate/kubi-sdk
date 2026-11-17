/**
 * Public types. They never touch the DOM or any transport API.
 * Angles are in degrees (0° = facing forward; pan is positive to the right as seen by the person
 * facing the device; tilt is positive upward). Speeds are in degrees per second.
 */

/** An axis. `pan` turns left/right, `tilt` turns up/down. */
export type Axis = 'pan' | 'tilt';

/** A pair of values, one per axis. */
export interface PanTilt<T> {
  readonly pan: T;
  readonly tilt: T;
}

/** An inclusive lower and upper bound. */
export interface Range {
  readonly min: number;
  readonly max: number;
}

/** Values for one or both axes. An omitted axis is left untouched. */
export interface AxisValues {
  pan?: number;
  tilt?: number;
}

// ---------------------------------------------------------------------------
// observation
// ---------------------------------------------------------------------------

/**
 * A measured value together with the time it was measured. Present positions are always
 * reported in this form. `ageMs` is computed on read, so it keeps growing while you hold the object.
 */
export class Observed {
  constructor(
    /** The measured value in degrees, within the published range. */
    readonly value: number,
    /** When the measurement was taken. */
    readonly observedAt: Date,
  ) {}

  /** Milliseconds elapsed since the measurement. */
  get ageMs(): number {
    return Date.now() - this.observedAt.getTime();
  }
}

/**
 * Motion state of one axis.
 * - `idle`     no active declaration, present is known (the axis is judged to be at rest)
 * - `moving`   a move declaration is active and the axis has not yet been judged at rest
 * - `driving`  a drive declaration is active
 * - `staying` a `stay` declaration is active and the axis has not yet been judged at rest
 * - `unknown`  no active declaration and present is unknown (nothing to judge from)
 */
export type AxisMotion = 'idle' | 'moving' | 'driving' | 'staying' | 'unknown';

/** Observation of one axis. */
export interface AxisSnapshot {
  /** The goal of the active declaration, after clamping and quantization. `null` when nothing is declared. */
  readonly goal: number | null;
  /** The latest measurement. `null` when unknown. */
  readonly present: Observed | null;
  readonly motion: AxisMotion;
  /** The speed setting in degrees per second, after a round trip through quantization. */
  readonly speed: number;
}

/** One observation of both axes. Delivered to subscribers only when its contents change. */
export class Snapshot {
  constructor(
    readonly pan: AxisSnapshot,
    readonly tilt: AxisSnapshot,
  ) {}

  /** Whether goal, present value, motion and speed are equal, ignoring measurement times. */
  hasSameValues(other: Snapshot): boolean {
    const same = (a: AxisSnapshot, b: AxisSnapshot): boolean =>
      a.goal === b.goal &&
      (a.present?.value ?? null) === (b.present?.value ?? null) &&
      a.motion === b.motion &&
      a.speed === b.speed;
    return same(this.pan, other.pan) && same(this.tilt, other.tilt);
  }

  /** Whether everything, including measurement times, is equal. Used to decide whether to deliver. */
  equals(other: Snapshot): boolean {
    const same = (a: AxisSnapshot, b: AxisSnapshot): boolean =>
      a.goal === b.goal &&
      a.motion === b.motion &&
      a.speed === b.speed &&
      (a.present?.value ?? null) === (b.present?.value ?? null) &&
      (a.present?.observedAt.getTime() ?? null) === (b.present?.observedAt.getTime() ?? null);
    return same(this.pan, other.pan) && same(this.tilt, other.tilt);
  }
}

// ---------------------------------------------------------------------------
// move / drive / stop
// ---------------------------------------------------------------------------

/** Options for `moveTo` / `moveBy`. */
export interface MoveOptions {
  /** Adjust per-axis speeds so both axes arrive at about the same time (a straight diagonal). The speed setting is not changed. */
  together?: boolean;
}

/**
 * Result of a move.
 * - `settled`   motion stopped. Carries the goal that was used and the measured position (arrival is not judged)
 * - `cancelled` replaced by another declaration (`superseded`, still moving) or interrupted by `stay` (`stayed`, will come to rest)
 * - `rejected`  not started because a precondition failed: a relative move was called while a declaration was active
 *   (`declarationActive`), or while an axis was last driven by a basic-API goal write and its motion is `unknown` (`motionUnknown`)
 * `clamped` tells whether any requested angle was outside the range of motion and was clamped to it.
 */
export type MoveResult =
  | {
      readonly type: 'settled';
      readonly goal: Readonly<AxisValues>;
      readonly present: { readonly pan?: Observed; readonly tilt?: Observed };
      readonly clamped: boolean;
    }
  | { readonly type: 'cancelled'; readonly by: 'superseded' | 'stayed'; readonly clamped: boolean }
  | { readonly type: 'rejected'; readonly reason: 'declarationActive' | 'motionUnknown' };

/** Result of `stay`. `stayed` = came to rest and is holding / `superseded` = overtaken by another declaration before completing. */
export type StayResult = 'stayed' | 'superseded';

/** Pan direction for `drive`, as seen by the person facing the device (`right` is the positive side of `panRange`). */
export type PanDirection = 'left' | 'right';
/** Tilt direction for `drive`. `up` is the positive side of `tiltRange`. */
export type TiltDirection = 'up' | 'down';

/**
 * Argument of `drive`. Give a direction per axis; an omitted axis is left alone. The speed is the current speed setting
 * (`writePanSpeed` / `writeTiltSpeed`); `drive` does not take a speed. Interrupt it with `stay()`.
 * When a destination (`panTo` / `tiltTo`) is omitted, the end of the range of motion in that direction is used.
 * `observe: false` suspends position observation for the duration of this declaration (no halt notification will fire).
 */
export interface DriveOptions {
  pan?: PanDirection;
  tilt?: TiltDirection;
  panTo?: number;
  tiltTo?: number;
  observe?: boolean;
}

/** Notification that an axis stopped advancing in the direction it was driven. The library does not tell arrival from being blocked short of it. */
export interface DriveHalt {
  readonly axis: Axis;
  /** The destination of that drive, after clamping and quantization. */
  readonly destination: number;
  /** The measured position where it stopped. */
  readonly present: Observed;
}

// ---------------------------------------------------------------------------
// connection
// ---------------------------------------------------------------------------

/** Connection state. Initial synchronization is complete once the state is `connected`. */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

/** Why the state became `disconnected`. Describes only what happened to your own operation. */
export type DisconnectCause = 'byApp' | 'connectFailed' | 'linkLost';

/** A change of connection state. */
export type ConnectionChange =
  | { readonly state: 'connecting' }
  | { readonly state: 'connected' }
  | { readonly state: 'disconnected'; readonly cause: DisconnectCause };

/** Whether Bluetooth can be used. Trust `unavailable` only when it is reported. */
export type BluetoothAvailability = 'available' | 'unavailable' | 'unknown';

/** The connected device. `id` is opaque and stable only within the same app and environment. `name` is for display and may be absent. */
export interface KubiDevice {
  readonly id: string;
  readonly name: string | null;
}

/** Result of a connect operation. Failure is a result value, not an exception. */
export type ConnectResult =
  | { readonly type: 'connected' }
  | {
      readonly type: 'notConnected';
      readonly reason: 'notSelected' | 'couldNotConnect' | 'connectionInProgress' | 'alreadyConnected';
    };

// ---------------------------------------------------------------------------
// status / device-info
// ---------------------------------------------------------------------------

/** Battery status. The device's "critical" bit is not exposed because its meaning is not confirmed. */
export interface BatteryStatus {
  readonly charging: boolean;
  readonly low: boolean;
}

/** A servo fault reported by the device (not an exception). Combines the fault kind and the axis it was reported for. */
export interface ServoFault {
  readonly axis: Axis | null;
  readonly inputVoltage: boolean;
  readonly overheating: boolean;
  readonly electricalShock: boolean;
  readonly overload: boolean;
  /** When the notification was received. */
  readonly at: Date;
}

/** Device Information. Fields the device does not provide are `null`. The serial number identifies the individual unit. */
export interface DeviceInfo {
  readonly serialNumber: string | null;
  readonly modelNumber: string | null;
  readonly manufacturer: string | null;
  readonly hardwareRevision: string | null;
  readonly firmwareRevision: string | null;
}

// ---------------------------------------------------------------------------
// diagnostics
// ---------------------------------------------------------------------------

/** What a write is for. */
export type WritePurpose = 'goal' | 'speed' | 'brake' | 'hold' | 'readRequest' | 'notifyEnable';

/** Raw diagnostic data. Not produced unless someone is subscribed. */
export type DiagnosticEvent =
  | {
      readonly type: 'write';
      readonly purpose: WritePurpose;
      readonly axis: Axis | null;
      readonly characteristic: string;
      readonly bytes: Uint8Array;
      readonly at: Date;
      readonly ok: boolean;
    }
  | { readonly type: 'frame'; readonly characteristic: string; readonly bytes: Uint8Array; readonly at: Date }
  | { readonly type: 'read'; readonly characteristic: string; readonly bytes: Uint8Array | null; readonly at: Date }
  | {
      readonly type: 'clamped';
      readonly what: 'angle' | 'speed';
      readonly axis: Axis;
      readonly requested: number;
      readonly applied: number;
      readonly at: Date;
    }
  | { readonly type: 'note'; readonly message: string; readonly at: Date };
