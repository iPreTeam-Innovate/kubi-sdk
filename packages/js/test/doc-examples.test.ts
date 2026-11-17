/**
 * 文書（docs/api.md・packages/js/README.md・docs/guide.md）に載せた例の写し。
 * 文書のコメントに書いた出力が、ここの `expect` と同じであること。例を直したら、ここも直す。
 * 文書の `console.log` は `log` に読み替える。機体の値（名前・シリアル番号・電圧）は模擬デバイスのもの。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Kubi, KubiDisposedError, KubiError, KubiUnsupportedError, Observed, defaultSpeed, panRange, speedRange, tiltRange } from '../src/index.js';
import type { BatteryStatus, ConnectionChange, DiagnosticEvent, ServoFault } from '../src/index.js';
import { FakeTransport } from './fake/fake-transport.js';
import { makeBed, type Bed } from './support/bed.js';

let out: unknown[] = [];
const log = (...values: unknown[]): void => {
  out.push(values.length === 1 ? values[0] : values);
};
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  out = [];
});
afterEach(() => {
  vi.useRealTimers();
});

/** 例を走らせ、首が止まるだけの時間を進めてから結果を返す。 */
async function play<T>(bed: Bed, example: () => Promise<T>, ms = 8000): Promise<T> {
  const p = example();
  p.catch(() => {});
  await bed.elapse(ms);
  return p;
}

describe('Kubi', () => {
  it('Kubi.forBrowser(): 作った直後は disconnected', () => {
    const kubi = Kubi.forBrowser();
    expect(kubi.connectionState).toBe('disconnected');
  });

  it('new Kubi(transport): 自作の transport の能力がそのまま見える', () => {
    const myTransport = new FakeTransport();
    const kubi = new Kubi(myTransport);
    expect(kubi.capabilities).toEqual({ providesDevicePicker: true, canScan: false });
  });
});

describe('Connection', () => {
  it('capabilities', async () => {
    const { kubi } = await makeBed({ connect: false });
    expect(kubi.capabilities).toEqual({ providesDevicePicker: true, canScan: false });
  });

  it('connectionState: 接続の前後', async () => {
    const bed = await makeBed({ connect: false });
    const { kubi } = bed;
    await play(bed, async () => {
      log(kubi.connectionState);
      await kubi.connect();
      log(kubi.connectionState);
    });
    expect(out).toEqual(['disconnected', 'connected']);
  });

  it('device: 接続中は id と name、切断すると null', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    await play(bed, async () => {
      log(kubi.device);
      await kubi.disconnect();
      log(kubi.device);
    });
    expect(out).toEqual([{ id: 'kubi-0001', name: 'kubi000012AB01' }, null]);
  });

  it('bluetoothAvailability', async () => {
    const { kubi } = await makeBed({ connect: false });
    expect(kubi.bluetoothAvailability).toBe('available');
  });

  it('connect(): 繋がると { type: connected }', async () => {
    const bed = await makeBed({ connect: false });
    const { kubi } = bed;
    const result = await play(bed, () => kubi.connect());
    expect(result).toEqual({ type: 'connected' });
  });

  it('connect(): 選ばずに閉じると notSelected（例外ではない）', async () => {
    const bed = await makeBed({ connect: false });
    bed.transport.pickerResult = null;
    const result = await play(bed, () => bed.kubi.connect());
    expect(result).toEqual({ type: 'notConnected', reason: 'notSelected' });
  });

  it('disconnect()', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    await play(bed, async () => {
      await kubi.disconnect();
      log(kubi.connectionState);
    });
    expect(out).toEqual(['disconnected']);
  });

  it('dispose(): 以後の呼び出しは KubiDisposedError', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    await play(bed, () => kubi.dispose());
    await expect(kubi.readPan()).rejects.toBeInstanceOf(KubiDisposedError);
  });

  it('onConnectionChange(): 接続して切断すると 3 回届く', async () => {
    const bed = await makeBed({ connect: false });
    const { kubi } = bed;
    await play(bed, async () => {
      kubi.onConnectionChange((change) => log(change));
      await kubi.connect();
      await kubi.disconnect();
    });
    expect(out).toEqual([{ state: 'connecting' }, { state: 'connected' }, { state: 'disconnected', cause: 'byApp' }]);
  });

  it('onConnectionChange(): 本体の電源が落ちると linkLost。解除した購読には届かない', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    const changes: ConnectionChange[] = [];
    kubi.onConnectionChange((change) => changes.push(change));
    const unsubscribe = kubi.onConnectionChange((change) => log(change));
    unsubscribe();
    bed.transport.loseLink();
    await bed.flush();
    expect(changes).toEqual([{ state: 'disconnected', cause: 'linkLost' }]);
    expect(out).toEqual([]);
  });

  it('onBluetoothAvailabilityChange(): Bluetooth を切ると unavailable', async () => {
    const bed = await makeBed({ connect: false });
    bed.kubi.onBluetoothAvailabilityChange((availability) => log(availability));
    bed.transport.setAvailability('unavailable');
    await bed.flush();
    expect(out).toEqual(['unavailable']);
  });
});

