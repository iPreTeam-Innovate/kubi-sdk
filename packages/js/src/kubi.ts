/**
 * Public surface. Argument validation (rejecting values that have no meaning) happens here before
 * handing off to the engine. Clamping (bringing meaningful values into range) happens in the engine
 * and shows up in diagnostics and in the `clamped` field of results.
 */
import { KubiEngine } from './engine/kubi-engine.js';
import type { KubiTransport } from './transport/types.js';
import type {
  BatteryStatus,
  BluetoothAvailability,
  ConnectResult,
  ConnectionChange,
  ConnectionState,
  DeviceInfo,
  DiagnosticEvent,
  KubiDevice,
  Observed,
  PanTilt,
  ServoFault,
} from './types.js';

function requireFinite(name: string, v: number | undefined): void {
  if (v === undefined) return;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new RangeError(`${name} must be a finite number (received ${String(v)})`);
  }
}

/** Operations that return a Promise report synchronous exceptions as rejections too, so `.catch` sees everything. */
function asPromise<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return fn();
  } catch (e) {
    return Promise.reject(e);
  }
}

function requirePositive(name: string, v: number | undefined): void {
  requireFinite(name, v);
  if (v !== undefined && v <= 0) {
    throw new RangeError(`${name} must be a positive number (received ${String(v)})`);
  }
}

/**
 * Entry point for controlling one Kubi.
 *
 * ```ts
 * const kubi = Kubi.forBrowser();
 * button.onclick = async () => {
 *   const r = await kubi.connect();            // inside the click handler, before any other await
 *   if (r.type !== 'connected') return;
 *   await kubi.writePanSpeed(30);               // used from the next goal write
 *   await kubi.writePanGoal(45);                // resolves once written; does not wait for the motion
 *   const pan = await kubi.readPan();           // one round trip
 *   console.log(pan.value, pan.observedAt);
 * };
 * ```
 */
export class Kubi {
  private readonly engine: KubiEngine;

  /** Build on a custom transport (tests, future non-browser transports). */
  constructor(transport: KubiTransport) {
    this.engine = new KubiEngine(transport);
  }

  /** Build on Web Bluetooth. Works only in a browser. */
  static forBrowser(): Kubi {
    // The transport is injected statically from index.ts; a dynamic import would be awkward for users' bundlers.
    const make = browserTransportFactory;
    if (make === null) throw new Error('No Web Bluetooth transport is registered. Import Kubi from the package entry point.');
    return new Kubi(make());
  }

  // --- connection ---
  /** Capabilities of the transport. Branch on these rather than on platform names. */
  get capabilities(): { providesDevicePicker: boolean; canScan: boolean } {
    return this.engine.capabilities;
  }
  /** Connection state. The speed settings have been written to the device by the time it is `connected`. */
  get connectionState(): ConnectionState {
    return this.engine.connectionState;
  }
  /** The connected device. `null` while `disconnected`. */
  get device(): KubiDevice | null {
    return this.engine.device;
  }
  /** Whether Bluetooth can be used. Trust `unavailable` only when it is reported. */
  get bluetoothAvailability(): BluetoothAvailability {
    return this.engine.bluetoothAvailability;
  }
  /** Subscribe to connection state changes. Fires only on change. Returns an unsubscribe function. */
  onConnectionChange(cb: (c: ConnectionChange) => void): () => void {
    return this.engine.onConnectionChange(cb);
  }
  /** Subscribe to Bluetooth availability changes. Can fire while disconnected. Returns an unsubscribe function. */
  onBluetoothAvailabilityChange(cb: (a: BluetoothAvailability) => void): () => void {
    return this.engine.onBluetoothAvailabilityChange(cb);
  }
  /**
   * Open the transport's device picker, let the end user choose one device, and connect to it.
   * **Call this inside a user gesture handler (such as a click), before any other `await`.**
   * Failure is a result value: not selected / could not connect / a connect is in progress / already connected.
   */
  connect(): Promise<ConnectResult> {
    return asPromise(() => this.engine.connect());
  }
  /** Disconnect. Reversible and idempotent. Subscriptions stay in place. */
  disconnect(): Promise<void> {
    return asPromise(() => this.engine.disconnect());
  }
  /** Release this instance. Irreversible. Closes the link and ends all subscriptions. Later calls throw `KubiDisposedError`. */
  dispose(): Promise<void> {
    return this.engine.dispose();
  }

