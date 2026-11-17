# kubi-sdk

Control the **Kubi 2.0** tablet stand (a two-axis pan/tilt neck) from the browser over **Web Bluetooth**: connect, move the neck, read where it points and how the device is doing.

[日本語](./README.ja.md)

## Requirements

- A browser with Web Bluetooth: **Chrome, Edge** or another Chromium-based browser, on desktop or Android
- The page served over **HTTPS or `localhost`**
- A **Kubi 2.0**. The original Kubi (Mini USB, Revolve Robotics) is not supported

## Install

```sh
npm install kubi-sdk
```

## Shortest example

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

Each call is one operation on the device. The [package README](./packages/js/README.md#api) lists every method with an example.

## Documentation

- [Package README](./packages/js/README.md): what the library does and every method with a short example
- [API reference](./docs/api.md): every method, type, constant and error, with parameters, return values and failures
- [Guide](./docs/guide.md): concepts (the basic API, reading the position, waiting until the neck stops, clamping, speed, changing the goal while the neck is moving) and troubleshooting
- [Examples](./examples/): one short sample file per method, and a page that runs them
- [Demo](./demo/): a page that shows, against a real Kubi, what you write (input) and what you read back (output). `pnpm demo` serves both
- [Changelog](./CHANGELOG.md)

## Running the demo

```sh
pnpm demo
```

This builds the package, then serves the repository on `localhost`:

- Demo: http://127.0.0.1:8571/demo/
- Examples: http://127.0.0.1:8571/examples/

Web Bluetooth only works in a secure context (HTTPS or `localhost`), so the pages cannot be opened from `file://`. Set `PORT` to use another port.

## Repository layout

| Path | Contents |
|---|---|
| `packages/js/` | The npm package `kubi-sdk` (TypeScript, built with tsup) |
| `docs/` | API reference and guide |
| `examples/` | Sample code, one file per method |
| `demo/` | Demo page |
| `spec/vectors/` | Byte-level test vectors for the protocol, shared with other language implementations |
| `tool/` | Repository checks and the demo server |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, checks and the rules for changes.

## License

[MIT](./packages/js/LICENSE) © iPresence Co., Ltd.
