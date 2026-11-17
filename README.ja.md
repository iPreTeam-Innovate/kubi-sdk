# kubi-sdk

**Kubi 2.0**（タブレットを載せる 2 軸の首振り装置）をブラウザから **Web Bluetooth** で操作するライブラリです。接続する、首を動かす、現在の向きと本体の状態を読み取る、の 3 つができます。

[English](./README.md)

## Requirements

- Web Bluetooth に対応したブラウザ: **Chrome、Edge** などの Chromium 系（デスクトップまたは Android）
- ページを **HTTPS または `localhost`** から配信すること
- **Kubi 2.0**。旧 Kubi（Mini USB 接続、Revolve Robotics 製）には対応していません

## Install

```sh
npm install kubi-sdk
```

## Shortest example

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

1 回の呼び出しが、本体への操作 1 つです。すべてのメソッドの例は[パッケージの README](./packages/js/README.ja.md#api)にあります。

## Documentation

- [パッケージの README](./packages/js/README.ja.md): できることと、すべてのメソッドの短い例
- [API リファレンス](./docs/api.ja.md): すべてのメソッド、型、定数、エラー。引数、戻り値、失敗のしかたを載せています
- [ガイド](./docs/guide.ja.md): 考え方（基本 API、位置の読み取り、首が止まるまで待つ方法、丸め、速度、動いている最中に行き先を変える方法）と、うまくいかないときの確認項目
- [サンプルコード](./examples/): メソッドごとの短いサンプル（1 メソッド 1 ファイル）と、それを実行するページ
- [デモ](./demo/): 実機に対して、書き込む値（入力）と読み取った値（出力）を表示するページ。どちらも `pnpm demo` で起動します
- [Changelog](./CHANGELOG.md)

## Running the demo

```sh
pnpm demo
```

パッケージをビルドしたあと、リポジトリを `localhost` で配信します。

- デモ: http://127.0.0.1:8571/demo/
- サンプルコード: http://127.0.0.1:8571/examples/

Web Bluetooth は secure context（HTTPS か `localhost`）でしか動かないため、`file://` では開けません。ポートを変えるときは環境変数 `PORT` を指定します。

## Repository layout

| パス | 内容 |
|---|---|
| `packages/js/` | npm パッケージ `kubi-sdk`（TypeScript。tsup でビルド） |
| `docs/` | API リファレンスとガイド |
| `examples/` | サンプルコード（1 メソッド 1 ファイル） |
| `demo/` | デモページ |
| `spec/vectors/` | プロトコルのバイト列テストベクター。他言語の実装と共有します |
| `tool/` | リポジトリの検査とデモサーバー |

## Contributing

セットアップ、検査、変更の規則は [CONTRIBUTING.md](./CONTRIBUTING.md)（英語）を参照してください。

## License

[MIT](./packages/js/LICENSE) © iPresence Co., Ltd.