  // --- servo (basic API) ---
  /**
   * Write the pan goal angle in degrees: one write to the device, resolved once it is written.
   * Does not wait for motion and does not start reading positions; read the position yourself with `readPan`.
   * Angles outside the range of motion are clamped.
   */
  writePanGoal(deg: number): Promise<void> {
    return asPromise(() => {
      requireFinite('pan', deg);
      return this.engine.writeGoal('pan', deg);
    });
  }
  /** Write the tilt goal angle in degrees. Same behavior as `writePanGoal`, for tilt. */
  writeTiltGoal(deg: number): Promise<void> {
    return asPromise(() => {
      requireFinite('tilt', deg);
      return this.engine.writeGoal('tilt', deg);
    });
  }
  /**
   * Write the pan speed in degrees per second (positive, finite): one write to the device, resolved once it is written.
   * Becomes the pan speed setting. The device starts using it at the next goal write; this call does not rewrite the goal.
   */
  writePanSpeed(degPerSec: number): Promise<void> {
    return asPromise(() => {
      requirePositive('pan speed', degPerSec);
      return this.engine.writeSpeed('pan', degPerSec);
    });
  }
  /** Write the tilt speed in degrees per second. Same behavior as `writePanSpeed`, for tilt. */
  writeTiltSpeed(degPerSec: number): Promise<void> {
    return asPromise(() => {
      requirePositive('tilt speed', degPerSec);
      return this.engine.writeSpeed('tilt', degPerSec);
    });
  }
  /**
   * Read the present pan position from the device: one round trip (request, then response), one axis.
   * Resolves with the measured value and its time. Rejects with `KubiError` on failure.
   */
  readPan(): Promise<Observed> {
    return asPromise(() => this.engine.readAxis('pan'));
  }
  /** Read the present tilt position from the device. Same behavior as `readPan`, for tilt. */
  readTilt(): Promise<Observed> {
    return asPromise(() => this.engine.readAxis('tilt'));
  }

  // --- speed ---
  /** The speed setting of each axis in degrees per second: the last value written with `writePanSpeed` / `writeTiltSpeed` (or the default). Not read from the device. */
  get speed(): PanTilt<number> {
    return this.engine.speed;
  }

  // --- status / device-info ---
  /** Read the battery voltage in millivolts. Involves a round trip. No percentage is derived. */
  readBatteryVoltage(): Promise<number> {
    return asPromise(() => this.engine.readBatteryVoltage());
  }
  /** Battery status (charging, low). `null` while there is no link. */
  get batteryStatus(): BatteryStatus | null {
    return this.engine.batteryStatus;
  }
  /** Subscribe to battery status changes. Fires only on change (for example when USB is plugged or unplugged). Returns an unsubscribe function. */
  onBatteryStatusChange(cb: (s: BatteryStatus) => void): () => void {
    return this.engine.onBatteryStatusChange(cb);
  }
  /** Subscribe to servo faults reported by the device (kind and axis). There is no operation to clear them; whether to stop is up to the app. */
  onServoFault(cb: (e: ServoFault) => void): () => void {
    return this.engine.onServoFault(cb);
  }
  /** Whether the device button is pressed. `null` while there is no link. */
  get buttonPressed(): boolean | null {
    return this.engine.buttonPressed;
  }
  /** Subscribe to button changes: `true` on press, `false` on release. No long-press interpretation. Returns an unsubscribe function. */
  onButtonChange(cb: (pressed: boolean) => void): () => void {
    return this.engine.onButtonChange(cb);
  }
  /** Read Device Information (serial number, model, manufacturer, hardware and firmware revisions). Missing fields are `null`. */
  readDeviceInfo(): Promise<DeviceInfo> {
    return asPromise(() => this.engine.readDeviceInfo());
  }

  // --- diagnostics ---
  /** Subscribe to raw communication and clamping events. Nothing is produced without a subscriber. Only record what you receive; do not act on it. */
  onDiagnostic(cb: (e: DiagnosticEvent) => void): () => void {
    return this.engine.onDiagnostic(cb);
  }
}

/** index.ts registers the Web Bluetooth transport here, because the engine and this file know nothing about the DOM. */
let browserTransportFactory: (() => KubiTransport) | null = null;

/** @internal */
export function registerBrowserTransport(factory: () => KubiTransport): void {
  browserTransportFactory = factory;
}
