# kubi-sdk examples

One short sample file per public member of `Kubi`. Each file is a single function that takes a connected `kubi`:

```js
// kubi.readPan()
export default async function (kubi) {
  const pan = await kubi.readPan();
  console.log(pan.value.toFixed(1));   // "29.2"
}
```

Copy the body of the function into your own code. The values in comments come from one device; yours will differ.

[日本語](./README.ja.md)

## Running them

```sh
pnpm demo
```

Then open `http://127.0.0.1:8571/examples/` in Chrome or Edge, press **connect**, and press 実行 (run) under any example. The output of `console.log` appears below the code. The page's labels are in Japanese.

The files import the library as `'kubi-sdk'`, as your application would. Inside this repository, `index.html` maps that name to the built package (`packages/js/dist`).

## Files

| Group | Files |
|---|---|
| Kubi | `forBrowser.js` `constructor.js` |
| Connection | `capabilities.js` `connectionState.js` `device.js` `bluetoothAvailability.js` `connect.js` `disconnect.js` `dispose.js` `onConnectionChange.js` `onBluetoothAvailabilityChange.js` |
| Servo (basic API) | `writePanGoal.js` `writeTiltGoal.js` `writePanSpeed.js` `writeTiltSpeed.js` `readPan.js` `readTilt.js` |
| Speed | `speed.js` |
| Status and device info | `readBatteryVoltage.js` `batteryStatus.js` `onBatteryStatusChange.js` `onServoFault.js` `buttonPressed.js` `onButtonChange.js` `readDeviceInfo.js` |
| Diagnostics | `onDiagnostic.js` |

Parameters, return values and failures of each member are in the [API reference](../docs/api.md). For a page that shows what is written to and read from the device, see the [demo](../demo/).