describe('Servo (basic API)', () => {
  it('writePanGoal(): 書いたら解決。少し待ってから読むと、目標の少し手前', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    await play(bed, async () => {
      await kubi.writePanGoal(30);
      await sleep(2000);
      const pan = await kubi.readPan();
      log(pan.value.toFixed(1));
    });
    expect(out).toEqual(['29.2']);
  });

  it('writePanGoal(): 範囲の外は端に丸める（診断で分かる）', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    await play(bed, async () => {
      kubi.onDiagnostic((event) => {
        if (event.type === 'clamped') log(event.requested, event.applied);
      });
      await kubi.writePanGoal(200);
    });
    expect(out).toEqual([[200, 150]]);
  });

  it('writePanGoal(): 数でない値は RangeError、未接続は KubiError', async () => {
    const bed = await makeBed();
    await expect(bed.kubi.writePanGoal(Number.NaN)).rejects.toBeInstanceOf(RangeError);
    const off = await makeBed({ connect: false });
    await expect(off.kubi.writePanGoal(30)).rejects.toMatchObject({ name: 'KubiError', code: 'noLink' });
  });

  it('writeTiltGoal(): 上へ 20°、範囲の外（90）は 40 に丸める', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    await play(bed, async () => {
      await kubi.writeTiltGoal(20);
      await sleep(2000);
      const tilt = await kubi.readTilt();
      log(tilt.value.toFixed(1));
    });
    await play(bed, async () => {
      kubi.onDiagnostic((event) => {
        if (event.type === 'clamped') log(event.requested, event.applied);
      });
      await kubi.writeTiltGoal(90);
    });
    expect(out).toEqual(['19.2', [90, 40]]);
  });

  it('writePanSpeed(): 設定になり、次の目標書き込みから使われる', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    await play(bed, async () => {
      await kubi.writePanSpeed(30);
      log(kubi.speed.pan.toFixed(2));
      await kubi.writePanGoal(60);
    });
    expect(out).toEqual(['29.97']);
    expect(bed.transport.pan.speedDegPerSec).toBeCloseTo(30, 0);
  });

  it('writePanSpeed(): 動いている最中は、同じ目標を書き直すまで速さが変わらない', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    await kubi.writePanGoal(60);
    await kubi.writePanSpeed(20);
    expect(bed.transport.pan.speedDegPerSec).toBeCloseTo(60, 0);
    await kubi.writePanGoal(60);
    expect(bed.transport.pan.speedDegPerSec).toBeCloseTo(20, 0);
    await bed.elapse(8000);
  });

  it('writePanSpeed(): 0 以下は RangeError、範囲の外は丸める', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    await expect(kubi.writePanSpeed(0)).rejects.toBeInstanceOf(RangeError);
    await kubi.writePanSpeed(10000);
    expect(kubi.speed.pan.toFixed(1)).toBe('103.9');
  });

  it('writeTiltSpeed()', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    await play(bed, async () => {
      await kubi.writeTiltSpeed(20);
      log(kubi.speed.tilt.toFixed(2));
      await kubi.writeTiltGoal(30);
    });
    expect(out).toEqual(['19.98']);
    expect(bed.transport.tilt.speedDegPerSec).toBeCloseTo(20, 0);
  });

  it('readPan(): 角度・測定時刻・経過時間', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    bed.transport.pan.placeAt(29.2);
    const pan = await play(bed, () => kubi.readPan(), 30);
    expect(pan).toBeInstanceOf(Observed);
    expect(pan.value.toFixed(1)).toBe('29.2');
    expect(pan.observedAt).toBeInstanceOf(Date);
    expect(pan.ageMs).toBeLessThan(50);
    await bed.elapse(1000);
    expect(pan.ageMs).toBeGreaterThanOrEqual(1000);
  });

  it('readPan(): 未接続なら KubiError（code は noLink）', async () => {
    const { kubi } = await makeBed({ connect: false });
    try {
      await kubi.readPan();
    } catch (error) {
      log((error as KubiError).code);
    }
    expect(out).toEqual(['noLink']);
  });

  it('readTilt(): 両軸は 1 つずつ読む', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    bed.transport.pan.placeAt(29.2);
    bed.transport.tilt.placeAt(19.2);
    await play(bed, async () => {
      const pan = await kubi.readPan();
      const tilt = await kubi.readTilt();
      log(pan.value.toFixed(1), tilt.value.toFixed(1));
    });
    expect(out).toEqual([['29.2', '19.2']]);
  });
});

