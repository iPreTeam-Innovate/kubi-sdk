# kubi-sdk API reference

Everything exported from `kubi-sdk`, one entry per member. Every entry has the same parts: what it does, its parameters, what it returns, short examples that show the result, and how it fails. For the ideas behind the API, read the [guide](./guide.md).

[日本語版](./api.ja.md)

## Setup

Every example on this page assumes this code has already run. It is not repeated.

```js
import { Kubi } from 'kubi-sdk';

const kubi = Kubi.forBrowser();
connectButton.onclick = () => kubi.connect();   // must be called from a click
```

The values shown in comments (device name, serial number, voltage) come from one device. Yours will differ.

## Conventions

- **Units.** Angles are in degrees, speeds in degrees per second. `pan` is positive to the right as seen by the person facing the device, `tilt` is positive upward, and 0° is the front / level.
- **One call, one operation.** Each `write…` / `read…` method under [Servo](#servo-basic-api) performs exactly one operation on the device. The library never talks to the device unless you call something. Methods that wait for the neck to stop are planned for a later release.
- **Subscribe methods** (`onXxx(callback)`) return a function that unsubscribes. Callbacks are invoked asynchronously, and an exception inside a callback never affects the library. Subscriptions survive a lost link and end only on `dispose()`.
- **"Communicates: yes"** marks a method that sends something over Bluetooth and can reject with `KubiError`. Everything else is local.
- **Bad arguments** (not a finite number, a speed of 0 or below) reject with `RangeError`. Angles outside the range of motion are **clamped**, never rejected.

## Kubi

One `Kubi` instance controls one device. Create it once and keep it for the life of the page.

### Kubi.forBrowser()

Creates an instance that uses Web Bluetooth.

- **Parameters**: none
- **Returns**: `Kubi`
- **Communicates**: no
- **Fails with**: `Error` when `Kubi` was imported from somewhere other than the package entry point

A new instance is not connected yet.

```js
const kubi = Kubi.forBrowser();
console.log(kubi.connectionState);   // "disconnected"
```

### new Kubi(transport)

Creates an instance on a custom transport. For tests and for transports other than Web Bluetooth. Most applications use `Kubi.forBrowser()` instead.

| Parameter | Type | Description |
|---|---|---|
| `transport` | `KubiTransport` | Your implementation of the [transport interfaces](#transport-interfaces) |

- **Returns**: `Kubi`
- **Communicates**: no

The instance reports what your transport can do.

```js
const kubi = new Kubi(myTransport);
console.log(kubi.capabilities);   // { providesDevicePicker: true, canScan: false }
```

## Connection

### kubi.capabilities

What the transport can do. Branch on these rather than on platform names.

- **Type**: `{ providesDevicePicker: boolean, canScan: boolean }`
- **Communicates**: no

With Web Bluetooth the browser shows the device chooser, and scanning is not available.

```js
console.log(kubi.capabilities);   // { providesDevicePicker: true, canScan: false }
```

### kubi.connectionState

The current connection state.

- **Type**: `'disconnected' | 'connecting' | 'connected'`
- **Communicates**: no

It becomes `connected` when `connect()` has finished.

```js
console.log(kubi.connectionState);   // "disconnected"
await kubi.connect();
console.log(kubi.connectionState);   // "connected"
```

### kubi.device

The connected device.

- **Type**: `{ id: string, name: string | null }`, or `null` while disconnected
- **Communicates**: no

`name` is for display. `id` is opaque and stable only within the same app and browser.

```js
console.log(kubi.device);   // { id: "kubi-0001", name: "kubi000012AB01" }
await kubi.disconnect();
console.log(kubi.device);   // null
```

### kubi.bluetoothAvailability

Whether Bluetooth can be used right now.

- **Type**: `'available' | 'unavailable' | 'unknown'`
- **Communicates**: no

`unknown` means the browser did not say. Trust `unavailable` only when it is reported.

```js
console.log(kubi.bluetoothAvailability);   // "available"
```

### kubi.connect()

Opens the browser's device chooser, lets the user pick a Kubi, and connects to it.

- **Parameters**: none
- **Returns**: `Promise<ConnectResult>`. See [`ConnectResult`](#connectresult)
- **Communicates**: yes
- **Fails with**: `KubiUnsupportedError` when the transport has no device chooser. Every other failure is a result value, not an exception

Call it inside a click handler, before any other `await`. Otherwise the browser refuses to open the chooser.

```js
connectButton.onclick = async () => {
  const result = await kubi.connect();
  console.log(result);   // { type: "connected" }
};
```

When the user closes the chooser without picking a device, the Promise still resolves.

```js
const result = await kubi.connect();
console.log(result);   // { type: "notConnected", reason: "notSelected" }
```

| `result.type` | `result.reason` | Meaning |
|---|---|---|
| `'connected'` | — | Ready to use |
| `'notConnected'` | `'notSelected'` | The user closed the chooser, or it could not open |
| `'notConnected'` | `'couldNotConnect'` | The device was chosen but could not be connected |
| `'notConnected'` | `'connectionInProgress'` | Another `connect()` is still running |
| `'notConnected'` | `'alreadyConnected'` | Already connected. Call `disconnect()` first |

While connecting, the library writes the speed settings to the device, so `kubi.speed` is what the device will use.

### kubi.disconnect()

Closes the link.

- **Parameters**: none
- **Returns**: `Promise<void>`, resolved when the link is closed
- **Communicates**: no. It only closes the link
- **Fails with**: nothing. Safe to call while already disconnected

Subscriptions stay in place, so the same instance can `connect()` again.

```js
await kubi.disconnect();
console.log(kubi.connectionState);   // "disconnected"
```

### kubi.dispose()

Releases the instance: closes the link and ends every subscription. Irreversible.

- **Parameters**: none
- **Returns**: `Promise<void>`
- **Communicates**: no. It only closes the link

Call it when the page or component that owns the instance goes away. Every later call fails.

```js
await kubi.dispose();
await kubi.readPan();   // rejects with KubiDisposedError
```

### kubi.onConnectionChange(callback)

Subscribes to changes of `connectionState`.

| Parameter | Type | Description |
|---|---|---|
| `callback` | `(change) => void` | Receives a [`ConnectionChange`](#connectionchange) |

- **Returns**: a function that unsubscribes
- **Communicates**: no

Connecting and then disconnecting delivers three changes.

```js
kubi.onConnectionChange((change) => console.log(change));
await kubi.connect();
// { state: "connecting" }
// { state: "connected" }
await kubi.disconnect();
// { state: "disconnected", cause: "byApp" }
```

When the device is switched off or goes out of range, `cause` is `linkLost`. The library never reconnects on its own, so offer a button here.

```js
kubi.onConnectionChange((change) => {
  if (change.state === 'disconnected' && change.cause === 'linkLost') {
    reconnectButton.hidden = false;   // connect() needs a click
  }
});
```

Call the returned function to stop receiving changes.

```js
const unsubscribe = kubi.onConnectionChange((change) => console.log(change));
unsubscribe();   // nothing is logged after this
```

### kubi.onBluetoothAvailabilityChange(callback)

Subscribes to changes of `bluetoothAvailability`. Fires also while disconnected.

| Parameter | Type | Description |
|---|---|---|
| `callback` | `(availability) => void` | Receives `'available'`, `'unavailable'` or `'unknown'` |

- **Returns**: a function that unsubscribes
- **Communicates**: no

Use it to enable or disable your connect button.

```js
kubi.onBluetoothAvailabilityChange((availability) => console.log(availability));
// the user turns Bluetooth off
// "unavailable"
```

## Servo (basic API)

Six methods, each one operation on the device: write a goal, write a speed, or read a position, for one axis. They do not wait for the neck to move and do not read anything on their own. Calls are sent in the order you make them, one at a time, and none is dropped or merged.

### kubi.writePanGoal(degrees)

Writes the pan goal: the angle the neck turns to.

| Parameter | Type | Description |
|---|---|---|
| `degrees` | `number` | −150 to 150. Positive is to the right as seen by the person facing the device. Values outside are clamped |

- **Returns**: `Promise<void>`, resolved when the device has received the goal. It does not wait for the neck to arrive
- **Communicates**: yes, one write (about 130 ms)
- **Fails with**: `RangeError` for a value that is not a finite number; `KubiError` when not connected or the write fails

Write a goal, give the neck time to turn, then read where it is. Stopping about 1° short of the goal is normal.

```js
await kubi.writePanGoal(30);
await new Promise((resolve) => setTimeout(resolve, 2000));
const pan = await kubi.readPan();
console.log(pan.value.toFixed(1));   // "29.2"
```

An angle outside the range is written as the end of the range. The clamping shows up in the diagnostics.

```js
kubi.onDiagnostic((event) => {
  if (event.type === 'clamped') console.log(event.requested, event.applied);
});
await kubi.writePanGoal(200);   // logs: 200 150
```

Writing a new goal while the neck is moving simply replaces the old one. For a slider, see ["Following a slider" in the guide](./guide.md#1-the-basic-api).

### kubi.writeTiltGoal(degrees)

Writes the tilt goal: the angle the neck tilts to.

| Parameter | Type | Description |
|---|---|---|
| `degrees` | `number` | −20 to 40. Positive is upward. Values outside are clamped |

- **Returns**: `Promise<void>`, resolved when the device has received the goal. It does not wait for the neck to arrive
- **Communicates**: yes, one write (about 130 ms)
- **Fails with**: `RangeError` for a value that is not a finite number; `KubiError` when not connected or the write fails

Tilt 20° upward, then read where the neck is.

```js
await kubi.writeTiltGoal(20);
await new Promise((resolve) => setTimeout(resolve, 2000));
const tilt = await kubi.readTilt();
console.log(tilt.value.toFixed(1));   // "19.2"
```

An angle above the range is written as 40.

```js
kubi.onDiagnostic((event) => {
  if (event.type === 'clamped') console.log(event.requested, event.applied);
});
await kubi.writeTiltGoal(90);   // logs: 90 40
```

### kubi.writePanSpeed(degreesPerSecond)

Writes the pan speed. **The device starts using it at the next goal write.**

| Parameter | Type | Description |
|---|---|---|
| `degreesPerSecond` | `number` | About 0.67 to 104, greater than 0. Values outside are clamped |

- **Returns**: `Promise<void>`, resolved when the device has received the speed
- **Communicates**: yes, one write (about 130 ms)
- **Fails with**: `RangeError` for 0, a negative value or a value that is not a finite number; `KubiError` when not connected or the write fails

The value becomes the pan speed setting, rounded to the device's step. The next goal write uses it.

```js
await kubi.writePanSpeed(30);
console.log(kubi.speed.pan.toFixed(2));   // "29.97"
await kubi.writePanGoal(60);              // turns at about 30°/s
```

Writing a speed alone does not change how fast a moving neck turns. Write the same goal again to apply it.

```js
await kubi.writePanGoal(60);    // turning at the previous speed
await kubi.writePanSpeed(20);   // still turning at the previous speed
await kubi.writePanGoal(60);    // now turning at about 20°/s
```

A speed of 0 is rejected. There is no stop command; see ["Changing the goal while the neck is moving" in the guide](./guide.md#6-changing-the-goal-while-the-neck-is-moving).

```js
await kubi.writePanSpeed(0);   // rejects with RangeError
```

The setting is kept across reconnects and written to the device again during `connect()`.

### kubi.writeTiltSpeed(degreesPerSecond)

Writes the tilt speed. **The device starts using it at the next goal write.**

| Parameter | Type | Description |
|---|---|---|
| `degreesPerSecond` | `number` | About 0.67 to 104, greater than 0. Values outside are clamped |

- **Returns**: `Promise<void>`, resolved when the device has received the speed
- **Communicates**: yes, one write (about 130 ms)
- **Fails with**: `RangeError` for 0, a negative value or a value that is not a finite number; `KubiError` when not connected or the write fails

The value becomes the tilt speed setting. The next tilt goal write uses it.

```js
await kubi.writeTiltSpeed(20);
console.log(kubi.speed.tilt.toFixed(2));   // "19.98"
await kubi.writeTiltGoal(30);              // tilts at about 20°/s
```

### kubi.readPan()

Reads the present pan position from the device.

- **Parameters**: none
- **Returns**: `Promise<Observed>`. See [`Observed`](#observed)
- **Communicates**: yes, one request and one response (about 130 to 260 ms)
- **Fails with**: `KubiError` when not connected, when the link drops, or when the device does not answer

The result carries the angle, when it was measured, and how old the measurement is.

```js
const pan = await kubi.readPan();
console.log(pan.value.toFixed(1));   // "29.2"
console.log(pan.observedAt);         // a Date: when it was measured
console.log(pan.ageMs);              // 0, and grows as time passes
```

Without a connection it rejects.

```js
try {
  await kubi.readPan();
} catch (error) {
  console.log(error.code);   // "noLink"
}
```

The device never reports its position on its own. This call (and `readTilt()`) is the only way to learn where the neck is.

### kubi.readTilt()

Reads the present tilt position from the device.

- **Parameters**: none
- **Returns**: `Promise<Observed>`. See [`Observed`](#observed)
- **Communicates**: yes, one request and one response (about 130 to 260 ms)
- **Fails with**: `KubiError` when not connected, when the link drops, or when the device does not answer

The device answers one axis per request, so read the two axes one after the other.

```js
const pan = await kubi.readPan();
const tilt = await kubi.readTilt();
console.log(pan.value.toFixed(1), tilt.value.toFixed(1));   // "29.2" "19.2"
```

The two values are measured at different times. There is no method that reads both at once.

## Speed

### kubi.speed

The speed setting of each axis: the last value written with `writePanSpeed` / `writeTiltSpeed`, rounded to the device's step.

- **Type**: `{ pan: number, tilt: number }`, in degrees per second
- **Communicates**: no. It is not read from the device, because the device would only return the value you wrote

Before anything is written it is the default, 60°/s, rounded to the device's step.

```js
console.log(kubi.speed.pan.toFixed(2), kubi.speed.tilt.toFixed(2));   // "59.94" "59.94"
await kubi.writeTiltSpeed(20);
console.log(kubi.speed.pan.toFixed(2), kubi.speed.tilt.toFixed(2));   // "59.94" "19.98"
```

## Status and device info

### kubi.readBatteryVoltage()

Reads the battery voltage.

- **Parameters**: none
- **Returns**: `Promise<number>`, in millivolts
- **Communicates**: yes
- **Fails with**: `KubiError` when not connected or the device does not provide it

```js
const millivolts = await kubi.readBatteryVoltage();
console.log(millivolts);   // 3700
```

No percentage is derived, because the device's discharge curve is not documented.

### kubi.batteryStatus

The latest battery status reported by the device.

- **Type**: `{ charging: boolean, low: boolean }`, or `null` while disconnected or when the device does not report it
- **Communicates**: no

```js
console.log(kubi.batteryStatus);   // { charging: false, low: false }
```

### kubi.onBatteryStatusChange(callback)

Subscribes to changes of `batteryStatus`.

| Parameter | Type | Description |
|---|---|---|
| `callback` | `(status) => void` | Receives `{ charging: boolean, low: boolean }` |

- **Returns**: a function that unsubscribes
- **Communicates**: no

It fires only when the status changes, for example when USB power is plugged in.

```js
kubi.onBatteryStatusChange((status) => console.log(status));
// plug in the USB cable
// { charging: true, low: false }
```

### kubi.onServoFault(callback)

Subscribes to servo faults reported by the device.

| Parameter | Type | Description |
|---|---|---|
| `callback` | `(error) => void` | Receives a [`ServoFault`](#servofault) |

- **Returns**: a function that unsubscribes
- **Communicates**: no

The usual one is `overload`: the neck was held back while turning.

```js
kubi.onServoFault((error) => console.log(error.axis, error.overload));
// hold the neck while it is turning
// "pan" true
```

There is no "cleared" event and no operation to clear the error. On the device it stays until the power is cycled.

### kubi.buttonPressed

Whether the button on the device is held down.

- **Type**: `boolean`, or `null` while disconnected or when the device does not report it
- **Communicates**: no

```js
console.log(kubi.buttonPressed);   // false
```

### kubi.onButtonChange(callback)

Subscribes to presses and releases of the button on the device.

| Parameter | Type | Description |
|---|---|---|
| `callback` | `(pressed: boolean) => void` | `true` on press, `false` on release |

- **Returns**: a function that unsubscribes
- **Communicates**: no

```js
kubi.onButtonChange((pressed) => console.log(pressed));
// press the button, then release it
// true
// false
```

Long presses and double presses are not interpreted.

### kubi.readDeviceInfo()

Reads the Device Information service (`0x180A`).

- **Parameters**: none
- **Returns**: `Promise<DeviceInfo>`. See [`DeviceInfo`](#deviceinfo). A field the device does not provide is `null`
- **Communicates**: yes
- **Fails with**: `KubiError` when not connected

```js
const info = await kubi.readDeviceInfo();
console.log(info.serialNumber);       // "EFC55E"
console.log(info.modelNumber);        // "iPre-K"
console.log(info.manufacturer);       // "iPresence Co., Ltd."
console.log(info.hardwareRevision);   // "1.0.0"
console.log(info.firmwareRevision);   // "1.1.1"
```

## Diagnostics

### kubi.onDiagnostic(callback)

Subscribes to everything the library sends and receives. For development and bug reports: record what you receive, do not make decisions on it.

| Parameter | Type | Description |
|---|---|---|
| `callback` | `(event) => void` | Receives a [`DiagnosticEvent`](#diagnosticevent) |

- **Returns**: a function that unsubscribes
- **Communicates**: no. Nothing is produced while nobody is subscribed

One goal write is one `write` event.

```js
kubi.onDiagnostic((event) => {
  if (event.type === 'write') console.log(event.purpose, event.axis, event.bytes);
});
await kubi.writePanGoal(30);   // logs: "goal" "pan" Uint8Array [2, 102]
```

One read is a `write` (the request) followed by a `frame` (the device's answer).

```js
kubi.onDiagnostic((event) => console.log(event.type));
await kubi.readPan();
// "write"
// "frame"
```

## Types

TypeScript users get these from the bundled type definitions. Shapes are written here as plain object literals; `A | B` means one of the two.

### Axis

```js
'pan' | 'tilt'
```

Appears in `ServoFault.axis` and `DiagnosticEvent.axis`.

### Observed

```js
{ value: number, observedAt: Date, ageMs: number }
```

A measured angle with the time it was measured. `ageMs` is computed each time you read it, so it keeps growing while you hold the object.

```js
const pan = await kubi.readPan();
console.log(pan.ageMs);   // 0
await new Promise((resolve) => setTimeout(resolve, 1000));
console.log(pan.ageMs);   // about 1000
```

### PanTilt

```js
{ pan: T, tilt: T }
```

One value per axis. `kubi.speed` is a `PanTilt` of numbers.

### Range

```js
{ min: number, max: number }
```

The shape of `panRange`, `tiltRange` and `speedRange`. Both ends are included.

### ConnectionState

```js
'disconnected' | 'connecting' | 'connected'
```

### ConnectionChange

```js
  { state: 'connecting' }
| { state: 'connected' }
| { state: 'disconnected', cause: DisconnectCause }
```

### DisconnectCause

```js
'byApp' | 'connectFailed' | 'linkLost'
```

| Value | Meaning |
|---|---|
| `byApp` | You called `disconnect()` or `dispose()` |
| `connectFailed` | `connect()` did not complete |
| `linkLost` | The device went out of range or was switched off |

### BluetoothAvailability

```js
'available' | 'unavailable' | 'unknown'
```

### KubiDevice

```js
{ id: string, name: string | null }
```

### ConnectResult

```js
  { type: 'connected' }
| { type: 'notConnected', reason: 'notSelected' | 'couldNotConnect' | 'connectionInProgress' | 'alreadyConnected' }
```

See [`connect()`](#kubiconnect) for when each one is returned.

### BatteryStatus

```js
{ charging: boolean, low: boolean }
```

### ServoFault

```js
{ axis: Axis | null, inputVoltage: boolean, overheating: boolean, electricalShock: boolean, overload: boolean, at: Date }
```

`axis` is the axis the fault was reported for, or `null` when the device did not say. `at` is when the notification arrived.

### DeviceInfo

```js
{ serialNumber: string | null, modelNumber: string | null, manufacturer: string | null, hardwareRevision: string | null, firmwareRevision: string | null }
```

### DiagnosticEvent

```js
  { type: 'write',   purpose: WritePurpose, axis: Axis | null, characteristic: string, bytes: Uint8Array, ok: boolean, at: Date }
| { type: 'frame',   characteristic: string, bytes: Uint8Array, at: Date }
| { type: 'read',    characteristic: string, bytes: Uint8Array | null, at: Date }
| { type: 'clamped', what: 'angle' | 'speed', axis: Axis, requested: number, applied: number, at: Date }
| { type: 'note',    message: string, at: Date }
```

| `type` | Meaning |
|---|---|
| `write` | Something sent to the device. `ok` is whether the device acknowledged it |
| `frame` | A notification received from the device, such as the answer to a position request |
| `read` | A value read from the device, such as the battery voltage. `bytes` is `null` when the read failed |
| `clamped` | A value you passed was outside its range and was brought into it |
| `note` | A free-text message from inside the library |

`characteristic` is the UUID of the GATT characteristic.

### WritePurpose

```js
'goal' | 'speed' | 'brake' | 'hold' | 'readRequest' | 'notifyEnable'
```

| Value | Meaning |
|---|---|
| `goal` | A goal write (`writePanGoal` / `writeTiltGoal`) |
| `speed` | A speed write (`writePanSpeed` / `writeTiltSpeed`, and once per axis while connecting) |
| `readRequest` | A request for a position (`readPan` / `readTilt`) |
| `notifyEnable` | Happens once while connecting |
| `brake`, `hold` | Not produced in this release |

### Transport interfaces

```js
KubiTransport, KubiLink, TransportCapabilities, PickResult, PickFailure, TransportError
```

How the library talks to a device. They are exported for people implementing a custom transport for `new Kubi(transport)`; see the bundled type definitions. Applications using Web Bluetooth never touch them.

## Constants

### panRange

The range of motion of pan, in degrees.

```js
import { panRange } from 'kubi-sdk';
console.log(panRange);   // { min: -150, max: 150 }
```

### tiltRange

The range of motion of tilt, in degrees.

```js
import { tiltRange } from 'kubi-sdk';
console.log(tiltRange);   // { min: -20, max: 40 }
```

### speedRange

The accepted speed range, in degrees per second. The upper end is the highest speed the device guarantees. A value in this range is accepted; reaching that speed is not guaranteed.

```js
import { speedRange } from 'kubi-sdk';
console.log(speedRange.min.toFixed(2), speedRange.max.toFixed(1));   // "0.67" "103.9"
```

### defaultSpeed

The speed setting of both axes before anything is written, in degrees per second.

```js
import { defaultSpeed } from 'kubi-sdk';
console.log(defaultSpeed);   // 60
```

## Errors

### KubiError

A failure that can happen in normal operation. Every method marked "Communicates: yes" can reject with it.

| `code` | Meaning |
|---|---|
| `noLink` | Not connected |
| `linkLost` | The link dropped during the operation |
| `writeFailed` | A write to the device failed |
| `readFailed` | A read or a position request got no usable answer |

Handle it the same way regardless of `code`: stop what you were doing and let `onConnectionChange` drive reconnection.

```js
try {
  await kubi.writePanGoal(30);
} catch (error) {
  if (error instanceof KubiError) console.log(error.code);   // "noLink"
}
```

### KubiDisposedError

Thrown by any call after `dispose()`. A bug in the calling code.

```js
await kubi.dispose();
await kubi.readPan();   // rejects with KubiDisposedError
```

### KubiUnsupportedError

Thrown when an operation the transport does not support is called. Check `capabilities` first.

```js
const kubi = new Kubi(transportWithoutChooser);
console.log(kubi.capabilities.providesDevicePicker);   // false
await kubi.connect();                                  // rejects with KubiUnsupportedError
```

### RangeError

Rejected for an argument that has no meaning: a value that is not a finite number, or a speed of 0 or below. An angle outside the range of motion is **not** an error; it is clamped.

```js
await kubi.writePanSpeed(-1);         // rejects with RangeError
await kubi.writeTiltGoal(Infinity);   // rejects with RangeError
await kubi.writePanGoal(999);         // resolves; written as 150
```
