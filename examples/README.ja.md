# kubi-sdk examples

`Kubi` の公開メンバー 1 つにつき、短いサンプルコードが 1 ファイルあります。どのファイルも、接続済みの `kubi` を受け取る関数 1 つです。

```js
// kubi.readPan()
export default async function (kubi) {
  const pan = await kubi.readPan();
  console.log(pan.value.toFixed(1));   // "29.2"
}
```

関数の中身を、そのまま自分のコードへ写して使ってください。コメントの値はある 1 台のもので、お使いの本体では異なります。

[English](./README.md)

## Running them

```sh
pnpm demo
```

Chrome または Edge で `http://127.0.0.1:8571/examples/` を開き、**connect** を押してから、各サンプルの「実行」を押してください。コードの下に `console.log` の出力が表示されます。

各ファイルは、アプリケーションと同じようにライブラリを `'kubi-sdk'` という名前でインポートしています。このリポジトリの中では、`index.html` がその名前をビルド済みのパッケージ（`packages/js/dist`）に対応させています。

## Files

| 区分 | ファイル |
|---|---|
| Kubi | `forBrowser.js` `constructor.js` |
| Connection | `capabilities.js` `connectionState.js` `device.js` `bluetoothAvailability.js` `connect.js` `disconnect.js` `dispose.js` `onConnectionChange.js` `onBluetoothAvailabilityChange.js` |
| Servo (basic API) | `writePanGoal.js` `writeTiltGoal.js` `writePanSpeed.js` `writeTiltSpeed.js` `readPan.js` `readTilt.js` |
| Speed | `speed.js` |
| Status and device info | `readBatteryVoltage.js` `batteryStatus.js` `onBatteryStatusChange.js` `onServoFault.js` `buttonPressed.js` `onButtonChange.js` `readDeviceInfo.js` |
| Diagnostics | `onDiagnostic.js` |

各メンバーの引数、戻り値、失敗のしかたは [API リファレンス](../docs/api.ja.md)にあります。本体へ書き込んだ値と読み取った値を表示するページは[デモ](../demo/)を参照してください。