describe('Speed', () => {
  it('speed: 既定値、書いた後', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    await play(bed, async () => {
      log(kubi.speed.pan.toFixed(2), kubi.speed.tilt.toFixed(2));
      await kubi.writeTiltSpeed(20);
      log(kubi.speed.pan.toFixed(2), kubi.speed.tilt.toFixed(2));
    });
    expect(out).toEqual([
      ['59.94', '59.94'],
      ['59.94', '19.98'],
    ]);
  });
});

describe('Status and device info', () => {
  it('readBatteryVoltage()', async () => {
    const bed = await makeBed();
    const millivolts = await play(bed, () => bed.kubi.readBatteryVoltage());
    expect(millivolts).toBe(3700);
  });

  it('batteryStatus: 接続中は値、未接続は null', async () => {
    const bed = await makeBed();
    expect(bed.kubi.batteryStatus).toEqual({ charging: false, low: false });
    expect((await makeBed({ connect: false })).kubi.batteryStatus).toBeNull();
  });

  it('onBatteryStatusChange(): USB を挿すと charging', async () => {
    const bed = await makeBed();
    const got: BatteryStatus[] = [];
    bed.kubi.onBatteryStatusChange((status) => got.push(status));
    bed.transport.link!.notify('batteryStatus', Uint8Array.of(0x09));
    await bed.flush();
    expect(got).toEqual([{ charging: true, low: false }]);
  });

  it('onServoFault(): 動いている首を押さえると overload', async () => {
    const bed = await makeBed();
    const got: ServoFault[] = [];
    bed.kubi.onServoFault((error) => got.push(error));
    bed.kubi.onServoFault((error) => log(error.axis, error.overload));
    bed.transport.link!.notify('servoError', Uint8Array.of(0x20, 0x00));
    await bed.elapse(100);
    expect(out).toEqual([['pan', true]]);
    expect(got[0]).toMatchObject({ axis: 'pan', inputVoltage: false, overheating: false, electricalShock: false, overload: true });
    expect(got[0]!.at).toBeInstanceOf(Date);
  });

  it('buttonPressed / onButtonChange(): 押すと true、離すと false', async () => {
    const bed = await makeBed();
    expect(bed.kubi.buttonPressed).toBe(false);
    bed.kubi.onButtonChange((pressed) => log(pressed));
    bed.transport.link!.notify('button', Uint8Array.of(0x01));
    await bed.flush();
    expect(bed.kubi.buttonPressed).toBe(true);
    bed.transport.link!.notify('button', Uint8Array.of(0x00));
    await bed.flush();
    expect(out).toEqual([true, false]);
    expect((await makeBed({ connect: false })).kubi.buttonPressed).toBeNull();
  });

  it('readDeviceInfo()', async () => {
    const bed = await makeBed();
    const info = await play(bed, () => bed.kubi.readDeviceInfo());
    expect(info).toEqual({
      serialNumber: 'EFC55E',
      modelNumber: 'iPre-K',
      manufacturer: 'iPresence Co., Ltd.',
      hardwareRevision: '1.0.0',
      firmwareRevision: '1.1.1',
    });
  });
});

