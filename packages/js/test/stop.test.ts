/** `stop` capability の Scenario 写し。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBed, probe } from './support/bed.js';
import { describeWrite } from './fake/fake-transport.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('stop', () => {
  it('移動中に止める → stopping を経て idle、結果は stopped、首は留まる', async () => {
    const bed = await makeBed();
    const m = bed.adv.moveTo({ pan: 120 });
    await bed.elapse(500);
    const s = probe(bed.adv.stay());
    await bed.elapse(10);
    expect(bed.adv.snapshot().pan.motion).toBe('staying');
    await bed.elapse(1500);
    expect(s.value).toEqual({ pan: 'stayed', tilt: 'stayed' });
    expect(bed.adv.snapshot().pan.motion).toBe('idle');
    const at = bed.transport.pan.presentDeg;
    await bed.elapse(2000);
    expect(Math.abs(bed.transport.pan.presentDeg - at)).toBeLessThan(0.5);
    expect(bed.adv.snapshot().pan.goal).not.toBeCloseTo(120, 0);
    await m;
  });

  it('S1: 停止の通信列は 減速しきる位置の到達点 → 読み取り（静止まで）→ 止まった位置の到達点。速さは書かない', async () => {
    const bed = await makeBed();
    bed.adv.moveTo({ pan: 120 }).catch(() => {});
    await bed.elapse(500);
    const before = bed.transport.writes.length;
    const s = bed.adv.stay('pan');
    await bed.elapse(3000);
    await s;
    const seq = bed.transport.writes.slice(before).map(describeWrite);
    expect(seq[0]).toBe('pan到達点');
    expect(seq.at(-1)).toBe('pan到達点');
    expect(seq.length).toBeGreaterThan(3);
    expect(seq.slice(1, -1).every((x) => x === 'pan読み取り')).toBe(true);
    expect(bed.transport.link!.zeroSpeedWrites).toEqual([]);
  });

  it('すでに止まっているものを止める → 何も起きず即座に stopped', async () => {
    const bed = await makeBed();
    const before = bed.transport.writes.length;
    expect(await bed.adv.stay('pan')).toBe('stayed');
    expect(bed.transport.writes.length).toBe(before);
  });

  it('二重の停止は合流し、同じ結果で解決する', async () => {
    const bed = await makeBed();
    bed.adv.moveTo({ pan: 120 }).catch(() => {});
    await bed.elapse(500);
    let brakes = 0;
    bed.kubi.onDiagnostic((e) => {
      if (e.type === 'write' && e.purpose === 'brake') brakes++;
    });
    const a = probe(bed.adv.stay('pan'));
    const b = probe(bed.adv.stay('pan'));
    await bed.elapse(3000);
    expect(a.value).toBe('stayed');
    expect(b.value).toBe('stayed');
    expect(brakes).toBe(1);
  });

  it('停止が追い越される → superseded、軸は新しい move の状態', async () => {
    const bed = await makeBed();
    bed.adv.moveTo({ pan: 120 }).catch(() => {});
    await bed.elapse(500);
    const s = probe(bed.adv.stay('pan'));
    await bed.elapse(10);
    const m = bed.adv.moveTo({ pan: -60 });
    await bed.elapse(10);
    expect(s.value).toBe('superseded');
    expect(bed.adv.snapshot().pan.motion).toBe('moving');
    await bed.elapse(8000);
    await m;
  });

  it('観測の最中に停止 → 測定の完了を待たずに制動が送られる（飛行中の 1 本だけ待つ）', async () => {
    const bed = await makeBed();
    bed.transport.link!.readResponseDelayMs = 400;
    bed.adv.moveTo({ pan: 120 }).catch(() => {});
    await bed.elapse(250);
    const before = bed.transport.writes.length;
    const s = bed.adv.stay('pan');
    await bed.elapse(50);
    const seq = bed.transport.writes.slice(before).map(describeWrite);
    expect(seq[0]).toBe('pan到達点');
    await bed.elapse(8000);
    await s;
  });

  it('片軸の書き込みが進行中でも、もう片軸の停止は後回しにされない', async () => {
    const bed = await makeBed();
    bed.transport.link!.ackDelayMs = 100;
    bed.adv.moveTo({ pan: 120, tilt: 30 }).catch(() => {});
    await bed.elapse(150);
    const before = bed.transport.writes.length;
    const s = bed.adv.stay('tilt');
    await bed.elapse(150);
    const seq = bed.transport.writes.slice(before).map(describeWrite);
    expect(seq[0]!.startsWith('tilt')).toBe(true);
    await bed.elapse(6000);
    await s;
  });

  it('電圧の読み出し中に止めても、停止は後続の読み出しに追い越されない', async () => {
    const bed = await makeBed();
    bed.adv.moveTo({ pan: 120 }).catch(() => {});
    await bed.elapse(500);
    const v1 = bed.kubi.readBatteryVoltage();
    const v2 = bed.kubi.readBatteryVoltage();
    const before = bed.transport.writes.length;
    const s = bed.adv.stay('pan');
    await bed.elapse(3000);
    expect(await s).toBe('stayed');
    expect(describeWrite(bed.transport.writes[before]!)).toBe('pan到達点');
    expect(await v1).toBe(3700);
    expect(await v2).toBe(3700);
  });

  it('解決した時点で首は止まっている。行き過ぎて戻ることも無い（本体は一定の加減速でしか止まれない）', async () => {
    const bed = await makeBed();
    bed.adv.moveTo({ pan: 120 }).catch(() => {});
    await bed.elapse(1500); // 60°/s の等速に入っている
    let peak = bed.transport.pan.presentDeg;
    let resolvedAt: number | null = null;
    let posAtResolve = Number.NaN;
    const t0 = Date.now();
    const s = bed.adv.stay('pan').then((r) => {
      resolvedAt = Date.now();
      posAtResolve = bed.transport.pan.presentDeg;
      return r;
    });
    for (let i = 0; i < 80; i++) {
      await bed.elapse(50);
      peak = Math.max(peak, bed.transport.pan.presentDeg);
    }
    expect(await s).toBe('stayed');
    const rest = bed.transport.pan.presentDeg;
    expect(Math.abs(rest - posAtResolve)).toBeLessThan(1); // 解決した後に動いていない
    expect(peak - rest).toBeLessThan(2); // 行き過ぎて戻っていない
    expect(resolvedAt! - t0).toBeLessThan(2000); // 60°/s から 2 秒以内
    expect(Math.abs(bed.adv.snapshot().pan.goal! - rest)).toBeLessThan(2); // 目標は止まった位置
  });
});
