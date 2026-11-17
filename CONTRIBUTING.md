# Contributing to kubi-sdk

Thank you for taking the time. This page covers how to set the repository up, what must pass before a change is merged, and the few structural rules the code follows.

## Setup

Requirements: Node.js 20 or later and pnpm 10. The repository pins its pnpm version in `package.json`, so `corepack enable` is enough.

Clone the repository, then:

```sh
cd kubi-sdk
pnpm install
pnpm -r check
pnpm build
```

`pnpm -r check` runs, in order, the TypeScript type check, the test suite (vitest), a layer-isolation check and a JSDoc check. It stops at the first failure and exits non-zero. `pnpm build` produces `packages/js/dist/`.

## Layout

| Path | Contents |
|---|---|
| `packages/js/src/kubi.ts`, `types.ts`, `errors.ts`, `values.ts`, `index.ts` | Public surface. JSDoc here is written in English and reaches users through the type definitions |
| `packages/js/src/engine/` | Control loop, state, stop handling, observation, initial synchronization. Knows nothing about the DOM or Bluetooth APIs |
| `packages/js/src/protocol/` | Pure functions between values and byte frames |
| `packages/js/src/transport/` | The only code that touches `navigator.bluetooth` |
| `packages/js/test/` | Tests, with a deterministic fake transport and servo in `test/fake/` |
| `spec/vectors/protocol.json` | Byte-level reference vectors, language independent |
| `examples/` | Sample code, one file per public member, and `index.html` that runs them |
| `demo/` | Demo and manual verification page, and a page that renders `docs/` |
| `tool/` | `check.ts` (the checks above) and `serve-demo.ts` |

## Rules the checks enforce

- **Layer isolation.** `engine/`, `protocol/`, `kubi.ts` and `types.ts` must not reference the DOM or Web Bluetooth. Only `transport/` may. The check greps for the relevant identifiers.
- **JSDoc on the public surface.** Every public member of `Kubi` needs a doc comment; your editor's hover is the day-to-day API documentation.
- **One write in flight.** The engine never issues two GATT writes concurrently. The fake transport records overlapping writes and tests assert the list is empty.
- **No speed of zero.** The servo treats a speed register of `0` as "no limit", so the library never writes it. The fake transport records any such write and tests assert there are none.

## Making a change

1. Add or adjust a test first. Behavioural tests live next to the capability they cover (`move.test.ts`, `stop.test.ts`, ...). Tests whose name starts with an identifier such as `M1:` or `S2:` pin a specific communication sequence; keep the identifier if you edit the test.
2. Keep comments about *what* the code does and *why it breaks otherwise*. Do not reference files outside the repository.
3. Run `pnpm -r check` and `pnpm build`.
4. If the change affects the protocol bytes, update `spec/vectors/protocol.json` as well; `test/vectors.test.ts` pins the implementation to it.
5. Add a line under `[Unreleased]` in `CHANGELOG.md`.

## Verifying on a real device

Unit tests run against a simulated device. Anything that touches timing, the Web Bluetooth transport or the initial handshake should also be tried on a real Kubi 2.0:

```sh
pnpm demo        # builds the package and serves http://127.0.0.1:8571/demo/ (and /examples/)
```

Open the URL in Chrome, connect, and exercise the relevant section of the page. The page's labels are in Japanese. The diagnostics checkbox (診断) logs every byte sent and received; the save button (ログを保存) downloads the log for attaching to an issue or pull request.

While the demo page is connected, do not connect to the same Kubi from another tool. A second connection can make the device stop answering the first.

## Pull requests

- One topic per pull request.
- Describe what changed and how you verified it, including whether it was tried on a real device.
- Public API changes need a matching update to `docs/api.md`, `docs/api.ja.md` and the package README.
