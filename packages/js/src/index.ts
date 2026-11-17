/**
 * kubi-sdk entry point. Only what is exported here is visible to users.
 */
import { Kubi, registerBrowserTransport } from './kubi.js';
import { WebBluetoothTransport } from './transport/web-bluetooth.js';

registerBrowserTransport(() => new WebBluetoothTransport());

export { Kubi };
export { KubiError, KubiDisposedError, KubiUnsupportedError } from './errors.js';
export { panRange, tiltRange, speedRange, defaultSpeed } from './values.js';
export { Observed } from './types.js';
export type {
  Axis,
  BatteryStatus,
  BluetoothAvailability,
  ConnectResult,
  ConnectionChange,
  ConnectionState,
  DeviceInfo,
  DiagnosticEvent,
  DisconnectCause,
  KubiDevice,
  PanTilt,
  Range,
  ServoFault,
  WritePurpose,
} from './types.js';
export type { KubiTransport, KubiLink, TransportCapabilities, PickResult, PickFailure } from './transport/types.js';
export { TransportError } from './transport/types.js';
