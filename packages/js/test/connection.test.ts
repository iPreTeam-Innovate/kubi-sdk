/** `connection` capability の Scenario 写し。 */
import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { makeBed, probe } from './support/bed.js';
import { FakeTransport } from './fake/fake-transport.js';
import { KubiDisposedError, KubiUnsupportedError } from '../src/errors.js';
import type { ConnectionChange } from '../src/types.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('connection', () => {
  it('picker から選んで繋がる → connected で、present は既知・goal は未知', async () => {
    const bed = await makeBed();
    expect(bed.kubi.connectionState).toBe('connected');
    const s = bed.adv.snapshot();
    expect(s.pan.present).not.toBeNull();
    expect(s.pan.goal).toBeNull();
    expect(s.pan.motion).toBe('idle');
    expect(bed.kubi.device).toEqual({ id: 'kubi-0001', name: 'kubi000012AB01' });
  });

  it('K1: 接続の通信列は pan読み取り → tilt読み取り → pan速さ → tilt速さ', async () => {
    const bed = await makeBed();
    const { describeWrite } = await import('./fake/fake-transport.js');
    expect(bed.transport.writes.map(describeWrite)).toEqual(['pan読み取り', 'tilt読み取り', 'pan速さ', 'tilt速さ']);
  });

  it('初期同期: 応答が要求の ACK より先に届いても、次の要求は ACK を待ってから書く（Chrome / macOS で実測した順序）', async () => {
    const t = new FakeTransport();
    t.onLinkOpened = (l) => {
      l.responseBeforeAck = true;
      l.ackDelayMs = 60; // 応答（20ms）より ACK（60ms）が遅い
    };
    const bed = await makeBed({ connect: false, transport: t });
    const p = bed.kubi.connect();
    await bed.elapse(1000); // 4 本の書き込み × 60ms の ACK を越える時間
    expect((await p).type).toBe('connected');
    expect(bed.transport.link!.overlappingWrites).toEqual([]);
  });

  it('picker を閉じて何も選ばない → notSelected、状態は disconnected（例外ではない）', async () => {
    const bed = await makeBed({ connect: false });
    bed.transport.pickerResult = null;
    const p = bed.kubi.connect();
    await bed.elapse(10);
    expect(await p).toEqual({ type: 'notConnected', reason: 'notSelected' });
    expect(bed.kubi.connectionState).toBe('disconnected');
  });

  it('選んだが繋がらなかった → couldNotConnect と区別できる', async () => {
    const bed = await makeBed({ connect: false });
    bed.transport.unreachable = true;
    const p = bed.kubi.connect();
    await bed.elapse(10);
    expect(await p).toEqual({ type: 'notConnected', reason: 'couldNotConnect' });
  });

  it('旧 kubi（9147 が無い）には繋がない', async () => {
    const t = new FakeTransport();
    t.missing.add('readResponse');
    const bed = await makeBed({ connect: false, transport: t });
    const p = bed.kubi.connect();
    await bed.elapse(10);
    expect(await p).toEqual({ type: 'notConnected', reason: 'couldNotConnect' });
  });

  it('繋がっている間に connect を呼ぶ → picker は開かず alreadyConnected', async () => {
    const bed = await makeBed();
    const before = bed.transport.pickerOpenCount;
    expect(await bed.kubi.connect()).toEqual({ type: 'notConnected', reason: 'alreadyConnected' });
    expect(bed.transport.pickerOpenCount).toBe(before);
  });

  it('接続処理中に connect を呼ぶ → connectionInProgress', async () => {
    const bed = await makeBed({ connect: false });
    bed.transport.openDelayMs = 500;
    const first = bed.kubi.connect();
    expect(await bed.kubi.connect()).toEqual({ type: 'notConnected', reason: 'connectionInProgress' });
    await bed.elapse(1000);
    expect((await first).type).toBe('connected');
  });

  it('picker を持たない経路で呼ぶ → KubiUnsupportedError', async () => {
    const bed = await makeBed({ connect: false, transport: new FakeTransport({ providesDevicePicker: false }) });
    await expect(bed.kubi.connect()).rejects.toBeInstanceOf(KubiUnsupportedError);
  });

  it('接続状態の変化は変化のみ届き、購読した瞬間には何も届かない', async () => {
    const bed = await makeBed({ connect: false });
    const got: ConnectionChange[] = [];
    bed.kubi.onConnectionChange((c) => got.push(c));
    await bed.flush();
    expect(got).toEqual([]);
    await bed.connect();
    expect(got.map((c) => c.state)).toEqual(['connecting', 'connected']);
  });

  it('切断して繋ぎ直せる。切断の原因は byApp。購読は生き続ける', async () => {
    const bed = await makeBed();
    const got: ConnectionChange[] = [];
    bed.kubi.onConnectionChange((c) => got.push(c));
    await bed.kubi.disconnect();
    await bed.flush();
    expect(got.at(-1)).toEqual({ state: 'disconnected', cause: 'byApp' });
    expect(bed.kubi.device).toBeNull();
    expect(bed.adv.snapshot().pan.motion).toBe('unknown');
    await bed.connect();
    expect(got.at(-1)).toEqual({ state: 'connected' });
  });

  it('teardown の間は connected のまま、完了後に disconnected', async () => {
    const bed = await makeBed();
    bed.transport.link!.closeDelayMs = 300;
    const p = bed.kubi.disconnect();
    await bed.elapse(100);
    expect(bed.kubi.connectionState).toBe('connected');
    await bed.elapse(300);
    await p;
    expect(bed.kubi.connectionState).toBe('disconnected');
  });

  it('二重に切断しても 1 回だけ起き、両方が解決する。未接続の切断は何も起きない', async () => {
    const bed = await makeBed();
    const a = bed.kubi.disconnect();
    const b = bed.kubi.disconnect();
    await bed.flush();
    await Promise.all([a, b]);
    expect(bed.kubi.connectionState).toBe('disconnected');
    await bed.kubi.disconnect();
  });

  it('リンク喪失 → disconnected（原因 linkLost）、位置は未知、motion は unknown、速度設定は残る', async () => {
    const bed = await makeBed();
    await bed.kubi.writePanSpeed(30);
    await bed.kubi.writeTiltSpeed(30);
    const got: ConnectionChange[] = [];
    bed.kubi.onConnectionChange((c) => got.push(c));
    bed.transport.loseLink();
    await bed.flush();
    expect(got.at(-1)).toEqual({ state: 'disconnected', cause: 'linkLost' });
    const s = bed.adv.snapshot();
    expect(s.pan.present).toBeNull();
    expect(s.pan.motion).toBe('unknown');
    expect(bed.kubi.speed.pan).toBeCloseTo(30, 0);
  });

  it('Bluetooth の可用性は接続していなくても変化し、変化だけ届く', async () => {
    const bed = await makeBed({ connect: false });
    const got: string[] = [];
    bed.kubi.onBluetoothAvailabilityChange((a) => got.push(a));
    bed.transport.setAvailability('unavailable');
    bed.transport.setAvailability('unavailable');
    await bed.flush();
    expect(got).toEqual(['unavailable']);
    expect(bed.kubi.bluetoothAvailability).toBe('unavailable');
    expect(bed.kubi.connectionState).toBe('disconnected');
  });

  it('dispose は不可逆・冪等。以後の操作も読み取りも KubiDisposedError', async () => {
    const bed = await makeBed();
    await bed.kubi.dispose();
    await bed.kubi.dispose();
    expect(() => bed.adv.snapshot()).toThrow(KubiDisposedError);
    expect(() => bed.kubi.connectionState).toThrow(KubiDisposedError);
    await expect(bed.adv.moveTo({ pan: 0 })).rejects.toBeInstanceOf(KubiDisposedError);
    expect(bed.transport.link).toBeNull();
  });

  it('接続の進行中に disconnect → その接続は繋げなかったとして終わる', async () => {
    const bed = await makeBed({ connect: false });
    bed.transport.openDelayMs = 500;
    const c = probe(bed.kubi.connect());
    await bed.elapse(10);
    await bed.kubi.disconnect();
    await bed.elapse(1000);
    expect(c.value).toEqual({ type: 'notConnected', reason: 'couldNotConnect' });
    expect(bed.kubi.connectionState).toBe('disconnected');
  });
});
