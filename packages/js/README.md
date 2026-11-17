# kubi-sdk

A TypeScript / JavaScript library for the **Kubi 2.0** tablet stand (a two-axis pan/tilt neck) over **Web Bluetooth**: connect, turn the neck, read where it is pointing, and read the state of the device.

```sh
npm install kubi-sdk
```

[日本語版 README](./README.ja.md)

## Table of contents

- [Features](#features)
- [Browser support](#browser-support)
- [Installing](#installing)
- [Example](#example)
- [API](#api)
  - [Kubi](#kubi) / [Connection](#connection) / [Servo (basic API)](#servo-basic-api) / [Speed](#speed) / [Status and device info](#status-and-device-info) / [Diagnostics](#diagnostics)
- [Angles and speeds](#angles-and-speeds)
- [How failures come back](#how-failures-come-back)
- [What this version has been verified on](#what-this-version-has-been-verified-on)
- [Where to read next](#where-to-read-next)
- [License](#license)

## Features

| What you can do | Entry point |
|---|---|
| Pick a Kubi in the browser's device chooser and connect | `connect()` / `disconnect()` |
| Write the angle the neck turns to | `writePanGoal()` / `writeTiltGoal()` |
| Write how fast it turns | `writePanSpeed()` / `writeTiltSpeed()` |
| Read where the neck is | `readPan()` / `readTilt()` |
| Battery, button, servo faults | `readBatteryVoltage()` / `batteryStatus` / `onButtonChange()` / `onServoFault()` |
| Serial number, model, firmware version | `readDeviceInfo()` |
| See the raw bytes sent and received | `onDiagnostic()` |

Each call is one operation on the device. The library sends nothing unless you call something. Methods that wait until the neck stops are planned for a later release.

## Browser support

- Browsers with Web Bluetooth: **Chrome, Edge** and other Chromium-based browsers. It does not run in Safari, Firefox or Node.js.
- The page must be served over **HTTPS or from `localhost`**.
- **Kubi 2.0 only.** It does not connect to the original Kubi (Mini USB, by Revolve Robotics).

## Installing

```sh
npm install kubi-sdk
```

```js
import { Kubi } from 'kubi-sdk';
```

## Example

Create one `Kubi` and connect to the device the user picks.

```js
import { Kubi } from 'kubi-sdk';

const kubi = Kubi.forBrowser();
connectButton.onclick = () => kubi.connect();   // opens the device chooser; must be called from a click
```

Once connected, turn the neck 30° to the right at 30°/s and read where it is.

```js
await kubi.writePanSpeed(30);        // 30°/s, used from the next goal write
await kubi.writePanGoal(30);         // resolves once written; the neck is now turning
await new Promise((resolve) => setTimeout(resolve, 2000));
const pan = await kubi.readPan();
console.log(pan.value.toFixed(1));   // "28.9"
```

## API

Every example below assumes the `kubi` from the example above, already connected. The values in comments come from one device; yours will differ. Each entry links to the [API reference](../../docs/api.md) for parameters, return values, failures and more examples.

### Kubi

#### Kubi.forBrowser()

Creates an instance that uses Web Bluetooth.

A new instance is not connected yet.

```js
const kubi = Kubi.forBrowser();
console.log(kubi.connectionState);   // "disconnected"
```

[Details and more examples](../../docs/api.md#kubiforbrowser)

#### new Kubi(transport)

Creates an instance on a custom transport. For tests and for transports other than Web Bluetooth. Most applications use `Kubi.forBrowser()` instead.

The instance reports what your transport can do.

```js
const kubi = new Kubi(myTransport);
console.log(kubi.capabilities);   // { providesDevicePicker: true, canScan: false }
```

[Details and more examples](../../docs/api.md#new-kubitransport)

### Connection

#### kubi.capabilities

What the transport can do. Branch on these rather than on platform names.

With Web Bluetooth the browser shows the device chooser, and scanning is not available.

```js
console.log(kubi.capabilities);   // { providesDevicePicker: true, canScan: false }
```

[Details and more examples](../../docs/api.md#kubicapabilities)

#### kubi.connectionState

The current connection state.

It becomes `connected` when `connect()` has finished.

```js
console.log(kubi.connectionState);   // "disconnected"
await kubi.connect();
console.log(kubi.connectionState);   // "connected"
```

[Details and more examples](../../docs/api.md#kubiconnectionstate)

#### kubi.device

The connected device.

`name` is for display. `id` is opaque and stable only within the same app and browser.

```js
console.log(kubi.device);   // { id: "kubi-0001", name: "kubi000012AB01" }
await kubi.disconnect();
console.log(kubi.device);   // null
```

[Details and more examples](../../docs/api.md#kubidevice)

#### kubi.bluetoothAvailability

Whether Bluetooth can be used right now.

`unknown` means the browser did not say. Trust `unavailable` only when it is reported.

```js
console.log(kubi.bluetoothAvailability);   // "available"
```

[Details and more examples](../../docs/api.md#kubibluetoothavailability)

#### kubi.connect()

Opens the browser's device chooser, lets the user pick a Kubi, and connects to it.

Call it inside a click handler, before any other `await`. Otherwise the browser refuses to open the chooser.

```js
connectButton.onclick = async () => {
  const result = await kubi.connect();
  console.log(result);   // { type: "connected" }
};
```

[Details and more examples](../../docs/api.md#kubiconnect)

#### kubi.disconnect()

Closes the link.

Subscriptions stay in place, so the same instance can `connect()` again.

```js
await kubi.disconnect();
console.log(kubi.connectionState);   // "disconnected"
```

[Details and more examples](../../docs/api.md#kubidisconnect)

#### kubi.dispose()

Releases the instance: closes the link and ends every subscription. Irreversible.

Call it when the page or component that owns the instance goes away. Every later call fails.

```js
await kubi.dispose();
await kubi.readPan();   // rejects with KubiDisposedError
```

[Details and more examples](../../docs/api.md#kubidispose)

#### kubi.onConnectionChange(callback)

Subscribes to changes of `connectionState`.

Connecting and then disconnecting delivers three changes.

```js
kubi.onConnectionChange((change) => console.log(change));
await kubi.connect();
// { state: "connecting" }
// { state: "connected" }
await kubi.disconnect();
// { state: "disconnected", cause: "byApp" }
```

[Details and more examples](../../docs/api.md#kubionconnectionchangecallback)

#### kubi.onBluetoothAvailabilityChange(callback)

Subscribes to changes of `bluetoothAvailability`. Fires also while disconnected.

Use it to enable or disable your connect button.

```js
kubi.onBluetoothAvailabilityChange((availability) => console.log(availability));
// the user turns Bluetooth off
// "unavailable"
```

[Details and more examples](../../docs/api.md#kubionbluetoothavailabilitychangecallback)

### Servo (basic API)

#### kubi.writePanGoal(degrees)

Writes the pan goal: the angle the neck turns to.

Write a goal, give the neck time to turn, then read where it is. Stopping about 1° short of the goal is normal.

```js
await kubi.writePanGoal(30);
await new Promise((resolve) => setTimeout(resolve, 2000));
const pan = await kubi.readPan();
console.log(pan.value.toFixed(1));   // "29.2"
```

[Details and more examples](../../docs/api.md#kubiwritepangoaldegrees)

#### kubi.writeTiltGoal(degrees)

Writes the tilt goal: the angle the neck tilts to.

Tilt 20° upward, then read where the neck is.

```js
await kubi.writeTiltGoal(20);
await new Promise((resolve) => setTimeout(resolve, 2000));
const tilt = await kubi.readTilt();
console.log(tilt.value.toFixed(1));   // "19.2"
```

[Details and more examples](../../docs/api.md#kubiwritetiltgoaldegrees)

#### kubi.writePanSpeed(degreesPerSecond)

Writes the pan speed. **The device starts using it at the next goal write.**

The value becomes the pan speed setting, rounded to the device's step. The next goal write uses it.

```js
await kubi.writePanSpeed(30);
console.log(kubi.speed.pan.toFixed(2));   // "29.97"
await kubi.writePanGoal(60);              // turns at about 30°/s
```

[Details and more examples](../../docs/api.md#kubiwritepanspeeddegreespersecond)

#### kubi.writeTiltSpeed(degreesPerSecond)

Writes the tilt speed. **The device starts using it at the next goal write.**

The value becomes the tilt speed setting. The next tilt goal write uses it.

```js
await kubi.writeTiltSpeed(20);
console.log(kubi.speed.tilt.toFixed(2));   // "19.98"
await kubi.writeTiltGoal(30);              // tilts at about 20°/s
```

[Details and more examples](../../docs/api.md#kubiwritetiltspeeddegreespersecond)

#### kubi.readPan()

Reads the present pan position from the device.

The result carries the angle, when it was measured, and how old the measurement is.

```js
const pan = await kubi.readPan();
console.log(pan.value.toFixed(1));   // "29.2"
console.log(pan.observedAt);         // a Date: when it was measured
console.log(pan.ageMs);              // 0, and grows as time passes
```

[Details and more examples](../../docs/api.md#kubireadpan)

#### kubi.readTilt()

Reads the present tilt position from the device.

The device answers one axis per request, so read the two axes one after the other.

```js
const pan = await kubi.readPan();
const tilt = await kubi.readTilt();
console.log(pan.value.toFixed(1), tilt.value.toFixed(1));   // "29.2" "19.2"
```

[Details and more examples](../../docs/api.md#kubireadtilt)

### Speed

#### kubi.speed

The speed setting of each axis: the last value written with `writePanSpeed` / `writeTiltSpeed`, rounded to the device's step.

Before anything is written it is the default, 60°/s, rounded to the device's step.

```js
console.log(kubi.speed.pan.toFixed(2), kubi.speed.tilt.toFixed(2));   // "59.94" "59.94"
await kubi.writeTiltSpeed(20);
console.log(kubi.speed.pan.toFixed(2), kubi.speed.tilt.toFixed(2));   // "59.94" "19.98"
```

[Details and more examples](../../docs/api.md#kubispeed)

### Status and device info

#### kubi.readBatteryVoltage()

Reads the battery voltage.

```js
const millivolts = await kubi.readBatteryVoltage();
console.log(millivolts);   // 3700
```

[Details and more examples](../../docs/api.md#kubireadbatteryvoltage)

#### kubi.batteryStatus

The latest battery status reported by the device.

```js
console.log(kubi.batteryStatus);   // { charging: false, low: false }
```

[Details and more examples](../../docs/api.md#kubibatterystatus)

#### kubi.onBatteryStatusChange(callback)

Subscribes to changes of `batteryStatus`.

It fires only when the status changes, for example when USB power is plugged in.

```js
kubi.onBatteryStatusChange((status) => console.log(status));
// plug in the USB cable
// { charging: true, low: false }
```

[Details and more examples](../../docs/api.md#kubionbatterystatuschangecallback)

#### kubi.onServoFault(callback)

Subscribes to servo faults reported by the device.

The usual one is `overload`: the neck was held back while turning.

```js
kubi.onServoFault((error) => console.log(error.axis, error.overload));
// hold the neck while it is turning
// "pan" true
```

[Details and more examples](../../docs/api.md#kubionservofaultcallback)

#### kubi.buttonPressed

Whether the button on the device is held down.

```js
console.log(kubi.buttonPressed);   // false
```

[Details and more examples](../../docs/api.md#kubibuttonpressed)

#### kubi.onButtonChange(callback)

Subscribes to presses and releases of the button on the device.

```js
kubi.onButtonChange((pressed) => console.log(pressed));
// press the button, then release it
// true
// false
```

[Details and more examples](../../docs/api.md#kubionbuttonchangecallback)

#### kubi.readDeviceInfo()

Reads the Device Information service (`0x180A`).

```js
const info = await kubi.readDeviceInfo();
console.log(info.serialNumber);       // "EFC55E"
console.log(info.modelNumber);        // "iPre-K"
console.log(info.manufacturer);       // "iPresence Co., Ltd."
console.log(info.hardwareRevision);   // "1.0.0"
console.log(info.firmwareRevision);   // "1.1.1"
```

[Details and more examples](../../docs/api.md#kubireaddeviceinfo)

### Diagnostics

#### kubi.onDiagnostic(callback)

Subscribes to everything the library sends and receives. For development and bug reports: record what you receive, do not make decisions on it.

One goal write is one `write` event.

```js
kubi.onDiagnostic((event) => {
  if (event.type === 'write') console.log(event.purpose, event.axis, event.bytes);
});
await kubi.writePanGoal(30);   // logs: "goal" "pan" Uint8Array [2, 102]
```

[Details and more examples](../../docs/api.md#kubiondiagnosticcallback)

## Angles and speeds

```
        −150°                 0°                +150°
  pan   left end ─────────── front ─────────── right end   (as seen by the person facing the device)
  tilt  −20° (down) ──── 0° (level) ──── +40° (up)
```

- Angles are in **degrees**, speeds in **degrees per second**. `panRange`, `tiltRange`, `speedRange` and `defaultSpeed` (60°/s) are exported constants.
- **Angles outside the range are clamped to the nearest end, not rejected.**
- **The neck stops about 1° short of the goal.** That is normal (servo precision, gravity, load). Read the position to learn where it is.
- **A speed takes effect at the next goal write.** To change the speed of a neck that is already turning, write the speed and then write the same goal again.
- **There is no stop command.** To send the neck somewhere else, write a new goal.
- Angles are rounded to steps of about 0.29°, and speeds to steps of about 0.67°/s, so a value you write and the value you read back can differ slightly.

## How failures come back

| What happened | How it comes back |
|---|---|
| No device chosen / could not connect | The result value of `connect()` |
| Not connected / link lost / a write or read failed | **`KubiError`** (a rejected Promise). `code` tells them apart, but the handling is the same |
| An argument is not a finite number, or a speed is 0 or below | `RangeError` |
| An angle outside the range of motion | Not a failure. It is clamped |
| Called after `dispose()` | `KubiDisposedError` |

Recover from a lost link in **one place, `onConnectionChange`**, not at every call site. The library does not reconnect on its own.

## What this version has been verified on

**1.0.0**

- About 180 automated scenarios run against a simulated device. Every example in this README and in the API reference is one of them. The simulated servo reproduces two measured behaviors of the device: a speed takes effect at the next goal write, and the neck accelerates and decelerates at a fixed rate.
- Measured on one Kubi 2.0 unit (firmware 1.1.1) with a Bluetooth tool, outside the library: a speed takes effect at the next goal write; about seven position requests per second for a minute without a lost answer.
- From Chrome on macOS, connecting, the servo error notification while the neck is held, and the battery status notification on USB plug/unplug were verified on the same unit with an earlier build. The API as it is now has not yet been run against a device from a browser.
- Only the first byte of the servo error characteristics is interpreted; the meaning of the second byte is not defined in the specification.

## Where to read next

- [API reference](../../docs/api.md): every method, type, constant and error, with parameters, return values and failures
- [Guide](../../docs/guide.md): the ideas behind the API (reading positions, waiting until the neck stops, speed) and troubleshooting
- Hover documentation (JSDoc) in your editor covers every method
- [`examples/`](../../examples/) has one short sample file per method, and a page that runs them
- [`demo/`](../../demo/) is a working demo page. For each axis it shows what you write (input) and what you read back (output)

## License

[MIT](./LICENSE) © iPresence Co., Ltd.
