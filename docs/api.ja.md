# kubi-sdk API リファレンス

`kubi-sdk` が公開しているすべてのメンバーを、1 つずつ説明します。どの項目も同じ並びです。何をするか、引数、戻り値、実行結果が分かる短い例、失敗のしかた、の順に書いてあります。API の背景にある考え方は[ガイド](./guide.ja.md)を参照してください。

[English](./api.md)

## Setup

このページの例はすべて、次のコードを実行済みであることを前提にしています。各例では繰り返しません。

```js
import { Kubi } from 'kubi-sdk';

const kubi = Kubi.forBrowser();
connectButton.onclick = () => kubi.connect();   // クリックの中で呼び出す必要があります
```

コメントに示した値（デバイス名、シリアル番号、電圧）は、ある 1 台のものです。お使いの本体では異なります。

## Conventions

- **単位。** 角度は度、速度は度毎秒です。`pan` は向かい合っている人から見て右が正、`tilt` は上が正で、0° が正面／水平です。
- **1 回の呼び出しで、操作は 1 つ。** [Servo](#servo-basic-api) にある `write…` / `read…` メソッドは、1 回の呼び出しで本体への操作をちょうど 1 つ行います。何かを呼び出さない限り、ライブラリが本体と通信することはありません。首が止まるまで待つメソッドは、今後のリリースで追加する予定です。
- **購読メソッド**（`onXxx(callback)`）は、購読を解除する関数を返します。コールバックは非同期に呼び出され、コールバック内で例外が発生してもライブラリの動作には影響しません。購読は接続が切れても維持され、`dispose()` を呼び出したときにだけ終了します。
- **「通信: あり」** と記したメソッドは Bluetooth 経由で本体にデータを送るため、`KubiError` で拒否（reject）されることがあります。それ以外はローカルで完結します。
- **不正な引数**（有限の数値でない、速度が 0 以下）を渡すと、`RangeError` で拒否されます。可動範囲の外の角度はエラーにならず、範囲内に**丸められます**。

## Kubi

1 つの `Kubi` インスタンスが 1 台の Kubi に対応します。一度作成したら、ページが存在するあいだ同じインスタンスを保持してください。

### Kubi.forBrowser()

Web Bluetooth を使うインスタンスを作成します。

- **引数**: なし
- **戻り値**: `Kubi`
- **通信**: なし
- **失敗**: `import { Kubi } from 'kubi-sdk'` 以外の経路で `Kubi` をインポートした場合は `Error` が発生します

作成した直後は、まだ接続されていません。

```js
const kubi = Kubi.forBrowser();
console.log(kubi.connectionState);   // "disconnected"
```

### new Kubi(transport)

独自のトランスポートを使うインスタンスを作成します。テストや、Web Bluetooth 以外のトランスポートを実装する場合に使います。通常のアプリケーションでは `Kubi.forBrowser()` を使ってください。

| 引数 | 型 | 説明 |
|---|---|---|
| `transport` | `KubiTransport` | [トランスポートのインターフェイス](#transport-interfaces)を実装したもの |

- **戻り値**: `Kubi`
- **通信**: なし

インスタンスは、渡したトランスポートが提供する機能をそのまま返します。

```js
const kubi = new Kubi(myTransport);
console.log(kubi.capabilities);   // { providesDevicePicker: true, canScan: false }
```

## Connection

### kubi.capabilities

トランスポートが提供する機能です。プラットフォーム名ではなく、この値で処理を分岐してください。

- **型**: `{ providesDevicePicker: boolean, canScan: boolean }`
- **通信**: なし

Web Bluetooth では、デバイス選択ダイアログをブラウザーが表示します。周囲のデバイスの一覧は取得できません。

```js
console.log(kubi.capabilities);   // { providesDevicePicker: true, canScan: false }
```

### kubi.connectionState

現在の接続状態です。

- **型**: `'disconnected' | 'connecting' | 'connected'`
- **通信**: なし

`connect()` が完了すると `connected` になります。

```js
console.log(kubi.connectionState);   // "disconnected"
await kubi.connect();
console.log(kubi.connectionState);   // "connected"
```

### kubi.device

接続中のデバイスです。

- **型**: `{ id: string, name: string | null }`。未接続のあいだは `null`
- **通信**: なし

`name` は表示用です。`id` は不透明な識別子で、同じアプリケーション・同じブラウザーの中でのみ安定します。

```js
console.log(kubi.device);   // { id: "kubi-0001", name: "kubi000012AB01" }
await kubi.disconnect();
console.log(kubi.device);   // null
```

### kubi.bluetoothAvailability

現在 Bluetooth を利用できるかどうかです。

- **型**: `'available' | 'unavailable' | 'unknown'`
- **通信**: なし

`unknown` は、ブラウザーが答えなかったことを表します。確実だと見なせるのは `unavailable` が返ったときだけです。

```js
console.log(kubi.bluetoothAvailability);   // "available"
```

### kubi.connect()

ブラウザーのデバイスダイアログを開き、ユーザーが選んだ Kubi に接続します。

- **引数**: なし
- **戻り値**: `Promise<ConnectResult>`。[`ConnectResult`](#connectresult) を参照してください
- **通信**: あり
- **失敗**: トランスポートがデバイス選択ダイアログを持たない場合は `KubiUnsupportedError`。それ以外の失敗は例外ではなく、結果の値として返ります

クリックのハンドラーの中で、ほかの `await` より前に呼び出してください。そうしないと、ブラウザーがダイアログを開きません。

```js
connectButton.onclick = async () => {
  const result = await kubi.connect();
  console.log(result);   // { type: "connected" }
};
```

ユーザーがデバイスを選ばずにダイアログを閉じた場合も、Promise は解決します。

```js
const result = await kubi.connect();
console.log(result);   // { type: "notConnected", reason: "notSelected" }
```

| `result.type` | `result.reason` | 意味 |
|---|---|---|
| `'connected'` | — | 使える状態です |
| `'notConnected'` | `'notSelected'` | ユーザーがダイアログを閉じた、またはダイアログを開けなかった |
| `'notConnected'` | `'couldNotConnect'` | デバイスは選ばれたが、接続できなかった |
| `'notConnected'` | `'connectionInProgress'` | 別の `connect()` がまだ進行中 |
| `'notConnected'` | `'alreadyConnected'` | すでに接続済み。先に `disconnect()` を呼び出してください |

接続の途中で、ライブラリは速度の設定を本体に書き込みます。そのため `kubi.speed` は、本体が実際に使う値と一致します。

### kubi.disconnect()

接続を切断します。

- **引数**: なし
- **戻り値**: `Promise<void>`。切断が完了した時点で解決します
- **通信**: なし。接続を閉じるだけです
- **失敗**: ありません。未接続のときに呼び出しても問題ありません

購読は維持されるため、同じインスタンスでもう一度 `connect()` を呼び出せます。

```js
await kubi.disconnect();
console.log(kubi.connectionState);   // "disconnected"
```

### kubi.dispose()

インスタンスを解放します。接続を切断し、すべての購読を終了します。元に戻すことはできません。

- **引数**: なし
- **戻り値**: `Promise<void>`
- **通信**: なし。接続を閉じるだけです

インスタンスを持っているページやコンポーネントが破棄されるときに呼び出してください。以後の呼び出しはすべて失敗します。

```js
await kubi.dispose();
await kubi.readPan();   // KubiDisposedError で拒否されます
```

### kubi.onConnectionChange(callback)

`connectionState` の変化を購読します。

| 引数 | 型 | 説明 |
|---|---|---|
| `callback` | `(change) => void` | [`ConnectionChange`](#connectionchange) を受け取ります |

- **戻り値**: 購読を解除する関数
- **通信**: なし

接続してから切断すると、変化が 3 回届きます。

```js
kubi.onConnectionChange((change) => console.log(change));
await kubi.connect();
// { state: "connecting" }
// { state: "connected" }
await kubi.disconnect();
// { state: "disconnected", cause: "byApp" }
```

本体の電源が切れたり、通信圏外に出たりすると、`cause` は `linkLost` になります。ライブラリが自動で再接続することはないので、ここでボタンを表示してください。

```js
kubi.onConnectionChange((change) => {
  if (change.state === 'disconnected' && change.cause === 'linkLost') {
    reconnectButton.hidden = false;   // connect() にはクリックが必要です
  }
});
```

戻り値の関数を呼び出すと、変化が届かなくなります。

```js
const unsubscribe = kubi.onConnectionChange((change) => console.log(change));
unsubscribe();   // これ以降は何も出力されません
```

### kubi.onBluetoothAvailabilityChange(callback)

`bluetoothAvailability` の変化を購読します。未接続のあいだも呼び出されます。

| 引数 | 型 | 説明 |
|---|---|---|
| `callback` | `(availability) => void` | `'available'`、`'unavailable'`、`'unknown'` のいずれかを受け取ります |

- **戻り値**: 購読を解除する関数
- **通信**: なし

接続ボタンの有効／無効を切り替えるのに使えます。

```js
kubi.onBluetoothAvailabilityChange((availability) => console.log(availability));
// ユーザーが Bluetooth をオフにする
// "unavailable"
```

## Servo (basic API)

1 回の呼び出しが本体への操作 1 つに対応する、6 つのメソッドです。1 軸について、目標を書き込む、速度を書き込む、位置を読み取る、のいずれかを行います。首が動くのを待つことも、自分から何かを読み取ることもありません。呼び出しは呼び出した順に 1 つずつ送られ、省かれたりまとめられたりすることはありません。

### kubi.writePanGoal(degrees)

pan の目標（首を向ける角度）を書き込みます。

| 引数 | 型 | 説明 |
|---|---|---|
| `degrees` | `number` | −150〜150。向かい合っている人から見て右が正です。範囲の外の値は丸められます |

- **戻り値**: `Promise<void>`。本体が目標を受け取った時点で解決します。首が着くのは待ちません
- **通信**: あり。書き込み 1 回（約 130 ミリ秒）
- **失敗**: 有限の数値でない値は `RangeError`。未接続、または書き込みに失敗した場合は `KubiError`

目標を書き込み、首が動く時間を置いてから、位置を読み取ります。目標の約 1° 手前で止まるのは正常です。

```js
await kubi.writePanGoal(30);
await new Promise((resolve) => setTimeout(resolve, 2000));
const pan = await kubi.readPan();
console.log(pan.value.toFixed(1));   // "29.2"
```

範囲の外の角度は、範囲の端の値として書き込まれます。丸めたことは診断で確認できます。

```js
kubi.onDiagnostic((event) => {
  if (event.type === 'clamped') console.log(event.requested, event.applied);
});
await kubi.writePanGoal(200);   // 出力: 200 150
```

首が動いている最中に新しい目標を書き込むと、前の目標が置き換わるだけです。スライダーに追従させる場合は、[ガイドの「スライダーに追従する」](./guide.ja.md#1-the-basic-api)を参照してください。

### kubi.writeTiltGoal(degrees)

tilt の目標（首を傾ける角度）を書き込みます。

| 引数 | 型 | 説明 |
|---|---|---|
| `degrees` | `number` | −20〜40。上が正です。範囲の外の値は丸められます |

- **戻り値**: `Promise<void>`。本体が目標を受け取った時点で解決します。首が着くのは待ちません
- **通信**: あり。書き込み 1 回（約 130 ミリ秒）
- **失敗**: 有限の数値でない値は `RangeError`。未接続、または書き込みに失敗した場合は `KubiError`

上へ 20° 傾け、その後に首の位置を読み取ります。

```js
await kubi.writeTiltGoal(20);
await new Promise((resolve) => setTimeout(resolve, 2000));
const tilt = await kubi.readTilt();
console.log(tilt.value.toFixed(1));   // "19.2"
```

範囲より上の角度は、40 として書き込まれます。

```js
kubi.onDiagnostic((event) => {
  if (event.type === 'clamped') console.log(event.requested, event.applied);
});
await kubi.writeTiltGoal(90);   // 出力: 90 40
```

### kubi.writePanSpeed(degreesPerSecond)

pan の速度を書き込みます。**本体がこの速度を使い始めるのは、次に目標を書き込んだときです。**

| 引数 | 型 | 説明 |
|---|---|---|
| `degreesPerSecond` | `number` | 約 0.67〜104。0 より大きい値。範囲の外の値は丸められます |

- **戻り値**: `Promise<void>`。本体が速度を受け取った時点で解決します
- **通信**: あり。書き込み 1 回（約 130 ミリ秒）
- **失敗**: 0、負の値、有限の数値でない値は `RangeError`。未接続、または書き込みに失敗した場合は `KubiError`

渡した値は、本体の刻みに合わせて丸められ、pan の速度の設定になります。次の目標の書き込みから使われます。

```js
await kubi.writePanSpeed(30);
console.log(kubi.speed.pan.toFixed(2));   // "29.97"
await kubi.writePanGoal(60);              // 約 30°/s で回ります
```

速度を書き込んだだけでは、動いている首の速さは変わりません。同じ目標をもう一度書き込むと反映されます。

```js
await kubi.writePanGoal(60);    // それまでの速度で回っています
await kubi.writePanSpeed(20);   // まだそれまでの速度で回っています
await kubi.writePanGoal(60);    // ここから約 20°/s で回ります
```

速度 0 は拒否されます。停止の命令はありません。[ガイドの「動いている最中に行き先を変える」](./guide.ja.md#6-changing-the-goal-while-the-neck-is-moving)を参照してください。

```js
await kubi.writePanSpeed(0);   // RangeError で拒否されます
```

設定は再接続しても保持され、`connect()` の途中で本体に書き込み直されます。

### kubi.writeTiltSpeed(degreesPerSecond)

tilt の速度を書き込みます。**本体がこの速度を使い始めるのは、次に目標を書き込んだときです。**

| 引数 | 型 | 説明 |
|---|---|---|
| `degreesPerSecond` | `number` | 約 0.67〜104。0 より大きい値。範囲の外の値は丸められます |

- **戻り値**: `Promise<void>`。本体が速度を受け取った時点で解決します
- **通信**: あり。書き込み 1 回（約 130 ミリ秒）
- **失敗**: 0、負の値、有限の数値でない値は `RangeError`。未接続、または書き込みに失敗した場合は `KubiError`

渡した値は tilt の速度の設定になります。次の tilt の目標の書き込みから使われます。

```js
await kubi.writeTiltSpeed(20);
console.log(kubi.speed.tilt.toFixed(2));   // "19.98"
await kubi.writeTiltGoal(30);              // 約 20°/s で傾きます
```

### kubi.readPan()

pan の現在位置を本体から読み取ります。

- **引数**: なし
- **戻り値**: `Promise<Observed>`。[`Observed`](#observed) を参照してください
- **通信**: あり。要求 1 回と応答 1 回（約 130〜260 ミリ秒）
- **失敗**: 未接続のとき、接続が切れたとき、本体が応答しなかったときは `KubiError`

結果には、角度、測定した時刻、測定からの経過時間が入っています。

```js
const pan = await kubi.readPan();
console.log(pan.value.toFixed(1));   // "29.2"
console.log(pan.observedAt);         // Date。測定した時刻
console.log(pan.ageMs);              // 0。時間が経つと増えていきます
```

接続していないときは拒否されます。

```js
try {
  await kubi.readPan();
} catch (error) {
  console.log(error.code);   // "noLink"
}
```

本体が自分から位置を知らせてくることはありません。首の位置を知る方法は、この呼び出し（と `readTilt()`）だけです。

### kubi.readTilt()

tilt の現在位置を本体から読み取ります。

- **引数**: なし
- **戻り値**: `Promise<Observed>`。[`Observed`](#observed) を参照してください
- **通信**: あり。要求 1 回と応答 1 回（約 130〜260 ミリ秒）
- **失敗**: 未接続のとき、接続が切れたとき、本体が応答しなかったときは `KubiError`

本体は 1 回の要求につき 1 軸ぶんしか答えません。両軸を知りたいときは、順に読み取ってください。

```js
const pan = await kubi.readPan();
const tilt = await kubi.readTilt();
console.log(pan.value.toFixed(1), tilt.value.toFixed(1));   // "29.2" "19.2"
```

2 つの値は、別々の時刻に測定されたものです。両軸をまとめて読み取るメソッドはありません。

## Speed

### kubi.speed

各軸の速度の設定です。`writePanSpeed` / `writeTiltSpeed` で最後に書き込んだ値を、本体の刻みに合わせて丸めたものです。

- **型**: `{ pan: number, tilt: number }`。単位は度毎秒
- **通信**: なし。本体からは読み取りません。本体が返すのは、書き込んだ値そのものだからです

何も書き込んでいないあいだは、既定値の 60°/s を本体の刻みに合わせて丸めた値です。

```js
console.log(kubi.speed.pan.toFixed(2), kubi.speed.tilt.toFixed(2));   // "59.94" "59.94"
await kubi.writeTiltSpeed(20);
console.log(kubi.speed.pan.toFixed(2), kubi.speed.tilt.toFixed(2));   // "59.94" "19.98"
```

## Status and device info

### kubi.readBatteryVoltage()

バッテリーの電圧を読み取ります。

- **引数**: なし
- **戻り値**: `Promise<number>`。単位はミリボルト
- **通信**: あり
- **失敗**: 未接続のとき、または本体がこの値を提供していないときは `KubiError`

```js
const millivolts = await kubi.readBatteryVoltage();
console.log(millivolts);   // 3700
```

残量のパーセント表示は提供していません。本体の放電特性が公開されていないためです。

### kubi.batteryStatus

本体が最後に報告したバッテリーの状態です。

- **型**: `{ charging: boolean, low: boolean }`。未接続のあいだ、または本体が報告しない場合は `null`
- **通信**: なし

```js
console.log(kubi.batteryStatus);   // { charging: false, low: false }
```

### kubi.onBatteryStatusChange(callback)

`batteryStatus` の変化を購読します。

| 引数 | 型 | 説明 |
|---|---|---|
| `callback` | `(status) => void` | `{ charging: boolean, low: boolean }` を受け取ります |

- **戻り値**: 購読を解除する関数
- **通信**: なし

状態が変わったときにだけ呼び出されます。たとえば USB 電源をつないだときです。

```js
kubi.onBatteryStatusChange((status) => console.log(status));
// USB ケーブルをつなぐ
// { charging: true, low: false }
```

### kubi.onServoFault(callback)

本体が報告するサーボの異常を購読します。

| 引数 | 型 | 説明 |
|---|---|---|
| `callback` | `(error) => void` | [`ServoFault`](#servofault) を受け取ります |

- **戻り値**: 購読を解除する関数
- **通信**: なし

よく起きるのは `overload`（過負荷）です。回っている首を押さえると発生します。

```js
kubi.onServoFault((error) => console.log(error.axis, error.overload));
// 回っている首を手で押さえる
// "pan" true
```

エラーが解消したことを知らせるイベントはなく、エラーを消す操作もありません。本体のエラーは、電源を入れ直すまで残ります。

### kubi.buttonPressed

本体のボタンが押されているかどうかです。

- **型**: `boolean`。未接続のあいだ、または本体が報告しない場合は `null`
- **通信**: なし

```js
console.log(kubi.buttonPressed);   // false
```

### kubi.onButtonChange(callback)

本体のボタンが押されたとき、離されたときを購読します。

| 引数 | 型 | 説明 |
|---|---|---|
| `callback` | `(pressed: boolean) => void` | 押したときは `true`、離したときは `false` |

- **戻り値**: 購読を解除する関数
- **通信**: なし

```js
kubi.onButtonChange((pressed) => console.log(pressed));
// ボタンを押して、離す
// true
// false
```

長押しやダブルクリックの判定は行いません。

### kubi.readDeviceInfo()

Device Information サービス（`0x180A`）を読み取ります。

- **引数**: なし
- **戻り値**: `Promise<DeviceInfo>`。[`DeviceInfo`](#deviceinfo) を参照してください。本体が提供していない項目は `null` です
- **通信**: あり
- **失敗**: 未接続のときは `KubiError`

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

ライブラリが送受信するすべてのデータを購読します。開発と不具合報告のためのものです。受け取った内容は記録するだけにし、処理の分岐には使わないでください。

| 引数 | 型 | 説明 |
|---|---|---|
| `callback` | `(event) => void` | [`DiagnosticEvent`](#diagnosticevent) を受け取ります |

- **戻り値**: 購読を解除する関数
- **通信**: なし。購読者がいないあいだは、何も生成されません

目標の書き込み 1 回は、`write` イベント 1 つです。

```js
kubi.onDiagnostic((event) => {
  if (event.type === 'write') console.log(event.purpose, event.axis, event.bytes);
});
await kubi.writePanGoal(30);   // 出力: "goal" "pan" Uint8Array [2, 102]
```

読み取り 1 回は、`write`（要求）と、それに続く `frame`（本体の応答）です。

```js
kubi.onDiagnostic((event) => console.log(event.type));
await kubi.readPan();
// "write"
// "frame"
```

## Types

TypeScript から利用する場合は、同梱の型定義から同じ型が得られます。ここでは型をオブジェクトリテラルで示します。`A | B` はどちらか一方を表します。

### Axis

```js
'pan' | 'tilt'
```

`ServoFault.axis` と `DiagnosticEvent.axis` に現れます。

### Observed

```js
{ value: number, observedAt: Date, ageMs: number }
```

測定した角度と、その測定時刻です。`ageMs` は参照するたびに計算されるため、オブジェクトを保持しているあいだ増え続けます。

```js
const pan = await kubi.readPan();
console.log(pan.ageMs);   // 0
await new Promise((resolve) => setTimeout(resolve, 1000));
console.log(pan.ageMs);   // 約 1000
```

### PanTilt

```js
{ pan: T, tilt: T }
```

軸ごとに 1 つずつの値です。`kubi.speed` は数値の `PanTilt` です。

### Range

```js
{ min: number, max: number }
```

`panRange`、`tiltRange`、`speedRange` の形です。両端の値を含みます。

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

| 値 | 意味 |
|---|---|
| `byApp` | `disconnect()` または `dispose()` を呼び出した |
| `connectFailed` | `connect()` が完了しなかった |
| `linkLost` | 本体が通信圏外に出た、または電源が切れた |

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

それぞれが返る場面は [`connect()`](#kubiconnect) を参照してください。

### BatteryStatus

```js
{ charging: boolean, low: boolean }
```

### ServoFault

```js
{ axis: Axis | null, inputVoltage: boolean, overheating: boolean, electricalShock: boolean, overload: boolean, at: Date }
```

`axis` は異常が報告された軸です。本体が軸を示さなかった場合は `null` です。`at` は通知を受け取った時刻です。

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

| `type` | 意味 |
|---|---|
| `write` | 本体へ送ったデータ。`ok` は本体が受け取ったかどうかです |
| `frame` | 本体から届いた通知。位置の要求への応答などです |
| `read` | 本体から読み取った値。バッテリーの電圧などです。読み取りに失敗した場合、`bytes` は `null` です |
| `clamped` | 渡した値が範囲の外にあり、範囲内に丸められた |
| `note` | ライブラリ内部からの自由形式のメッセージ |

`characteristic` は GATT キャラクタリスティックの UUID です。

### WritePurpose

```js
'goal' | 'speed' | 'brake' | 'hold' | 'readRequest' | 'notifyEnable'
```

| 値 | 意味 |
|---|---|
| `goal` | 目標の書き込み（`writePanGoal` / `writeTiltGoal`） |
| `speed` | 速度の書き込み（`writePanSpeed` / `writeTiltSpeed`。接続の途中にも軸ごとに 1 回） |
| `readRequest` | 位置の要求（`readPan` / `readTilt`） |
| `notifyEnable` | 接続の途中に 1 回だけ発生します |
| `brake`、`hold` | このリリースでは発生しません |

### Transport interfaces

```js
KubiTransport, KubiLink, TransportCapabilities, PickResult, PickFailure, TransportError
```

ライブラリが本体と通信する方法を表す型です。`new Kubi(transport)` に渡す独自のトランスポートを実装する人のために公開しています。詳細は同梱の型定義を参照してください。Web Bluetooth を使うアプリケーションが触れることはありません。

## Constants

### panRange

pan の可動範囲です。単位は度です。

```js
import { panRange } from 'kubi-sdk';
console.log(panRange);   // { min: -150, max: 150 }
```

### tiltRange

tilt の可動範囲です。単位は度です。

```js
import { tiltRange } from 'kubi-sdk';
console.log(tiltRange);   // { min: -20, max: 40 }
```

### speedRange

受け付ける速度の範囲です。単位は度毎秒です。上限は本体が動作を保証する最大の速度です。この範囲の値は受け付けますが、その速度が実際に出ることは保証しません。

```js
import { speedRange } from 'kubi-sdk';
console.log(speedRange.min.toFixed(2), speedRange.max.toFixed(1));   // "0.67" "103.9"
```

### defaultSpeed

何も書き込んでいないときの、両軸の速度の設定です。単位は度毎秒です。

```js
import { defaultSpeed } from 'kubi-sdk';
console.log(defaultSpeed);   // 60
```

## Errors

### KubiError

通常の利用の中で起こり得る失敗です。「通信: あり」と記したすべてのメソッドが、このエラーで拒否されることがあります。

| `code` | 意味 |
|---|---|
| `noLink` | 接続されていない |
| `linkLost` | 操作の途中で接続が切れた |
| `writeFailed` | 本体への書き込みに失敗した |
| `readFailed` | 読み取り、または位置の要求に対して、使える応答が得られなかった |

`code` が何であっても、対処は同じです。進めていた処理を中断し、再接続は `onConnectionChange` に任せてください。

```js
try {
  await kubi.writePanGoal(30);
} catch (error) {
  if (error instanceof KubiError) console.log(error.code);   // "noLink"
}
```

### KubiDisposedError

`dispose()` の後に何かを呼び出すと発生します。呼び出し側のコードの誤りです。

```js
await kubi.dispose();
await kubi.readPan();   // KubiDisposedError で拒否されます
```

### KubiUnsupportedError

トランスポートが対応していない操作を呼び出すと発生します。先に `capabilities` を確認してください。

```js
const kubi = new Kubi(transportWithoutChooser);
console.log(kubi.capabilities.providesDevicePicker);   // false
await kubi.connect();                                  // KubiUnsupportedError で拒否されます
```

### RangeError

意味を持たない引数を渡すと、このエラーで拒否されます。有限の数値でない値、0 以下の速度が該当します。可動範囲の外の角度はエラーには**なりません**。丸められます。

```js
await kubi.writePanSpeed(-1);         // RangeError で拒否されます
await kubi.writeTiltGoal(Infinity);   // RangeError で拒否されます
await kubi.writePanGoal(999);         // 解決します。150 として書き込まれます
```
