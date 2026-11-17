/**
 * 通信の並びのテスト。テスト名の頭は並びの識別子。
 * K1 / M1 / M4 / DR1 / S1 / V1 は各 capability のテストにもある。ここには残りの代表例を置く。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBed } from './support/bed.js';
import { describeWrite } from './fake/fake-transport.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('command-delivery', () => {
  it('M2: 速さが device と同じなら速さは出ず、pan到達点 → tilt到達点 → pan読み取り → tilt読み取り', async () => {
    const bed = await makeBed();
    const before = bed.transport.writes.length;
    const m = bed.adv.moveTo({ pan: 45, tilt: 10 });
    await bed.elapse(300);
    const seq = bed.transport.writes.slice(before).map(describeWrite);
    expect(seq.slice(0, 4)).toEqual(['pan到達点', 'tilt到達点', 'pan読み取り', 'tilt読み取り']);
    await bed.elapse(4000);
    await m;
  });

  it('M8: 静止から writePanGoal → writeTiltGoal は pan到達点 → tilt到達点 だけで、読み取りは出ない', async () => {
    const bed = await makeBed();
    const before = bed.transport.writes.length;
    void bed.kubi.writePanGoal(45);
    await bed.kubi.writeTiltGoal(10);
    await bed.elapse(2000);
    const seq = bed.transport.writes.slice(before).map(describeWrite);
    expect(seq).toEqual(['pan到達点', 'tilt到達点']);
  });

  it('M6: idle でないときの moveBy は何も出さない', async () => {
    const bed = await makeBed();
    void bed.adv.moveTo({ pan: 60 }).catch(() => {});
    await bed.elapse(300);
    const before = bed.transport.writes.length;
    await bed.adv.moveBy({ pan: 10 });
    await bed.flush();
    expect(bed.transport.writes.length).toBe(before);
    await bed.elapse(5000);
  });

  it('M9: 連打しても速さと到達点が届き切り、ある軸・あるレジスタだけが書かれ続けることは無い', async () => {
    const bed = await makeBed();
    bed.transport.link!.ackDelayMs = 120;
    const before = bed.transport.writes.length;
    for (let i = 0; i < 12; i++) {
      void bed.kubi.writePanSpeed(30 + i).catch(() => {});
      void bed.kubi.writeTiltSpeed(30 + i).catch(() => {});
      void bed.adv.moveTo({ pan: 40 + i * 3, tilt: 5 + i }).catch(() => {});
      await bed.elapse(118);
    }
    await bed.elapse(4000);
    const seq = bed.transport.writes.slice(before).map(describeWrite);
    const kinds = new Set(seq);
    expect(kinds.has('pan速さ') && kinds.has('pan到達点') && kinds.has('tilt速さ') && kinds.has('tilt到達点')).toBe(true);
    // 落ち着いたら device の到達点はライブラリの目標と一致している（届き切る）
    expect(bed.transport.pan.goalDeg).toBeCloseTo(bed.adv.snapshot().pan.goal!, 0);
    expect(bed.transport.tilt.goalDeg).toBeCloseTo(bed.adv.snapshot().tilt.goal!, 0);
    await bed.elapse(6000);
  });

  it('S2: 到達点を出す前に stay が来たら、出していない到達点は出ない。首は動いていないので、静止を確かめて今の位置を到達点にするだけ', async () => {
    const bed = await makeBed();
    bed.transport.link!.ackDelayMs = 100;
    void bed.kubi.writePanSpeed(30).catch(() => {});
    const before = bed.transport.writes.length;
    void bed.adv.moveTo({ pan: 90 }).catch(() => {});
    await bed.elapse(20); // pan速さ が飛行中
    const s = bed.adv.stay('pan');
    await bed.elapse(2000);
    await s;
    const seq = bed.transport.writes.slice(before).map(describeWrite);
    expect(seq[0]).toBe('pan速さ'); // 設定の速さ（飛行中だった 1 本）
    expect(seq.filter((x) => x === 'pan速さ').length).toBe(1); // 停止は速さを書かない
    expect(seq.indexOf('pan到達点')).toBeGreaterThan(seq.indexOf('pan読み取り')); // 保持の到達点だけ
    expect(bed.transport.pan.goalDeg).not.toBeCloseTo(90, 0);
  });

  it('DR10: 同じ向きのまま到達点を変えて宣言し直すと、到達点 → 読み取り の周を繰り返す。速さは出ない', async () => {
    const bed = await makeBed();
    bed.transport.link!.ackDelayMs = 50;
    const before = bed.transport.writes.length;
    void bed.adv.drive({ pan: 'right', panTo: 100 }).catch(() => {});
    await bed.elapse(250);
    void bed.adv.drive({ pan: 'right', panTo: 120 }).catch(() => {});
    await bed.elapse(500);
    const seq = bed.transport.writes.slice(before).map(describeWrite);
    expect(seq.slice(0, 2)).toEqual(['pan到達点', 'pan読み取り']);
    expect(seq.indexOf('pan到達点', 1)).toBeGreaterThan(1); // 2 回目の到達点
    expect(seq.includes('pan速さ')).toBe(false);
    expect(bed.transport.pan.goalDeg).toBeCloseTo(120, 0);
    const st = bed.adv.stay('pan');
    await bed.elapse(1500);
    await st;
  });

  it('V2: 進行中の move の軸に速度を書くと 速さ → 同じ到達点 の 2 本が出て、読み取りが続く', async () => {
    const bed = await makeBed();
    const m = bed.adv.moveTo({ pan: 90 });
    await bed.elapse(500);
    const goalBefore = bed.transport.pan.goalDeg;
    const before = bed.transport.writes.length;
    void bed.kubi.writePanSpeed(20);
    await bed.elapse(300);
    const seq = bed.transport.writes.slice(before).map(describeWrite);
    expect(seq.slice(0, 3)).toEqual(['pan速さ', 'pan到達点', 'pan読み取り']);
    expect(bed.transport.pan.goalDeg).toBe(goalBefore);
    expect(bed.transport.pan.speedDegPerSec).toBeCloseTo(20, 0);
    await bed.elapse(8000);
    expect((await m).type).toBe('settled');
  });
});
