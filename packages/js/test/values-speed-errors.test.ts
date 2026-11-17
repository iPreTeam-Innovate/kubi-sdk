/** `values` / `speed` / `errors` / `foundation` の Scenario 写し。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBed } from './support/bed.js';
import { describeWrite } from './fake/fake-transport.js';
import { defaultSpeed, panRange, speedRange, tiltRange } from '../src/values.js';
import { KubiError } from '../src/errors.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('values', () => {
  it('可動範囲と速度の範囲が公開定数から読める。速度の範囲は 0 を含まない', () => {
    expect(panRange).toEqual({ min: -150, max: 150 });
    expect(tiltRange).toEqual({ min: -20, max: 40 });
    expect(speedRange.min).toBeGreaterThan(0);
    expect(defaultSpeed).toBe(60);
  });

  it('端を指定して読み戻しても公開範囲の中（量子化のはみ出しを押し戻す）', async () => {
    const bed = await makeBed();
    void bed.adv.moveTo({ tilt: 40 }).catch(() => {});
    const g = bed.adv.snapshot().tilt.goal!;
    expect(g).toBeLessThanOrEqual(40);
    expect(g).toBeGreaterThan(39.5);
    await bed.elapse(4000);
  });

  it('丸めた値が goal に現れ、丸めは診断で観測できる', async () => {
    const bed = await makeBed();
    const diag: unknown[] = [];
    bed.kubi.onDiagnostic((e) => {
      if (e.type === 'clamped') diag.push(e);
    });
    void bed.adv.moveTo({ pan: 400 }).catch(() => {});
    await bed.flush();
    expect(bed.adv.snapshot().pan.goal).toBe(150);
    expect(diag).toEqual([expect.objectContaining({ what: 'angle', axis: 'pan', requested: 400, applied: 150 })]);
    await bed.elapse(8000);
  });

  it('速度の書き込みに 0 や負を渡すと拒否される（最小速度へ丸めない）。device へは書かれない', async () => {
    const bed = await makeBed();
    const before = bed.transport.writes.length;
    await expect(bed.kubi.writePanSpeed(0)).rejects.toBeInstanceOf(RangeError);
    await expect(bed.kubi.writePanSpeed(-5)).rejects.toBeInstanceOf(RangeError);
    await expect(bed.kubi.writeTiltSpeed(Number.POSITIVE_INFINITY)).rejects.toBeInstanceOf(RangeError);
    await bed.elapse(50);
    expect(bed.transport.writes.length).toBe(before);
  });

  it('刻みより細かい変化は device へ届かない（moveTo。基本 API の目標書き込みは呼ぶたびに書く）', async () => {
    const bed = await makeBed();
    const m1 = bed.adv.moveTo({ pan: 10 });
    await bed.elapse(3000);
    await m1;
    const before = bed.transport.writes.filter((w) => describeWrite(w) === 'pan到達点').length;
    const m2 = bed.adv.moveTo({ pan: 10.05 });
    await bed.elapse(3000);
    await m2;
    const after = bed.transport.writes.filter((w) => describeWrite(w) === 'pan到達点').length;
    expect(after).toBe(before);
  });
});

describe('speed', () => {
  it('軸ごとに違う速度を書き込み、読み出すと量子化した値が返る', async () => {
    const bed = await makeBed();
    await bed.kubi.writePanSpeed(30);
    await bed.kubi.writeTiltSpeed(45);
    expect(bed.kubi.speed.pan).toBeCloseTo(30, 0);
    expect(bed.kubi.speed.tilt).toBeCloseTo(45, 0);
    expect(bed.transport.pan.speedRegisterDegPerSec).toBeCloseTo(30, 0);
    expect(bed.transport.tilt.speedRegisterDegPerSec).toBeCloseTo(45, 0);
  });

  it('接続前に書くと例外で終わり、設定は変わらない', async () => {
    const bed = await makeBed({ connect: false });
    await expect(bed.kubi.writePanSpeed(30)).rejects.toBeInstanceOf(KubiError);
    expect(bed.kubi.speed.pan).toBeCloseTo(defaultSpeed, 0);
  });

  it('V1: 静止中の速度の書き込みは同じ値でも書き、到達点の書き直しも読み取りも出ない', async () => {
    const bed = await makeBed();
    const before = bed.transport.writes.length;
    void bed.kubi.writePanSpeed(60);
    void bed.kubi.writeTiltSpeed(60);
    await bed.elapse(100);
    const seq = bed.transport.writes.slice(before).map(describeWrite);
    expect(seq).toEqual(['pan速さ', 'tilt速さ']);
  });

  it('速度を渡していない move の途中で速度を書いても、その move は終わらず新しい速度で続く（到達点を書き直して効かせる）', async () => {
    const bed = await makeBed();
    await bed.kubi.writePanSpeed(10);
    const m = bed.adv.moveTo({ pan: 60 });
    await bed.elapse(500);
    void bed.kubi.writePanSpeed(90);
    await bed.elapse(300);
    expect(bed.transport.pan.speedDegPerSec).toBeCloseTo(90, -1);
    expect(bed.adv.snapshot().pan.motion).toBe('moving');
    await bed.elapse(3000);
    expect((await m).type).toBe('settled');
  });

  it('一度書いた速度は 2 回の move に続く。設定は切断をまたいで残り、再接続の初期同期で書かれる', async () => {
    const bed = await makeBed();
    await bed.kubi.writePanSpeed(25);
    await bed.kubi.writeTiltSpeed(25);
    await bed.kubi.disconnect();
    expect(bed.kubi.speed.pan).toBeCloseTo(25, 0);
    await bed.connect();
    expect(bed.kubi.speed.pan).toBeCloseTo(25, 0);
    expect(bed.transport.pan.speedRegisterDegPerSec).toBeCloseTo(25, 0);
  });
});

describe('errors / foundation', () => {
  it('リンクが無い状態で動かす操作 → KubiError で、await の先は実行されない', async () => {
    const bed = await makeBed({ connect: false });
    let reached = false;
    try {
      await bed.adv.moveTo({ pan: 10 });
      reached = true;
    } catch (e) {
      expect(e).toBeInstanceOf(KubiError);
      expect((e as KubiError).code).toBe('noLink');
    }
    expect(reached).toBe(false);
  });

  it('書き込みが失敗しても宣言は残り、motion は moving のまま', async () => {
    const bed = await makeBed();
    bed.transport.link!.failWriteWhen = (w) => describeWrite(w) === 'pan到達点';
    const m = bed.adv.moveTo({ pan: 60 });
    const rejected = expect(m).rejects.toBeInstanceOf(KubiError); // 先に受け手を付ける（未処理の拒否にしない）
    await bed.elapse(50);
    await rejected;
    expect(bed.adv.snapshot().pan.motion).toBe('moving');
    bed.transport.link!.failWriteWhen = null;
    await bed.elapse(5000);
    expect(bed.adv.snapshot().pan.motion).toBe('idle');
  });

  it('購読者が例外を投げても制御は続く', async () => {
    const bed = await makeBed();
    bed.adv.onChange(() => {
      throw new Error('購読者のバグ');
    });
    const m = bed.adv.moveTo({ pan: 45 });
    await bed.elapse(4000);
    expect((await m).type).toBe('settled');
  });

  it('リンクを失っても購読は解除されず、再接続後も届く', async () => {
    const bed = await makeBed();
    let count = 0;
    bed.adv.onChange(() => count++);
    bed.transport.loseLink();
    await bed.flush();
    const afterLoss = count;
    await bed.connect();
    expect(count).toBeGreaterThan(afterLoss);
  });

  it('書き込みは同時に 2 本走らない。速度 0 は書かれない', async () => {
    const bed = await makeBed();
    bed.transport.link!.ackDelayMs = 30;
    void bed.adv.moveTo({ pan: 60, tilt: 20 }).catch(() => {});
    await bed.elapse(100);
    void bed.adv.drive({ pan: 'left' }).catch(() => {});
    await bed.elapse(100);
    void bed.adv.stay().catch(() => {});
    await bed.elapse(3000);
    expect(bed.transport.link!.overlappingWrites).toEqual([]);
    expect(bed.transport.link!.zeroSpeedWrites).toEqual([]);
  });
});
