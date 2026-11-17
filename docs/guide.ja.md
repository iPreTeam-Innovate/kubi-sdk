# kubi-sdk ガイド

API の背景にある考え方と、うまく動かないときの対処をまとめています。各メソッドの引数、戻り値、失敗のしかたは [API リファレンス](./api.ja.md)を参照してください。

[English](./guide.md)

例は、接続済みの `kubi`（[API リファレンスの「Setup」](./api.ja.md#setup)を参照）と、次の関数があることを前提にしています。

```js
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
```

## Concepts

### 1. The basic API

本体が受け付ける操作は、軸ごとに 3 つです。向かう先の目標位置、速度、現在位置の要求です。このリリースのライブラリは、それをそのまま、操作と軸ごとに 1 つずつのメソッドとして提供します。

| 操作 | pan | tilt |
|---|---|---|
| 目標を書き込む | `writePanGoal(degrees)` | `writeTiltGoal(degrees)` |
| 速度を書き込む | `writePanSpeed(degreesPerSecond)` | `writeTiltSpeed(degreesPerSecond)` |
| 現在位置を読み取る | `readPan()` | `readTilt()` |

1 回の呼び出しが本体への操作 1 つで、呼び出した順に送られます。

```js
await kubi.writePanSpeed(30);        // 書き込み 1 回
await kubi.writePanGoal(30);         // 書き込み 1 回。首が回り始めます
const pan = await kubi.readPan();    // 要求 1 回と応答 1 回
```

ライブラリが自分から何かを付け加えることはありません。何も呼び出さなければ、何も送りません。

```js
let count = 0;
kubi.onDiagnostic((event) => {
  if (event.type === 'write') count += 1;
});
await sleep(5000);
console.log(count);   // 0
```

首が止まるまで待つメソッドは、この 6 つを組み合わせて作り、今後のリリースで追加する予定です。それまでは、[3 節](#3-waiting-until-the-neck-stops)の方法で自分で待つことができます。

**スライダーに追従する。** 呼び出しはすべて送られ、書き込み 1 回には約 130 ミリ秒かかります。入力イベントのたびに `writePanGoal` を呼び出すと、呼び出しが順番待ちになり、首の動きが遅れていきます。前の書き込みが終わるのを待ち、最新の値だけを送ってください。

```js
let latest = null;
let busy = false;
panSlider.oninput = async () => {
  latest = Number(panSlider.value);
  if (busy) return;                 // 書き込み中。終わったときに latest が送られます
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

**本体が自分から位置を知らせてくることはありません。** 要求されたときにだけ答えます。その要求が `readPan()` / `readTilt()` です。読み取り 1 回が 1 往復で、約 130〜260 ミリ秒かかります。

返ってくるのは、過去のある時点の測定値です。どれだけ古いかは `ageMs` で分かります。

```js
const pan = await kubi.readPan();
console.log(pan.value.toFixed(1));   // "29.2"
await sleep(1000);
console.log(pan.ageMs);              // 約 1000。この値は 1 秒前のものになりました
```

本体は 1 回の要求につき 1 軸ぶんしか答えません。両軸は順に読み取ってください。2 つが同じ瞬間に測定されることはありません。

```js
const pan = await kubi.readPan();
const tilt = await kubi.readTilt();
console.log(tilt.observedAt - pan.observedAt > 0);   // true
```

繰り返し読み取る場合は、1 回ごとに `await` してください。待たずに `readPan()` を呼び出しても速くはならず、要求がライブラリの中で順番待ちになるだけです。本体は、毎秒約 7 回の要求を 1 分間続けても応答が欠けないことを確認しています。これはブラウザーから送れる最速の間隔です。

### 3. Waiting until the neck stops

`writePanGoal` が解決するのは、目標を書き込んだ時点です。首が着いた時点ではありません。

```js
await kubi.writePanGoal(60);   // すぐに解決します。首は回り始めています
```

待つには、位置が変わらなくなるまで読み取りを繰り返します。

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

このとき `pan` には、首が止まった位置が入っています。

```js
console.log(pan.value.toFixed(1));   // "59.1"
```

このループを書くときに知っておくことが 3 つあります。

- **首は目標の約 1° 手前で止まります。これは正常です**（サーボの精度、重力、負荷によるものです）。「目標と等しくなるまで」ではなく「変わらなくなるまで」待ってください。そうしないと、ループが終わらないことがあります。
- 手で押さえられた首や、可動範囲の端にある首も「止まった」と判定されます。着いたかどうかを知りたい場合は、位置と目標の差を自分の許容範囲と比べてください。
- 非常に遅い速度では、首が 200 ミリ秒で動く量が 0.5° より小さくなります。その場合は間隔を長くするか、しきい値を小さくしてください。

### 4. Clamping

`panRange` / `tiltRange` の外の角度は、エラーになりません。近いほうの端に丸めて書き込まれます。

```js
await kubi.writePanGoal(200);        // 150 として書き込まれます
await sleep(4000);
const pan = await kubi.readPan();
console.log(pan.value.toFixed(1));   // "149.1"
```

呼び出しそのものは、丸めたことを知らせません。丸めたことを知るには、診断を購読してください。

```js
kubi.onDiagnostic((event) => {
  if (event.type === 'clamped') console.log(event.requested, event.applied);
});
await kubi.writePanGoal(200);   // 出力: 200 150
```

意味を**持たない**値は、丸められずに拒否されます。`NaN`、無限大、0 以下の速度が該当します。

```js
await kubi.writePanGoal(NaN);   // RangeError で拒否されます
```

角度は本体の刻み（約 0.29°。300° を 1023 段階）に丸められます。そのため、書き込んだ目標と読み取った位置が、最大で 1 刻みぶん異なることがあります。`speedRange` の外の速度も、同じように丸められます。

### 5. Speed

`writePanSpeed` / `writeTiltSpeed` は、軸を回す速さを設定します。`kubi.speed` は、最後に書き込んだ値を本体の刻みに合わせて丸めたものを返します。本体から読み取った値ではありません。

```js
await kubi.writePanSpeed(30);
console.log(kubi.speed.pan.toFixed(2));   // "29.97"
```

**本体が新しい速度を使い始めるのは、次に目標を書き込んだときです。** 先に速度を書き込み、その後に目標を書き込んでください。

```js
await kubi.writePanSpeed(30);
await kubi.writePanGoal(60);    // 約 30°/s で回ります
```

首が回っている最中に速度を書き込んでも、それだけでは何も変わりません。同じ目標をもう一度書き込むと反映されます。

```js
await kubi.writePanGoal(60);    // それまでの速度で回っています
await kubi.writePanSpeed(20);   // まだそれまでの速度で回っています
await kubi.writePanGoal(60);    // ここから約 20°/s で回ります
```

何も書き込んでいないあいだは、両軸とも既定値の 60°/s です。設定は再接続しても保持され、`connect()` の途中でライブラリが本体に書き込み直します。

### 6. Changing the goal while the neck is moving

**本体に停止の命令はありません。** できるのは、新しい目標を書き込むことです。前の目標は忘れられ、首は新しい目標へ向かいます。

```js
await kubi.writePanGoal(90);     // 右へ回っています
await sleep(500);
await kubi.writePanGoal(-30);    // 左へ向きを変え、−30° へ向かいます
```

本体は、速度を一定の割合（約 68°/s²）でしか変えられません。そのため、回っている首はその場では止まれません。60°/s で回っている首が止まるには、約 1 秒と約 26° が必要です。

読み取ったばかりの位置を目標に書き込んでも、首がその位置で止まら**ない**のはこのためです。首はその位置を行き過ぎてから、戻ってきます。

```js
const pan = await kubi.readPan();
await kubi.writePanGoal(pan.value);   // 行き過ぎてから戻ります
```

戻らせずに止めるには、止まるのに必要な距離だけ先を目標に書き込みます。その距離は、速度（°/s）の 2 乗を 136 で割った値（度）です。

```js
const pan = await kubi.readPan();
const ahead = (60 * 60) / 136;                // 60°/s なら約 26°
await kubi.writePanGoal(pan.value + ahead);   // 右へ回っている場合。減速して、そこで止まります
```

これらはいずれも非常停止ではありません。首を入れてはいけない範囲がある場合は、書き込む目標のほうを制限してください。

## Troubleshooting

### Which browsers work

デスクトップと Android の Chrome、Edge などの Chromium 系ブラウザーで動作します。Safari と Firefox は Web Bluetooth を実装していません。ブラウザーに Web Bluetooth が無い場合、`bluetoothAvailability` は `unavailable` になります。Bluetooth がオフでも `unknown` のままのことがあるため、確定した情報として扱えるのは `unavailable` だけです。

### The page must be served over HTTPS or from localhost

Web Bluetooth はセキュアコンテキストでしか動作しません。`file://` で開いたページや、リモートホストから平文の `http://` で配信されたページでは、デバイス選択ダイアログが開きません。開発中は `localhost` から配信してください（リポジトリの `pnpm demo` はそのように動作します）。

### The device chooser does not open

ダイアログはユーザー操作の中からしか開けません。`connect()` はクリックやキー入力のハンドラー内で、**他の `await` より先に**呼び出してください。先に何かを `await` するとユーザー操作の扱いが失われ、`connect()` は `notSelected` で解決します。

### It does not connect to an older Kubi

このライブラリは Kubi 2.0 だけに対応しています。旧 Kubi にはライブラリが必要とするキャラクタリスティックが無いため、`connect()` は `couldNotConnect` で解決します。どの確認で失敗したかは `onDiagnostic` の `note` に出力されます。

### Servo error and a red light

動作中に首が妨げられると（手で押さえるなど）、サーボは過負荷を報告し、本体のランプが赤く点灯します。`onServoFault` が `overload: true` と軸の情報を伴って呼び出されます。保持中の首を手で押した場合にもエラーになることがあり、その場合は `inputVoltage` として報告されることがあります。

エラーは本体の**電源を入れ直す**まで残ります。エラーを解除する API も、解消を知らせる通知も無く、`onServoFault` はエラーが発生したことだけを知らせます。エラー中も首はコマンドを受け付けます。赤いランプを消すには、Kubi の電源を切って入れ直してください。

### It disconnects right after connecting

`connect()` が `couldNotConnect` で解決し、続いて `cause: 'connectFailed'` の `disconnected` が通知された場合は、初期同期の失敗です。ライブラリが時間内に位置を読み取れなかったか、速度を書き込めなかったことを意味します。よくある原因は次のとおりです。

- 別のアプリケーションやツールが同じ Kubi に接続していて、本体が応答しなくなった。そちらを閉じてやり直してください
- 接続処理の途中で本体の電源が切れた、または通信圏外に出た

`onDiagnostic` を購読して `note` イベントを確認してください。失敗した手順の名前が出力されます。再現できる場合は、その note をバグ報告に含めてください。
