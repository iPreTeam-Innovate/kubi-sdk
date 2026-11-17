/** `status` / `device-info` / `diagnostics` の Scenario 写し。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBed } from './support/bed.js';
import { FakeTransport } from './fake/fake-transport.js';
import { KubiError } from '../src/errors.js';
import type { BatteryStatus, DiagnosticEvent, ServoFault } from '../src/types.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('status', () => {
  it('電圧を読む → mV の整数。リンクが無ければ例外', async () => {
    const bed = await makeBed();
    const v = bed.kubi.readBatteryVoltage();
    await bed.elapse(10);
    expect(await v).toBe(3700);
    await bed.kubi.disconnect();
    await expect(bed.kubi.readBatteryVoltage()).rejects.toBeInstanceOf(KubiError);
  });

  it('接続した時点でバッテリー状態とボタンは既知。切断で null に戻る', async () => {
    const t = new FakeTransport();
    t.onLinkOpened = (l) => {
      l.batteryStatusByte = 0x0d;
      l.buttonByte = 0x01;
    };
    const bed = await makeBed({ transport: t });
    expect(bed.kubi.batteryStatus).toEqual({ charging: true, low: true });
    expect(bed.kubi.buttonPressed).toBe(true);
    await bed.kubi.disconnect();
    expect(bed.kubi.batteryStatus).toBeNull();
    expect(bed.kubi.buttonPressed).toBeNull();
  });

  it('充電を始めると charging が 1 回届く。同じ値の通知は届かない', async () => {
    const bed = await makeBed();
    const got: BatteryStatus[] = [];
    bed.kubi.onBatteryStatusChange((s) => got.push(s));
    bed.transport.link!.notify('batteryStatus', Uint8Array.of(0x09));
    bed.transport.link!.notify('batteryStatus', Uint8Array.of(0x09));
    bed.transport.link!.notify('batteryStatus', Uint8Array.of(0x0b)); // bit 1 だけ違う → 公開面では同じ
    await bed.flush();
    expect(got).toEqual([{ charging: true, low: false }]);
  });

  it('ボタンを押して離す → true と false が順に届く', async () => {
    const bed = await makeBed();
    const got: boolean[] = [];
    bed.kubi.onButtonChange((p) => got.push(p));
    bed.transport.link!.notify('button', Uint8Array.of(0x01));
    bed.transport.link!.notify('button', Uint8Array.of(0x00));
    await bed.flush();
    expect(got).toEqual([true, false]);
  });

  it('手で押さえて過負荷 → 軸と種類が 1 つのイベントで届く。宣言は残る', async () => {
    const bed = await makeBed();
    const got: ServoFault[] = [];
    bed.kubi.onServoFault((e) => got.push(e));
    void bed.adv.moveTo({ pan: 60 }).catch(() => {});
    await bed.elapse(200);
    bed.transport.link!.servoErrorAxisByte = 0x01;
    bed.transport.link!.notify('servoError', Uint8Array.of(0x20, 0x00));
    await bed.elapse(100);
    expect(got.length).toBe(1);
    expect(got[0]).toMatchObject({ axis: 'pan', overload: true, overheating: false });
    expect(got[0]!.at).toBeInstanceOf(Date);
    expect(bed.adv.snapshot().pan.motion).toBe('moving');
    await bed.elapse(4000);
  });

  it('Status の特性を持たない機体でも首は動く。状態は null、電圧は例外', async () => {
    const t = new FakeTransport();
    for (const c of ['batteryVoltage', 'batteryStatus', 'button', 'servoError', 'servoErrorAxis'] as const) t.missing.add(c);
    const bed = await makeBed({ transport: t });
    expect(bed.kubi.connectionState).toBe('connected');
    expect(bed.kubi.batteryStatus).toBeNull();
    const m = bed.adv.moveTo({ pan: 30 });
    await bed.elapse(3000);
    expect((await m).type).toBe('settled');
    await expect(bed.kubi.readBatteryVoltage()).rejects.toBeInstanceOf(KubiError);
  });

  it('状態の購読はリンクを失っても生きていて、再接続後の初期同期の値が違えば届く', async () => {
    const bed = await makeBed();
    const got: BatteryStatus[] = [];
    bed.kubi.onBatteryStatusChange((s) => got.push(s));
    bed.transport.loseLink();
    await bed.flush();
    bed.transport.onLinkOpened = (l) => {
      l.batteryStatusByte = 0x09;
    };
    await bed.connect();
    expect(got).toEqual([{ charging: true, low: false }]);
  });
});

describe('device-info', () => {
  it('5 つの文字列が返る', async () => {
    const bed = await makeBed();
    const p = bed.kubi.readDeviceInfo();
    await bed.elapse(50);
    expect(await p).toEqual({
      serialNumber: 'EFC55E',
      modelNumber: 'iPre-K',
      manufacturer: 'iPresence Co., Ltd.',
      hardwareRevision: '1.0.0',
      firmwareRevision: '1.1.1',
    });
  });

  it('項目が無い個体はその項目だけ null', async () => {
    const t = new FakeTransport();
    t.missing.add('modelNumber');
    const bed = await makeBed({ transport: t });
    const p = bed.kubi.readDeviceInfo();
    await bed.elapse(50);
    const info = await p;
    expect(info.modelNumber).toBeNull();
    expect(info.firmwareRevision).toBe('1.1.1');
  });

  it('リンクが無い状態で読む → 例外', async () => {
    const bed = await makeBed({ connect: false });
    await expect(bed.kubi.readDeviceInfo()).rejects.toBeInstanceOf(KubiError);
  });
});

describe('diagnostics', () => {
  it('送られたバイト列と届いた応答が時刻つきで観測でき、目的が分かる', async () => {
    const bed = await makeBed();
    const got: DiagnosticEvent[] = [];
    bed.kubi.onDiagnostic((e) => got.push(e));
    const m = bed.adv.moveTo({ pan: 30 });
    await bed.elapse(3000);
    await m;
    const writes = got.filter((e) => e.type === 'write');
    const frames = got.filter((e) => e.type === 'frame');
    expect(writes.some((w) => w.type === 'write' && w.purpose === 'goal' && w.axis === 'pan')).toBe(true);
    expect(writes.some((w) => w.type === 'write' && w.purpose === 'readRequest')).toBe(true);
    expect(frames.length).toBeGreaterThan(0);
    expect(got[0]!.at).toBeInstanceOf(Date);
  });

  it('購読が無ければ診断は作られず、購読していても動きは同じ', async () => {
    const a = await makeBed();
    const ma = a.adv.moveTo({ pan: 30 });
    await a.elapse(3000);
    const ra = await ma;
    vi.useRealTimers();
    const b = await makeBed();
    b.kubi.onDiagnostic(() => {});
    const mb = b.adv.moveTo({ pan: 30 });
    await b.elapse(3000);
    const rb = await mb;
    expect(rb.type).toBe(ra.type);
    expect(b.transport.writes.length).toBe(a.transport.writes.length);
  });

  it('診断の購読者が例外を投げても制御は続く', async () => {
    const bed = await makeBed();
    bed.kubi.onDiagnostic(() => {
      throw new Error('bug');
    });
    const m = bed.adv.moveTo({ pan: 30 });
    await bed.elapse(3000);
    expect((await m).type).toBe('settled');
  });
});
