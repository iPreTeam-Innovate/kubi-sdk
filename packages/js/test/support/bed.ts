/**
 * テストの土台。vitest の fake timers で時間を進める。
 *
 * ```ts
 * const bed = await makeBed();          // 繋いで初期同期まで済ませる
 * const m = bed.adv.moveTo({ pan: 45 });
 * await bed.elapse(3000);               // servo が動き、応答が届く
 * expect((await m).type).toBe('settled');
 * ```
 */
import { vi } from 'vitest';
import type { KubiEngine } from '../../src/engine/kubi-engine.js';
import { Kubi } from '../../src/kubi.js';
import type { Axis, AxisValues, DriveHalt, DriveOptions, MoveOptions, PanTilt, Snapshot, StayResult } from '../../src/types.js';
import { FakeTransport } from '../fake/fake-transport.js';

/** 止まった位置と目標の差として許す幅（度）。実機は 4 LSB（約 1.17°）手前で止まる。 */
export const reachSlackDeg = 1.6;

export class Bed {
  constructor(
    readonly transport: FakeTransport,
    readonly kubi: Kubi,
    private readonly engine: KubiEngine,
  ) {}

  /** 次回リリースで公開面へ戻す操作。今は engine にだけあるので、テストはここから呼ぶ。 */
  readonly adv = {
    snapshot: (): Snapshot => this.engine.snapshot(),
    onChange: (cb: (s: Snapshot) => void) => this.engine.onChange(cb),
    // engine が同期で投げる例外（未接続・使用終了後）も、公開面と同じく reject で返す。
    moveTo: async (g: AxisValues, o?: MoveOptions) => this.engine.moveTo(g, o),
    moveBy: async (d: AxisValues, o?: MoveOptions) => this.engine.moveBy(d, o),
    drive: async (o: DriveOptions) => this.engine.drive(o),
    stay: (async (axis?: Axis) => (axis === undefined ? this.engine.stay() : this.engine.stay(axis))) as {
      (): Promise<PanTilt<StayResult>>;
      (axis: Axis): Promise<StayResult>;
    },
    onDriveHalt: (cb: (h: DriveHalt) => void) => this.engine.onDriveHalt(cb),
  };

  /** 時間を進める。タイマーとマイクロタスクを流す。 */
  async elapse(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
  }

  /** マイクロタスクだけ流す。 */
  async flush(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
  }

  /** 繋いで `connected` まで待つ。 */
  async connect(): Promise<void> {
    const p = this.kubi.connect();
    await this.elapse(200);
    const r = await p;
    if (r.type !== 'connected') throw new Error(`接続できなかった: ${JSON.stringify(r)}`);
  }
}

/** fake timers を有効にし、fake transport と Kubi を組む。`connect: false` で未接続のまま。 */
export async function makeBed(opts: { connect?: boolean; transport?: FakeTransport } = {}): Promise<Bed> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  const transport = opts.transport ?? new FakeTransport();
  const kubi = new Kubi(transport);
  // engine は Kubi の private。テストだけがここで取り出す。
  const bed = new Bed(transport, kubi, (kubi as unknown as { engine: KubiEngine }).engine);
  if (opts.connect !== false) await bed.connect();
  return bed;
}

/** 結果を外から覗ける Promise。 */
export function probe<T>(p: Promise<T>): { readonly done: boolean; readonly value: T | undefined; readonly error: unknown; promise: Promise<T> } {
  const state = { done: false, value: undefined as T | undefined, error: undefined as unknown, promise: p };
  p.then(
    (v) => {
      state.done = true;
      state.value = v;
    },
    (e) => {
      state.done = true;
      state.error = e;
    },
  );
  return state;
}
