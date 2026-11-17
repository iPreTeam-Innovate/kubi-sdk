# kubi-sdk

タブレットスタンド **Kubi 2.0**（左右と上下の 2 軸で首を振る装置）を **Web Bluetooth** で操作する TypeScript / JavaScript ライブラリです。接続する、首を回す、首の向きを読み取る、本体の状態を読み取る、ができます。

```sh
npm install kubi-sdk
```

[English README](./README.md)

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

| できること | 入口 |
|---|---|
| ブラウザーのデバイスダイアログで Kubi を選び、接続する | `connect()` / `disconnect()` |
| 首を向ける角度を書き込む | `writePanGoal()` / `writeTiltGoal()` |
| 首を回す速さを書き込む | `writePanSpeed()` / `writeTiltSpeed()` |
| 首の位置を読み取る | `readPan()` / `readTilt()` |
| バッテリー、ボタン、サーボの異常 | `readBatteryVoltage()` / `batteryStatus` / `onButtonChange()` / `onServoFault()` |
| シリアル番号、型番、ファームウェアのバージョン | `readDeviceInfo()` |
| 送受信したバイト列を見る | `onDiagnostic()` |

1 回の呼び出しが、本体への操作 1 つです。何かを呼び出さない限り、ライブラリは何も送りません。首が止まるまで待つメソッドは、今後のリリースで追加する予定です。

## Browser support

- Web Bluetooth に対応したブラウザー（**Chrome、Edge** などの Chromium 系）で動作します。Safari、Firefox、Node.js では動作しません。
- ページは **HTTPS または `localhost`** から配信する必要があります。
- **Kubi 2.0 専用です。** 初代 Kubi（Mini USB 端子・Revolve Robotics 製）には接続できません。

## Installing

```sh
npm install kubi-sdk
```

```js
import { Kubi } from 'kubi-sdk';
```

## Example

`Kubi` を 1 つ作成し、ユーザーが選んだデバイスに接続します。

```js
import { Kubi } from 'kubi-sdk';

const kubi = Kubi.forBrowser();
connectButton.onclick = () => kubi.connect();   // デバイス選択ダイアログを開きます。クリックの中で呼び出す必要があります
```

接続したら、首を 30°/s で右へ 30° 回し、位置を読み取ります。

```js
await kubi.writePanSpeed(30);        // 30°/s。次の目標の書き込みから使われます
await kubi.writePanGoal(30);         // 書き込んだ時点で解決します。首は回り始めています
await new Promise((resolve) => setTimeout(resolve, 2000));
const pan = await kubi.readPan();
console.log(pan.value.toFixed(1));   // "28.9"
```

## API

以下の例はすべて、上の例の `kubi` が接続済みであることを前提にしています。コメントの値はある 1 台のもので、お使いの本体では異なります。引数、戻り値、失敗、ほかの例は、各項目のリンク先の [API リファレンス](../../docs/api.ja.md)にあります。

### Kubi

#### Kubi.forBrowser()

Web Bluetooth を使うインスタンスを作成します。

作成した直後は、まだ接続されていません。

```js
const kubi = Kubi.forBrowser();
console.log(kubi.connectionState);   // "disconnected"
```

