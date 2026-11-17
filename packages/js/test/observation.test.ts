/** `observation` capability の Scenario 写し。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBed } from './support/bed.js';
import { Snapshot } from '../src/types.js';
import { KubiError } from '../src/errors.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('observation', () => {
  it('宣言直後は goal が 45 で、present はまだ移動前の測定値', async () => {
    const bed = await makeBed();
    void bed.adv.moveTo({ pan: 45 }).catch(() => {});
    const s = bed.adv.snapshot();
    expect(s.pan.goal).toBeCloseTo(45, 0);
    expect(Math.abs(s.pan.present!.value)).toBeLessThan(1);
    await bed.elapse(4000);
  });

  it('present の経過時間は保持すると増え続ける', async () => {
    const bed = await makeBed();
    const p = bed.adv.snapshot().pan.present!;
    const a = p.ageMs;
    await bed.elapse(1000);
    expect(p.ageMs - a).toBe(1000);
  });

  it('未接続で読んでも例外は投げず、未知を表す null が返る', async () => {
    const bed = await makeBed({ connect: false });
    const s = bed.adv.snapshot();
    expect(s.pan.goal).toBeNull();
    expect(s.pan.present).toBeNull();
    expect(s.pan.motion).toBe('unknown');
  });

  it('片軸だけ宣言した状態では、もう片軸の goal は未知', async () => {
    const bed = await makeBed();
    void bed.adv.moveTo({ pan: 30 }).catch(() => {});
    const s = bed.adv.snapshot();
    expect(s.pan.goal).not.toBeNull();
    expect(s.tilt.goal).toBeNull();
    await bed.elapse(4000);
  });

  it('移動中の motion: pan は moving、tilt は idle', async () => {
    const bed = await makeBed();
    void bed.adv.moveTo({ pan: 45 }).catch(() => {});
    await bed.elapse(200);
    const s = bed.adv.snapshot();
    expect(s.pan.motion).toBe('moving');
    expect(s.tilt.motion).toBe('idle');
    await bed.elapse(4000);
  });

  it('変化のみ配信され、購読時の現在値は配信されない。動いている間は測定ごとに届く', async () => {
    const bed = await makeBed();
    const got: Snapshot[] = [];
    bed.adv.onChange((s) => got.push(s));
    await bed.elapse(500);
    expect(got.length).toBe(0);
    void bed.adv.moveTo({ pan: 45 }).catch(() => {});
    await bed.elapse(1500);
    expect(got.length).toBeGreaterThan(3);
    expect(got[0]).toBeInstanceOf(Snapshot);
    expect(got[0]!.pan.motion).toBe('moving');
  });

  it('速度の設定が変わったときも配信される', async () => {
    const bed = await makeBed();
    const got: Snapshot[] = [];
    bed.adv.onChange((s) => got.push(s));
    void bed.kubi.writePanSpeed(30);
    await bed.flush();
    expect(got.length).toBe(1);
    expect(got[0]!.pan.speed).toBeCloseTo(30, 0);
  });

  it('hasSameValues は測定時刻を無視し、equals は無視しない', async () => {
    const bed = await makeBed();
    const a = bed.adv.snapshot();
    const rp = bed.kubi.readPan();
    await bed.elapse(100);
    await rp;
    const b = bed.adv.snapshot();
    expect(a.hasSameValues(b)).toBe(true);
    expect(a.equals(b)).toBe(false);
  });

  it('readPan は往復してキャッシュを更新する（手で動かした後の回復）', async () => {
    const bed = await makeBed();
    bed.transport.pan.placeAt(77);
    expect(bed.adv.snapshot().pan.present!.value).not.toBeCloseTo(77, 0);
    const p = bed.kubi.readPan();
    await bed.elapse(100);
    const r = await p;
    expect(r.value).toBeCloseTo(77, 0);
    expect(bed.adv.snapshot().pan.present!.value).toBeCloseTo(77, 0);
  });

  it('readPan は未接続では失敗する', async () => {
    const bed = await makeBed({ connect: false });
    await expect(bed.kubi.readPan()).rejects.toBeInstanceOf(KubiError);
  });

  it('切断すると goal と present は未知に、motion は unknown に戻り、配信が届く', async () => {
    const bed = await makeBed();
    const got: Snapshot[] = [];
    bed.adv.onChange((s) => got.push(s));
    bed.transport.loseLink();
    await bed.flush();
    expect(got.at(-1)!.pan.motion).toBe('unknown');
    expect(got.at(-1)!.pan.present).toBeNull();
  });

  it('present が変わるのはライブラリが読んだときだけ。高度 API が無い間は手で動かしても変わらず、readPan で初めて新しくなる', async () => {
    const bed = await makeBed();
    const before = bed.adv.snapshot().pan.present!;
    bed.transport.pan.placeAt(55);
    await bed.elapse(3000);
    expect(bed.adv.snapshot().pan.present!.value).toBe(before.value);
    const p = bed.kubi.readPan();
    await bed.elapse(100);
    await p;
    expect(bed.adv.snapshot().pan.present!.value).toBeCloseTo(55, 0);
  });

  it('基本 API で目標を書いた後の motion は unknown。続けて読み取っても unknown のまま', async () => {
    const bed = await makeBed();
    expect(bed.adv.snapshot().pan.motion).toBe('idle');
    await bed.kubi.writePanGoal(30);
    expect(bed.adv.snapshot().pan.motion).toBe('unknown');
    const p = bed.kubi.readPan();
    await bed.elapse(100);
    await p;
    expect(bed.adv.snapshot().pan.motion).toBe('unknown');
  });

  it('高度 API が無い間はライブラリから読まない。配信されるのは開発者が読んだときだけ', async () => {
    const bed = await makeBed();
    const got: Snapshot[] = [];
    bed.adv.onChange((s) => got.push(s));
    const reads0 = bed.transport.link!.readRequestCount;
    await bed.elapse(5000);
    expect(bed.transport.link!.readRequestCount).toBe(reads0);
    expect(got.length).toBe(0);
    const p = bed.kubi.readTilt();
    await bed.elapse(100);
    await p;
    expect(bed.transport.link!.readRequestCount).toBe(reads0 + 1);
    expect(got.length).toBe(1);
  });

  it('snapshot は通信しない。10 秒後に取っても present は古いままで、経過時間が約 10 秒', async () => {
    const bed = await makeBed();
    const reads0 = bed.transport.link!.readRequestCount;
    const at = bed.adv.snapshot().pan.present!.observedAt.getTime();
    await bed.elapse(10_000);
    const s = bed.adv.snapshot();
    expect(bed.transport.link!.readRequestCount).toBe(reads0);
    expect(s.pan.present!.observedAt.getTime()).toBe(at);
    expect(s.pan.present!.ageMs).toBeGreaterThanOrEqual(10_000);
  });
});
