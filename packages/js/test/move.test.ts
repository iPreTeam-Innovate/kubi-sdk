/** `move` capability の Scenario 写し（clamped・speed オプション無しの版）。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBed, probe, reachSlackDeg } from './support/bed.js';
import { describeWrite } from './fake/fake-transport.js';
import { KubiError } from '../src/errors.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('move', () => {
  it('到達して止まる → settled。goal と present がほぼ一致し、clamped は偽', async () => {
    const bed = await makeBed();
    const m = bed.adv.moveTo({ pan: 45, tilt: 10 });
    await bed.elapse(4000);
    const r = await m;
    expect(r.type).toBe('settled');
    if (r.type !== 'settled') return;
    expect(r.goal.pan).toBeCloseTo(45, 0);
    expect(Math.abs(r.present.pan!.value - 45)).toBeLessThanOrEqual(reachSlackDeg);
    expect(r.clamped).toBe(false);
    expect(bed.adv.snapshot().pan.motion).toBe('idle');
  });

  it('M1: 静止から両軸 moveTo（速さが device と違う = together）の通信列は pan速さ → pan到達点 → tilt速さ → tilt到達点 → pan読み取り → tilt読み取り', async () => {
    const bed = await makeBed();
    const before = bed.transport.writes.length;
    const m = bed.adv.moveTo({ pan: 45, tilt: 10 }, { together: true });
    await bed.elapse(300);
    const seq = bed.transport.writes.slice(before).map(describeWrite);
    expect(seq.slice(0, 6)).toEqual(['pan速さ', 'pan到達点', 'tilt速さ', 'tilt到達点', 'pan読み取り', 'tilt読み取り']);
    await bed.elapse(4000);
    await m;
  });

  it('M4: 片軸だけ動かすと、触れていない軸には何も出ない', async () => {
    const bed = await makeBed();
    const before = bed.transport.writes.length;
    const m = bed.adv.moveTo({ pan: 30 });
    await bed.elapse(3000);
    await m;
    const seq = bed.transport.writes.slice(before).map(describeWrite);
    expect(seq.some((s) => s.startsWith('tilt'))).toBe(false);
    expect(bed.adv.snapshot().tilt.goal).toBeNull();
  });

  it('可動範囲の外へ moveTo → 例外にならず端まで動き、clamped が真、goal は端', async () => {
    const bed = await makeBed();
    const m = bed.adv.moveTo({ pan: 200 });
    await bed.elapse(8000);
    const r = await m;
    expect(r.type).toBe('settled');
    if (r.type !== 'settled') return;
    expect(r.clamped).toBe(true);
    expect(r.goal.pan).toBe(150);
    expect(bed.adv.snapshot().pan.goal).toBe(150);
  });

  it('右端にいて更に右へ → 動かずに settled、clamped は真', async () => {
    const bed = await makeBed();
    bed.transport.pan.placeAt(150);
    const rp = bed.kubi.readPan();
    await bed.elapse(100);
    await rp;
    const before = bed.transport.pan.presentDeg;
    const m = bed.adv.moveTo({ pan: 170 });
    await bed.elapse(3000);
    const r = await m;
    expect(r.type).toBe('settled');
    expect((r as { clamped: boolean }).clamped).toBe(true);
    expect(bed.transport.pan.presentDeg).toBe(before);
  });

  it('走行中に別の move → 先の move は cancelled(superseded)、首は新しい目標へ', async () => {
    const bed = await makeBed();
    const first = probe(bed.adv.moveTo({ pan: 60 }));
    await bed.elapse(300);
    const second = bed.adv.moveTo({ pan: -30 });
    await bed.elapse(10);
    expect(first.value).toEqual({ type: 'cancelled', by: 'superseded', clamped: false });
    await bed.elapse(6000);
    const r = await second;
    expect(r.type).toBe('settled');
    expect(Math.abs(bed.transport.pan.presentDeg - -30)).toBeLessThanOrEqual(reachSlackDeg);
  });

  it('停止で打ち切られる → cancelled(stopped)。停止の完了を待たずに解決する', async () => {
    const bed = await makeBed();
    const m = probe(bed.adv.moveTo({ pan: 90 }));
    await bed.elapse(300);
    const s = probe(bed.adv.stay('pan'));
    await bed.elapse(10);
    expect(m.value).toEqual({ type: 'cancelled', by: 'stayed', clamped: false });
    expect(s.done).toBe(false);
    await bed.elapse(3000);
    expect(s.value).toBe('stayed');
  });

  it('手前で止まる（物理的に届かない）→ 同じように settled し、goal と present に差がある', async () => {
    const bed = await makeBed();
    bed.transport.tilt.reachable = { min: -20, max: 30 };
    const m = bed.adv.moveTo({ tilt: 40 });
    await bed.elapse(8000);
    const r = await m;
    expect(r.type).toBe('settled');
    if (r.type !== 'settled') return;
    expect(r.goal.tilt! - r.present.tilt!.value).toBeGreaterThan(5);
    expect(bed.adv.snapshot().tilt.motion).toBe('idle');
  });

  it('moveBy は present 基準。静止から +30° で、測定位置から 30° 進む', async () => {
    const bed = await makeBed();
    bed.transport.pan.placeAt(10);
    const rp = bed.kubi.readPan();
    await bed.elapse(100);
    await rp;
    const m = bed.adv.moveBy({ pan: 30 });
    await bed.elapse(4000);
    const r = await m;
    expect(r.type).toBe('settled');
    expect(Math.abs(bed.transport.pan.presentDeg - 40)).toBeLessThanOrEqual(reachSlackDeg);
  });

  it('移動中の moveBy は rejected で、進行中の動作は影響を受けない', async () => {
    const bed = await makeBed();
    const first = probe(bed.adv.moveTo({ pan: 60 }));
    await bed.elapse(300);
    const r = await bed.adv.moveBy({ pan: 10 });
    expect(r).toEqual({ type: 'rejected', reason: 'declarationActive' });
    expect(first.done).toBe(false);
    await bed.elapse(6000);
    expect(first.value?.type).toBe('settled');
  });

  it('together: 距離が違う 2 軸がほぼ同時に止まり、速度設定は汚れない', async () => {
    const bed = await makeBed();
    await bed.kubi.writePanSpeed(60);
    await bed.kubi.writeTiltSpeed(60);
    const settled: Record<string, number> = {};
    bed.adv.onChange((s) => {
      if (s.pan.motion === 'idle' && !('pan' in settled)) settled['pan'] = Date.now();
      if (s.tilt.motion === 'idle' && !('tilt' in settled)) settled['tilt'] = Date.now();
    });
    await bed.elapse(10);
    const m = bed.adv.moveTo({ pan: 90, tilt: 20 }, { together: true });
    await bed.elapse(10000);
    expect((await m).type).toBe('settled');
    expect(bed.kubi.speed).toEqual({ pan: bed.kubi.speed.pan, tilt: bed.kubi.speed.tilt });
    expect(bed.kubi.speed.pan).toBeCloseTo(60, 0);
    expect(Math.abs(settled['pan']! - settled['tilt']!)).toBeLessThan(1500);
  });

  it('リンクが無い状態で moveTo → KubiError（例外）', async () => {
    const bed = await makeBed({ connect: false });
    await expect(bed.adv.moveTo({ pan: 10 })).rejects.toBeInstanceOf(KubiError);
  });

  // NaN の拒否（RangeError）は公開層の検査。moveTo を公開面へ戻すときに一緒に戻す。
  it('軸を 1 つも指定しないと TypeError。首は動かない', async () => {
    const bed = await makeBed();
    await expect(bed.adv.moveTo({})).rejects.toBeInstanceOf(TypeError);
  });

  it('動作中にリンクを失うと move は例外で終わる', async () => {
    const bed = await makeBed();
    const m = probe(bed.adv.moveTo({ pan: 90 }));
    await bed.elapse(300);
    bed.transport.loseLink();
    await bed.flush();
    expect(m.error).toBeInstanceOf(KubiError);
  });

  it('基本 API で動かした軸があるときの moveBy は rejected(motionUnknown)。通信は出ず、moveTo で idle に戻せば実行される', async () => {
    const bed = await makeBed();
    await bed.kubi.writePanGoal(20);
    await bed.elapse(100);
    const before = bed.transport.writes.length;
    expect(await bed.adv.moveBy({ pan: 10 })).toEqual({ type: 'rejected', reason: 'motionUnknown' });
    expect(await bed.adv.moveBy({ tilt: 5 })).toEqual({ type: 'rejected', reason: 'motionUnknown' });
    await bed.flush();
    expect(bed.transport.writes.length).toBe(before);
    const m = bed.adv.moveTo({ pan: 20 });
    await bed.elapse(4000);
    expect((await m).type).toBe('settled');
    expect(bed.adv.snapshot().pan.motion).toBe('idle');
    const r = bed.adv.moveBy({ pan: 10 });
    await bed.elapse(3000);
    expect((await r).type).toBe('settled');
  });
});