describe('Diagnostics', () => {
  it('onDiagnostic(): 目標の書き込み 1 回は write が 1 つ', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    await play(bed, async () => {
      kubi.onDiagnostic((event) => {
        if (event.type === 'write') log(event.purpose, event.axis, Array.from(event.bytes));
      });
      await kubi.writePanGoal(30);
    });
    expect(out).toEqual([['goal', 'pan', [2, 102]]]);
  });

  it('onDiagnostic(): 読み取り 1 回は、要求の write と応答の frame', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    const events: DiagnosticEvent[] = [];
    await play(bed, async () => {
      kubi.onDiagnostic((event) => events.push(event));
      await kubi.readPan();
    });
    expect(events.map((e) => e.type)).toEqual(['write', 'frame']);
    expect(events[0]).toMatchObject({ type: 'write', purpose: 'readRequest', axis: 'pan', ok: true });
    expect(Array.from((events[1] as { bytes: Uint8Array }).bytes).slice(0, 3)).toEqual([1, 36, 2]);
  });
});

describe('Constants', () => {
  it('panRange / tiltRange / speedRange / defaultSpeed', () => {
    expect(panRange).toEqual({ min: -150, max: 150 });
    expect(tiltRange).toEqual({ min: -20, max: 40 });
    expect(speedRange.min.toFixed(2)).toBe('0.67');
    expect(speedRange.max.toFixed(1)).toBe('103.9');
    expect(defaultSpeed).toBe(60);
  });
});

describe('Errors', () => {
  it('KubiError: instanceof で見分け、code を読む', async () => {
    const { kubi } = await makeBed({ connect: false });
    try {
      await kubi.writePanGoal(30);
    } catch (error) {
      if (error instanceof KubiError) log(error.code);
    }
    expect(out).toEqual(['noLink']);
  });

  it('KubiUnsupportedError: picker を持たない transport で connect()', async () => {
    const kubi = new Kubi(new FakeTransport({ providesDevicePicker: false }));
    expect(kubi.capabilities.providesDevicePicker).toBe(false);
    await expect(kubi.connect()).rejects.toBeInstanceOf(KubiUnsupportedError);
  });

  it('RangeError: 意味の無い引数。範囲の外の角度はエラーにならない', async () => {
    const bed = await makeBed();
    await expect(bed.kubi.writePanSpeed(-1)).rejects.toBeInstanceOf(RangeError);
    await expect(bed.kubi.writeTiltGoal(Number.POSITIVE_INFINITY)).rejects.toBeInstanceOf(RangeError);
    await expect(bed.kubi.writePanGoal(999)).resolves.toBeUndefined();
    await bed.elapse(8000);
  });
});

describe('README', () => {
  it('最短の例: 速度 → 目標 → 少し待って読む', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    await play(bed, async () => {
      await kubi.writePanSpeed(30);
      await kubi.writePanGoal(30);
      await sleep(2000);
      const pan = await kubi.readPan();
      log(pan.value.toFixed(1));
    });
    expect(out).toEqual(['28.9']);
  });
});

