# kubi-sdk guide

The ideas behind the API, and what to do when something does not work. For every method with its parameters, return values and failures, see the [API reference](./api.md).

[日本語版](./guide.ja.md)

The examples assume a connected `kubi` (see ["Setup" in the API reference](./api.md#setup)) and this helper:

```js
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
```

## Concepts

### 1. The basic API

The device understands three things per axis: a goal position to go to, a speed, and a request for the present position. This release of the library gives you exactly those, one method per operation and per axis:

| Operation | Pan | Tilt |
|---|---|---|
| Write a goal | `writePanGoal(degrees)` | `writeTiltGoal(degrees)` |
| Write a speed | `writePanSpeed(degreesPerSecond)` | `writeTiltSpeed(degreesPerSecond)` |
| Read the present position | `readPan()` | `readTilt()` |

Each call is one operation on the device, sent in the order you call it.

```js
await kubi.writePanSpeed(30);        // one write
await kubi.writePanGoal(30);         // one write; the neck starts turning
const pan = await kubi.readPan();    // one request and one response
```

The library adds nothing of its own. While you call nothing, it sends nothing.

```js
let count = 0;
kubi.onDiagnostic((event) => {
  if (event.type === 'write') count += 1;
});
await sleep(5000);
console.log(count);   // 0
```

Methods that wait until the neck stops, built on these six, are planned for a later release. Until then, [section 3](#3-waiting-until-the-neck-stops) shows how to wait yourself.

**Following a slider.** Every call is sent, and one write takes about 130 ms. If you call `writePanGoal` on every input event, the calls queue up and the neck falls behind. Wait for the previous write and send only the latest value:

```js
let latest = null;
let busy = false;
panSlider.oninput = async () => {
  latest = Number(panSlider.value);
  if (busy) return;                 // a write is in flight; it picks up `latest` when it finishes
  busy = true;
  try {
    while (latest !== null) {
      const value = latest;
      latest = null;
      await kubi.writePanGoal(value);
    }
  } finally {
    busy = false;
  }
};
```

### 2. Reading the position

**The device never reports its position on its own.** It answers only when asked, and `readPan()` / `readTilt()` are how you ask. One read is one round trip, about 130 to 260 ms.

What you get back is a measurement from the past. `ageMs` tells you how old it is.

```js
const pan = await kubi.readPan();
console.log(pan.value.toFixed(1));   // "29.2"
await sleep(1000);
console.log(pan.ageMs);              // about 1000: this value is now a second old
```

The device answers one axis per request. Read the two axes one after the other; they are never measured at the same moment.

```js
const pan = await kubi.readPan();
const tilt = await kubi.readTilt();
console.log(tilt.observedAt - pan.observedAt > 0);   // true
```

If you read in a loop, `await` each call. Calling `readPan()` without awaiting does not read faster; the requests wait in line inside the library. The device has been run at about seven requests per second for a minute without losing an answer, which is as fast as a browser can send them.

### 3. Waiting until the neck stops

`writePanGoal` resolves when the goal is written, not when the neck arrives.

```js
await kubi.writePanGoal(60);   // resolves at once; the neck is now turning
```

To wait, read the position until it stops changing.

```js
let pan = await kubi.readPan();
for (;;) {
  await sleep(200);
  const next = await kubi.readPan();
  const stopped = Math.abs(next.value - pan.value) < 0.5;
  pan = next;
  if (stopped) break;
}
```

`pan` now holds where the neck stopped.

```js
console.log(pan.value.toFixed(1));   // "59.1"
```

Three things to know when you write this loop:

- **The neck stops about 1° short of the goal, and that is normal** (servo precision, gravity, load). Wait for "stopped changing", not for "equal to the goal", or the loop may never end.
- A neck held back by hand, or at the end of its range, also stops. If you need to know whether it arrived, compare the position with the goal against your own tolerance.
- At very low speeds the neck moves less than 0.5° in 200 ms. Use a longer interval or a smaller threshold there.

### 4. Clamping

An angle outside `panRange` / `tiltRange` is not an error. It is clamped to the nearest end and written.

```js
await kubi.writePanGoal(200);        // written as 150
await sleep(4000);
const pan = await kubi.readPan();
console.log(pan.value.toFixed(1));   // "149.1"
```

The call itself does not tell you that it clamped. Subscribe to the diagnostics to see it.

```js
kubi.onDiagnostic((event) => {
  if (event.type === 'clamped') console.log(event.requested, event.applied);
});
await kubi.writePanGoal(200);   // logs: 200 150
```

A value that has **no** meaning is rejected instead: `NaN`, an infinity, or a speed of 0 or below.

```js
await kubi.writePanGoal(NaN);   // rejects with RangeError
```

Angles are rounded to the device's step of about 0.29° (300° over 1023 steps), so a goal you write and the position you read back can differ by up to one step. Speeds outside `speedRange` are clamped in the same way.

### 5. Speed

`writePanSpeed` / `writeTiltSpeed` set how fast an axis turns. `kubi.speed` returns what you last wrote, rounded to the device's step. It is not read from the device.

```js
await kubi.writePanSpeed(30);
console.log(kubi.speed.pan.toFixed(2));   // "29.97"
```

**The device starts using a new speed when the next goal is written.** Write the speed first, then the goal.

```js
await kubi.writePanSpeed(30);
await kubi.writePanGoal(60);    // turns at about 30°/s
```

A speed written while the neck is turning does nothing by itself. Write the same goal again to apply it.

```js
await kubi.writePanGoal(60);    // turning at the previous speed
await kubi.writePanSpeed(20);   // still turning at the previous speed
await kubi.writePanGoal(60);    // now turning at about 20°/s
```

Until you write one, both axes use the default, 60°/s. The setting survives a reconnect: the library writes it to the device again during `connect()`.

### 6. Changing the goal while the neck is moving

**The device has no stop command.** What you can do is write a new goal. The old goal is forgotten and the neck heads for the new one.

```js
await kubi.writePanGoal(90);     // turning right
await sleep(500);
await kubi.writePanGoal(-30);    // now heading left, to −30°
```

The device changes speed only at a fixed rate (about 68°/s²), so a turning neck cannot stop on the spot. From 60°/s it needs about a second and about 26°.

That is why writing the position you just read does **not** hold the neck there. It overshoots that point and then swings back to it.

```js
const pan = await kubi.readPan();
await kubi.writePanGoal(pan.value);   // overshoots, then swings back
```

To stop without swinging back, write a goal ahead of the neck by its stopping distance: the square of the speed in °/s divided by 136, in degrees.

```js
const pan = await kubi.readPan();
const ahead = (60 * 60) / 136;                // about 26° at 60°/s
await kubi.writePanGoal(pan.value + ahead);   // turning right: slows down and stops there
```

None of this is an emergency stop. If your application must keep the neck out of an area, limit the goals you write.

## Troubleshooting

### Which browsers work

Chrome, Edge and other Chromium-based browsers on desktop and Android. Safari and Firefox do not implement Web Bluetooth. `bluetoothAvailability` is `unavailable` when the browser has no Web Bluetooth at all; it may stay `unknown` even when Bluetooth is turned off, so treat only `unavailable` as definitive.

### The page must be served over HTTPS or from localhost

Web Bluetooth works only in a secure context. A page opened from `file://` or plain `http://` on a remote host never shows the device chooser. During development, serve the page from `localhost` (the repository's `pnpm demo` does this).

### The device chooser does not open

The chooser can only be opened from a user gesture. Call `connect()` inside a click or key handler, **before any other `await`**. If you `await` something first, the gesture is consumed and `connect()` resolves with `notSelected`.

### It does not connect to an older Kubi

The library supports Kubi 2.0 only. The original Kubi lacks a characteristic the library requires, so `connect()` resolves with `couldNotConnect`. `onDiagnostic` carries a `note` explaining which check failed.

### Servo error and a red light

When the neck is blocked while moving (for example held by hand), the servo reports an overload and the device's light turns red. `onServoFault` fires with `overload: true` and the axis. Pushing the neck while it is holding still can also raise an error, sometimes reported as `inputVoltage`.

The error stays set until the device is **power-cycled**. There is no API to clear it and no "cleared" notification; `onServoFault` only tells you that an error was raised. The neck keeps accepting commands in the meantime. If the light is red and you want it off, turn the Kubi off and on again.

### It disconnects right after connecting

`connect()` resolving with `couldNotConnect`, followed by `disconnected` with `cause: 'connectFailed'`, means the initial synchronization failed: the library could not read a position or write a speed within its timeout. Common causes:

- Another application or tool is connected to the same Kubi and the device stopped answering. Close it and retry.
- The device was powered off or went out of range during the handshake.

Subscribe to `onDiagnostic` and look at the `note` events; they name the step that failed. If you can reproduce it, include those notes in a bug report.