[詳細とほかの例](../../docs/api.ja.md#kubiforbrowser)

#### new Kubi(transport)

独自のトランスポートを使うインスタンスを作成します。テストや、Web Bluetooth 以外のトランスポートを実装する場合に使います。通常のアプリケーションでは `Kubi.forBrowser()` を使ってください。

インスタンスは、渡したトランスポートが提供する機能をそのまま返します。

```js
const kubi = new Kubi(myTransport);
console.log(kubi.capabilities);   // { providesDevicePicker: true, canScan: false }
```

[詳細とほかの例](../../docs/api.ja.md#new-kubitransport)

### Connection

#### kubi.capabilities

トランスポートが提供する機能です。プラットフォーム名ではなく、この値で処理を分岐してください。

Web Bluetooth では、デバイス選択ダイアログをブラウザーが表示します。周囲のデバイスの一覧は取得できません。

```js
console.log(kubi.capabilities);   // { providesDevicePicker: true, canScan: false }
```

[詳細とほかの例](../../docs/api.ja.md#kubicapabilities)

#### kubi.connectionState

現在の接続状態です。

`connect()` が完了すると `connected` になります。

```js
console.log(kubi.connectionState);   // "disconnected"
await kubi.connect();
console.log(kubi.connectionState);   // "connected"
```

[詳細とほかの例](../../docs/api.ja.md#kubiconnectionstate)

#### kubi.device

接続中のデバイスです。

`name` は表示用です。`id` は不透明な識別子で、同じアプリケーション・同じブラウザーの中でのみ安定します。

```js
console.log(kubi.device);   // { id: "kubi-0001", name: "kubi000012AB01" }
await kubi.disconnect();
console.log(kubi.device);   // null
```

[詳細とほかの例](../../docs/api.ja.md#kubidevice)

#### kubi.bluetoothAvailability

現在 Bluetooth を利用できるかどうかです。

`unknown` は、ブラウザーが答えなかったことを表します。確実だと見なせるのは `unavailable` が返ったときだけです。

```js
console.log(kubi.bluetoothAvailability);   // "available"
```

[詳細とほかの例](../../docs/api.ja.md#kubibluetoothavailability)

#### kubi.connect()

ブラウザーのデバイスダイアログを開き、ユーザーが選んだ Kubi に接続します。

クリックのハンドラーの中で、ほかの `await` より前に呼び出してください。そうしないと、ブラウザーがダイアログを開きません。

```js
connectButton.onclick = async () => {
  const result = await kubi.connect();
  console.log(result);   // { type: "connected" }
};
```

[詳細とほかの例](../../docs/api.ja.md#kubiconnect)

#### kubi.disconnect()

接続を切断します。

購読は維持されるため、同じインスタンスでもう一度 `connect()` を呼び出せます。

```js
await kubi.disconnect();
console.log(kubi.connectionState);   // "disconnected"
```

[詳細とほかの例](../../docs/api.ja.md#kubidisconnect)

#### kubi.dispose()

インスタンスを解放します。接続を切断し、すべての購読を終了します。元に戻すことはできません。

インスタンスを持っているページやコンポーネントが破棄されるときに呼び出してください。以後の呼び出しはすべて失敗します。

```js
await kubi.dispose();
await kubi.readPan();   // KubiDisposedError で拒否されます
```

[詳細とほかの例](../../docs/api.ja.md#kubidispose)

#### kubi.onConnectionChange(callback)

`connectionState` の変化を購読します。

接続してから切断すると、変化が 3 回届きます。

```js
kubi.onConnectionChange((change) => console.log(change));
await kubi.connect();
// { state: "connecting" }
// { state: "connected" }
await kubi.disconnect();
// { state: "disconnected", cause: "byApp" }
```

[詳細とほかの例](../../docs/api.ja.md#kubionconnectionchangecallback)

#### kubi.onBluetoothAvailabilityChange(callback)

`bluetoothAvailability` の変化を購読します。未接続のあいだも呼び出されます。

接続ボタンの有効／無効を切り替えるのに使えます。

```js
kubi.onBluetoothAvailabilityChange((availability) => console.log(availability));
// ユーザーが Bluetooth をオフにする
// "unavailable"
```

[詳細とほかの例](../../docs/api.ja.md#kubionbluetoothavailabilitychangecallback)

### Servo (basic API)

#### kubi.writePanGoal(degrees)

pan の目標（首を向ける角度）を書き込みます。

目標を書き込み、首が動く時間を置いてから、位置を読み取ります。目標の約 1° 手前で止まるのは正常です。

```js
await kubi.writePanGoal(30);
await new Promise((resolve) => setTimeout(resolve, 2000));
const pan = await kubi.readPan();
console.log(pan.value.toFixed(1));   // "29.2"
```

[詳細とほかの例](../../docs/api.ja.md#kubiwritepangoaldegrees)

#### kubi.writeTiltGoal(degrees)

tilt の目標（首を傾ける角度）を書き込みます。

上へ 20° 傾け、その後に首の位置を読み取ります。

```js
await kubi.writeTiltGoal(20);
await new Promise((resolve) => setTimeout(resolve, 2000));
const tilt = await kubi.readTilt();
console.log(tilt.value.toFixed(1));   // "19.2"
```

[詳細とほかの例](../../docs/api.ja.md#kubiwritetiltgoaldegrees)

#### kubi.writePanSpeed(degreesPerSecond)

pan の速度を書き込みます。**本体がこの速度を使い始めるのは、次に目標を書き込んだときです。**

渡した値は、本体の刻みに合わせて丸められ、pan の速度の設定になります。次の目標の書き込みから使われます。

```js
await kubi.writePanSpeed(30);
console.log(kubi.speed.pan.toFixed(2));   // "29.97"
await kubi.writePanGoal(60);              // 約 30°/s で回ります
```

[詳細とほかの例](../../docs/api.ja.md#kubiwritepanspeeddegreespersecond)

#### kubi.writeTiltSpeed(degreesPerSecond)

tilt の速度を書き込みます。**本体がこの速度を使い始めるのは、次に目標を書き込んだときです。**

渡した値は tilt の速度の設定になります。次の tilt の目標の書き込みから使われます。

```js
await kubi.writeTiltSpeed(20);
console.log(kubi.speed.tilt.toFixed(2));   // "19.98"
await kubi.writeTiltGoal(30);              // 約 20°/s で傾きます
```

[詳細とほかの例](../../docs/api.ja.md#kubiwritetiltspeeddegreespersecond)

#### kubi.readPan()

pan の現在位置を本体から読み取ります。

結果には、角度、測定した時刻、測定からの経過時間が入っています。

```js
const pan = await kubi.readPan();
console.log(pan.value.toFixed(1));   // "29.2"
console.log(pan.observedAt);         // Date。測定した時刻
console.log(pan.ageMs);              // 0。時間が経つと増えていきます
```

[詳細とほかの例](../../docs/api.ja.md#kubireadpan)

#### kubi.readTilt()

tilt の現在位置を本体から読み取ります。

本体は 1 回の要求につき 1 軸ぶんしか答えません。両軸を知りたいときは、順に読み取ってください。

```js
const pan = await kubi.readPan();
const tilt = await kubi.readTilt();
console.log(pan.value.toFixed(1), tilt.value.toFixed(1));   // "29.2" "19.2"
```

[詳細とほかの例](../../docs/api.ja.md#kubireadtilt)

### Speed

#### kubi.speed

各軸の速度の設定です。`writePanSpeed` / `writeTiltSpeed` で最後に書き込んだ値を、本体の刻みに合わせて丸めたものです。

何も書き込んでいないあいだは、既定値の 60°/s を本体の刻みに合わせて丸めた値です。

```js
console.log(kubi.speed.pan.toFixed(2), kubi.speed.tilt.toFixed(2));   // "59.94" "59.94"
await kubi.writeTiltSpeed(20);
console.log(kubi.speed.pan.toFixed(2), kubi.speed.tilt.toFixed(2));   // "59.94" "19.98"
```

[詳細とほかの例](../../docs/api.ja.md#kubispeed)

### Status and device info

#### kubi.readBatteryVoltage()

バッテリーの電圧を読み取ります。

```js
const millivolts = await kubi.readBatteryVoltage();
console.log(millivolts);   // 3700
```

[詳細とほかの例](../../docs/api.ja.md#kubireadbatteryvoltage)

#### kubi.batteryStatus

本体が最後に報告したバッテリーの状態です。

```js
console.log(kubi.batteryStatus);   // { charging: false, low: false }
```

[詳細とほかの例](../../docs/api.ja.md#kubibatterystatus)

#### kubi.onBatteryStatusChange(callback)

`batteryStatus` の変化を購読します。

状態が変わったときにだけ呼び出されます。たとえば USB 電源をつないだときです。

```js
kubi.onBatteryStatusChange((status) => console.log(status));
// USB ケーブルをつなぐ
// { charging: true, low: false }
```

[詳細とほかの例](../../docs/api.ja.md#kubionbatterystatuschangecallback)

#### kubi.onServoFault(callback)

本体が報告するサーボの異常を購読します。

よく起きるのは `overload`（過負荷）です。回っている首を押さえると発生します。

```js
kubi.onServoFault((error) => console.log(error.axis, error.overload));
// 回っている首を手で押さえる
// "pan" true
```

[詳細とほかの例](../../docs/api.ja.md#kubionservofaultcallback)

#### kubi.buttonPressed

本体のボタンが押されているかどうかです。

```js
console.log(kubi.buttonPressed);   // false
```

[詳細とほかの例](../../docs/api.ja.md#kubibuttonpressed)

#### kubi.onButtonChange(callback)

本体のボタンが押されたとき、離されたときを購読します。

```js
kubi.onButtonChange((pressed) => console.log(pressed));
// ボタンを押して、離す
// true
// false
```

[詳細とほかの例](../../docs/api.ja.md#kubionbuttonchangecallback)

#### kubi.readDeviceInfo()

Device Information サービス（`0x180A`）を読み取ります。

```js
const info = await kubi.readDeviceInfo();
console.log(info.serialNumber);       // "EFC55E"
console.log(info.modelNumber);        // "iPre-K"
console.log(info.manufacturer);       // "iPresence Co., Ltd."
console.log(info.hardwareRevision);   // "1.0.0"
console.log(info.firmwareRevision);   // "1.1.1"
```

[詳細とほかの例](../../docs/api.ja.md#kubireaddeviceinfo)

### Diagnostics

#### kubi.onDiagnostic(callback)

ライブラリが送受信するすべてのデータを購読します。開発と不具合報告のためのものです。受け取った内容は記録するだけにし、処理の分岐には使わないでください。

目標の書き込み 1 回は、`write` イベント 1 つです。

```js
kubi.onDiagnostic((event) => {
  if (event.type === 'write') console.log(event.purpose, event.axis, event.bytes);
});
await kubi.writePanGoal(30);   // 出力: "goal" "pan" Uint8Array [2, 102]
```

[詳細とほかの例](../../docs/api.ja.md#kubiondiagnosticcallback)

## Angles and speeds

```
        −150°                 0°                +150°
  pan   左の端 ─────────── 正面 ─────────── 右の端   （向かい合っている人から見て）
  tilt  −20°（下） ──── 0°（水平） ──── +40°（上）
```

- 角度は**度**、速度は**度毎秒**です。`panRange`、`tiltRange`、`speedRange`、`defaultSpeed`（60°/s）を定数として公開しています。
- **範囲の外の角度は拒否されず、近いほうの端に丸められます。**
- **首は目標の約 1° 手前で止まります。** これは正常です（サーボの精度、重力、負荷によるものです）。首の位置は、読み取って確認してください。
- **速度は、次に目標を書き込んだときから使われます。** すでに回っている首の速さを変えるには、速度を書き込んでから、同じ目標をもう一度書き込んでください。
- **停止の命令はありません。** 別の場所へ向けたいときは、新しい目標を書き込んでください。
- 角度は約 0.29° 刻み、速度は約 0.67°/s 刻みに丸められます。そのため、書き込んだ値と読み取った値がわずかに異なることがあります。

## How failures come back

| 起きたこと | 返り方 |
|---|---|
| デバイスが選ばれなかった／接続できなかった | `connect()` の結果の値 |
| 接続されていない／接続が切れた／書き込みや読み取りに失敗した | **`KubiError`**（Promise が拒否されます）。`code` で区別できますが、対処は同じです |
| 引数が有限の数値でない、または速度が 0 以下 | `RangeError` |
| 可動範囲の外の角度 | 失敗ではありません。丸められます |
| `dispose()` の後に呼び出した | `KubiDisposedError` |

接続が切れたときの復旧は、呼び出しごとに書くのではなく、**`onConnectionChange` の 1 か所**にまとめてください。ライブラリが自動で再接続することはありません。

## What this version has been verified on

**1.0.0**

- 模擬デバイスに対して、約 180 本の自動テストを実行しています。この README と API リファレンスの例は、すべてその中に含まれています。模擬のサーボは、実機で測定した 2 つの性質を再現しています。速度は次の目標の書き込みから使われること、首は一定の割合で加速・減速することです。
- Kubi 2.0 の 1 台（ファームウェア 1.1.1）を、ライブラリを通さずに Bluetooth のツールで測定しました。速度が次の目標の書き込みから使われること、毎秒約 7 回の位置の要求を 1 分間続けても応答が欠けないことを確認しています。
- macOS の Chrome から、接続、首を押さえたときのサーボエラーの通知、USB の抜き差しによるバッテリー状態の通知を、同じ 1 台で確認しました（以前のビルドでの確認です）。現在の API をブラウザーから実機に対して動かす確認は、まだ行っていません。
- サーボエラーのキャラクタリスティックは、先頭の 1 バイトだけを解釈しています。2 バイト目の意味は仕様書で定義されていません。

## Where to read next

- [API リファレンス](../../docs/api.ja.md): すべてのメソッド、型、定数、エラー。引数、戻り値、失敗のしかたを載せています
- [ガイド](../../docs/guide.ja.md): API の背景にある考え方（位置の読み取り、首が止まるまで待つ方法、速度）と、困ったときの対処
- エディターのホバー表示（JSDoc）で、各メソッドの説明を読めます
- [`examples/`](../../examples/): メソッドごとの短いサンプルコード（1 メソッド 1 ファイル）と、それを実行するページです
- [`demo/`](../../demo/): 動作するデモページです。軸ごとに、書き込む値（入力）と読み取った値（出力）を表示します

## License

[MIT](./LICENSE) © iPresence Co., Ltd.
