/**
 * Transport boundary. Only transport implementations may touch a transport API such as Web Bluetooth.
 * The engine sees nothing but these interfaces.
 */
import type { Characteristic } from '../protocol/index.js';

/** What the transport can do. */
export interface TransportCapabilities {
  /** Whether the transport can show its own device picker UI. */
  readonly providesDevicePicker: boolean;
  /** Whether the transport can enumerate nearby devices. Always `false` for Web Bluetooth in this version. */
  readonly canScan: boolean;
}

/** Whether Bluetooth can be used. */
export type BluetoothAvailability = 'available' | 'unavailable' | 'unknown';

/** The connected device. The identifier is opaque; the name is for display and may be absent. */
export interface KubiDevice {
  readonly id: string;
  readonly name: string | null;
}

/** Failure returned by `pick()`. Mapped onto the connect operation's result value. */
export type PickFailure =
  /** The end user chose nothing in the picker. */
  | 'notSelected'
  /** A device was chosen but could not be connected (out of range, powered off, required characteristics missing). */
  | 'couldNotConnect';

/** Result of `pick()`. */
export type PickResult = { readonly ok: true; readonly link: KubiLink } | { readonly ok: false; readonly reason: PickFailure; readonly detail?: string };

/** A transport. One per Kubi instance, for its whole lifetime. */
export interface KubiTransport {
  readonly capabilities: TransportCapabilities;
  /** Current availability. Synchronous, no communication, never throws. */
  readonly availability: BluetoothAvailability;
  /** Subscribe to availability changes. Called only on change. Returns an unsubscribe function. */
  onAvailabilityChange(cb: (a: BluetoothAvailability) => void): () => void;
  /**
   * Open the picker, let the end user choose one device, and establish a link. **The picker must open before the
   * first asynchronous step**, or the user-gesture context is lost. Includes checking for the required characteristics.
   */
  pick(): Promise<PickResult>;
}

/** One link, from establishment until it is closed or lost. */
export interface KubiLink {
  readonly device: KubiDevice;
  /** Whether the device has this characteristic (some units lack the Status and Device Information services). */
  has(c: Characteristic): boolean;
  /** Write with response. Never issuing two writes at once is the engine's responsibility. Rejects on failure. */
  write(c: Characteristic, bytes: Uint8Array): Promise<void>;
  /** Read. Rejects if the characteristic is absent. */
  read(c: Characteristic): Promise<Uint8Array>;
  /** Enable notifications and subscribe. Returns an unsubscribe function. */
  subscribe(c: Characteristic, cb: (bytes: Uint8Array) => void): Promise<() => void>;
  /** Called when the link is lost, including when `close()` closes it. Returns an unsubscribe function. */
  onDisconnected(cb: () => void): () => void;
  /** Close. Idempotent. */
  close(): Promise<void>;
  /** Whether the link is already closed. */
  readonly isClosed: boolean;
}

/** A transport-level failure. The engine wraps it in `KubiError`. */
export class TransportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TransportError';
  }
}