describe('guide', () => {
  it('1 基本 API: 呼ばない限り、SDK は何も送らない', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    await play(bed, async () => {
      let count = 0;
      kubi.onDiagnostic((event) => {
        if (event.type === 'write') count += 1;
      });
      await sleep(5000);
      log(count);
      await kubi.writePanGoal(30);
      log(count);
    });
    expect(out).toEqual([0, 1]);
  });

  it('2 位置を読む: 両軸は別々の時刻に測られる', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    await play(bed, async () => {
      const pan = await kubi.readPan();
      const tilt = await kubi.readTilt();
      log(tilt.observedAt.getTime() - pan.observedAt.getTime() > 0);
    });
    expect(out).toEqual([true]);
  });

  it('4 丸め: 範囲の外を書くと端まで動く', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    await play(bed, async () => {
      await kubi.writePanGoal(200);
      await sleep(4000);
      const pan = await kubi.readPan();
      log(pan.value.toFixed(1));
    });
    expect(out).toEqual(['149.1']);
  });

  it('6 行き先を変える: 新しい目標を書くと、前の目標は忘れられる', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    await play(bed, async () => {
      await kubi.writePanGoal(90);
      await sleep(500);
      await kubi.writePanGoal(-30);
    });
    expect(bed.transport.pan.presentDeg).toBeLessThan(-28);
  });

  it('6 行き先を変える: 止まれる距離だけ先を目標に書くと、戻らずに止まる', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    await kubi.writePanGoal(90);
    await bed.elapse(1000); // 60°/s で右へ回っている
    const example = (async () => {
      const pan = await kubi.readPan();
      const ahead = (60 * 60) / 136;
      await kubi.writePanGoal(pan.value + ahead);
    })();
    let previous = bed.transport.pan.presentDeg;
    let wentBack = false;
    for (let i = 0; i < 300; i++) {
      await bed.elapse(10);
      if (bed.transport.pan.presentDeg < previous - 0.01) wentBack = true;
      previous = bed.transport.pan.presentDeg;
    }
    await example;
    expect(wentBack).toBe(false);
    expect(bed.transport.pan.velocityDegPerSec).toBe(0);
    expect(bed.transport.pan.presentDeg).toBeLessThan(85); // 元の目標 90 までは行かない
  });

  it('6 行き先を変える: 読んだ位置をそのまま目標に書くと、行き過ぎてから戻る', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    await kubi.writePanGoal(90);
    await bed.elapse(1000);
    const example = (async () => {
      const pan = await kubi.readPan();
      await kubi.writePanGoal(pan.value);
      return pan.value;
    })();
    let peak = -Infinity;
    for (let i = 0; i < 500; i++) {
      await bed.elapse(10);
      peak = Math.max(peak, bed.transport.pan.presentDeg);
    }
    const written = await example;
    expect(peak - written).toBeGreaterThan(15); // 大きく行き過ぎる
    expect(Math.abs(bed.transport.pan.presentDeg - written)).toBeLessThan(2); // そして戻る
  });

  it('止まるまで待つ: 読んだ値が変わらなくなるまで繰り返す', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    await play(bed, async () => {
      await kubi.writePanGoal(60);
      let pan = await kubi.readPan();
      for (;;) {
        await sleep(200);
        const next = await kubi.readPan();
        const stopped = Math.abs(next.value - pan.value) < 0.5;
        pan = next;
        if (stopped) break;
      }
      log(pan.value.toFixed(1));
    });
    expect(out).toEqual(['59.1']);
    expect(bed.transport.pan.velocityDegPerSec).toBe(0);
  });

  it('スライダーに追従する: 前の書き込みが済むまで待ち、最新の値だけを書く', async () => {
    const bed = await makeBed();
    const { kubi } = bed;
    bed.transport.link!.ackDelayMs = 100; // 書き込み 1 本に 100ms かかる本体
    const panSlider = { value: '0', oninput: null as null | (() => Promise<void>) };

    let latest: number | null = null;
    let busy = false;
    panSlider.oninput = async () => {
      latest = Number(panSlider.value);
      if (busy) return;
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

    const before = bed.transport.writes.length;
    for (const v of ['10', '20', '30', '40', '50']) {
      panSlider.value = v;
      void panSlider.oninput();
      await bed.elapse(10);
    }
    await bed.elapse(1000);
    // 5 回動かして、書き込みは最初の値と最後の値の 2 本。
    expect(bed.transport.writes.length - before).toBe(2);
    expect(bed.transport.pan.goalDeg).toBeCloseTo(50, 0);
  });
});
