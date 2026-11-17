/** `servo` capability（基本 API）の Scenario 写し。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBed, probe } from './support/bed.js';
import { describeWrite } from './fake/fake-transport.js';
import { Observed } from '../src/types.js';
import { KubiError } from '../src/errors.js';
import type { DiagnosticEvent } from '../src/types.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('servo: 目標の書き込み', () => {
  it('書き込みが済んだら解決する。首が止まるのを待たず、motion は unknown', async () => {
    const bed = await makeBed();
    const w = probe(bed.kubi.writePanGoal(60));
    await bed.elapse(20);
    expect(w.done).toBe(true);
    expect(bed.adv.snapshot().pan.motion).toBe('unknown');
    expect(bed.adv.snapshot().pan.goal).toBeCloseTo(60, 0);
    expect(bed.transport.pan.goalDeg).toBeCloseTo(60, 0);
    expect(Math.abs(bed.transport.pan.presentDeg - 60)).toBeGreaterThan(30); // まだ動き始めたばかり
  });

  it('範囲外は丸める。例外は投げず、goal は端の値', async () => {
    const bed = await makeBed();
    await bed.kubi.writePanGoal(200);
    expect(bed.adv.snapshot().pan.goal).toBe(150);
    expect(bed.transport.pan.goalDeg).toBeCloseTo(150, 0);
  });

  it('未接続で呼ぶと KubiError で終わる', async () => {
    const bed = await makeBed({ connect: false });
    await expect(bed.kubi.writePanGoal(10)).rejects.toBeInstanceOf(KubiError);
    await expect(bed.kubi.writeTiltGoal(10)).rejects.toBeInstanceOf(KubiError);
  });

  it('書き込んだ後に読み取りが出ない（9144 への要求は 0 本）', async () => {
    const bed = await makeBed();
    await bed.kubi.writePanGoal(60);
    const before = bed.transport.writes.length;
    const reads0 = bed.transport.link!.readRequestCount;
    await bed.elapse(5000);
    expect(bed.transport.writes.length).toBe(before);
    expect(bed.transport.link!.readRequestCount).toBe(reads0);
    expect(bed.adv.snapshot().pan.motion).toBe('unknown');
  });

  it('走行中の moveTo を振り替える。moveTo は cancelled(superseded)、首は新しい目標へ', async () => {
    const bed = await makeBed();
    const m = probe(bed.adv.moveTo({ pan: 60 }));
    await bed.elapse(300);
    await bed.kubi.writePanGoal(-30);
    expect(m.value).toEqual({ type: 'cancelled', by: 'superseded', clamped: false });
    expect(bed.transport.pan.goalDeg).toBeCloseTo(-30, 0);
    await bed.elapse(4000);
    expect(bed.transport.pan.presentDeg).toBeLessThan(-25);
  });

  it('触れていない軸は影響を受けない', async () => {
    const bed = await makeBed();
    await bed.kubi.writeTiltGoal(20);
    expect(bed.adv.snapshot().pan.motion).toBe('idle');
    expect(bed.adv.snapshot().tilt.motion).toBe('unknown');
  });
});

describe('servo: 現在位置の読み取り', () => {
  it('読むと測定時刻つきの値が返り、往復が 1 回行われる', async () => {
    const bed = await makeBed();
    bed.transport.pan.placeAt(77);
    const reads0 = bed.transport.link!.readRequestCount;
    const p = bed.kubi.readPan();
    await bed.elapse(100);
    const o = await p;
    expect(o).toBeInstanceOf(Observed);
    expect(o.value).toBeCloseTo(77, 0);
    expect(o.observedAt.getTime()).toBe(Date.now() - o.ageMs);
    expect(bed.transport.link!.readRequestCount - reads0).toBe(1);
  });

  it('両軸は 2 回で読む', async () => {
    const bed = await makeBed();
    const before = bed.transport.writes.length;
    const pan = bed.kubi.readPan();
    const tilt = bed.kubi.readTilt();
    await bed.elapse(200);
    await pan;
    await tilt;
    const seq = bed.transport.writes.slice(before).map(describeWrite);
    expect(seq).toEqual(['pan読み取り', 'tilt読み取り']);
  });

  it('未接続で呼ぶと KubiError で終わる', async () => {
    const bed = await makeBed({ connect: false });
    await expect(bed.kubi.readPan()).rejects.toBeInstanceOf(KubiError);
    await expect(bed.kubi.readTilt()).rejects.toBeInstanceOf(KubiError);
  });

  it('キャッシュが更新される。snapshot の present は読み取った値と同じで、測定時刻も同じ', async () => {
    const bed = await makeBed();
    bed.transport.pan.placeAt(33);
    const p = bed.kubi.readPan();
    await bed.elapse(100);
    const o = await p;
    const s = bed.adv.snapshot().pan.present!;
    expect(s.value).toBe(o.value);
    expect(s.observedAt.getTime()).toBe(o.observedAt.getTime());
  });

  it('停止に捨てられた読み取りはやり直され、失敗にならない', async () => {
    const bed = await makeBed();
    bed.transport.link!.readResponseDelayMs = 80;
    void bed.adv.moveTo({ pan: 90 }).catch(() => {});
    await bed.elapse(300);
    const p = probe(bed.kubi.readPan());
    await bed.elapse(30); // 読み取りの往復中
    const st = bed.adv.stay('pan');
    await bed.elapse(3000);
    await st;
    expect(p.error).toBeUndefined();
    expect(p.value).toBeInstanceOf(Observed);
  });
});

describe('servo: 直列化と合成', () => {
  it('連続して呼んでも順に届く（pan 目標 → tilt 目標 → pan 読み取り）', async () => {
    const bed = await makeBed();
    const before = bed.transport.writes.length;
    void bed.kubi.writePanGoal(30);
    void bed.kubi.writeTiltGoal(10);
    const r = bed.kubi.readPan();
    await bed.elapse(300);
    await r;
    const seq = bed.transport.writes.slice(before).map(describeWrite);
    expect(seq).toEqual(['pan到達点', 'tilt到達点', 'pan読み取り']);
  });

  it('同時に 2 つは出ない。読み取りの往復中の書き込みは完了を待つ', async () => {
    const bed = await makeBed();
    bed.transport.link!.ackDelayMs = 40;
    bed.transport.link!.readResponseDelayMs = 60;
    const before = bed.transport.writes.length;
    const r = bed.kubi.readPan();
    await bed.elapse(10);
    const w = bed.kubi.writePanGoal(30);
    await bed.elapse(500);
    await r;
    await w;
    const seq = bed.transport.writes.slice(before).map(describeWrite);
    expect(seq).toEqual(['pan読み取り', 'pan到達点']);
    expect(bed.transport.link!.overlappingWrites).toEqual([]);
  });

  it('moveTo の通信は基本操作の列（速度・目標・読み取り要求だけ）', async () => {
    const bed = await makeBed();
    const purposes = new Set<string>();
    bed.kubi.onDiagnostic((e: DiagnosticEvent) => {
      if (e.type === 'write') purposes.add(e.purpose);
    });
    const m = bed.adv.moveTo({ pan: 45, tilt: 10 });
    await bed.elapse(4000);
    expect((await m).type).toBe('settled');
    for (const p of purposes) expect(['speed', 'goal', 'readRequest']).toContain(p);
  });

  it('基本 API で書いた軸への moveBy は rejected(motionUnknown)。moveTo で管理下へ戻る', async () => {
    const bed = await makeBed();
    await bed.kubi.writePanGoal(20);
    expect(await bed.adv.moveBy({ pan: 10 })).toEqual({ type: 'rejected', reason: 'motionUnknown' });
    const m = bed.adv.moveTo({ pan: 20 });
    await bed.elapse(4000);
    expect((await m).type).toBe('settled');
    expect(bed.adv.snapshot().pan.motion).toBe('idle');
  });
});

describe('servo: 速度の書き込み', () => {
  it('次の目標書き込みから効く。止まっているときは速度 1 本だけで、目標は書き直さない', async () => {
    const bed = await makeBed();
    const before = bed.transport.writes.length;
    await bed.kubi.writePanSpeed(20);
    await bed.elapse(100);
    expect(bed.transport.writes.slice(before).map(describeWrite)).toEqual(['pan速さ']);
    expect(bed.transport.pan.speedRegisterDegPerSec).toBeCloseTo(20, 0);
    await bed.kubi.writePanGoal(60);
    expect(bed.transport.pan.speedDegPerSec).toBeCloseTo(20, 0);
    expect(bed.kubi.speed.pan).toBeCloseTo(20, 0);
  });

  it('書いただけでは動いている速さは変わらない（基本 API で動かした軸）', async () => {
    const bed = await makeBed();
    await bed.kubi.writePanGoal(120);
    await bed.elapse(200);
    const before = bed.transport.writes.length;
    await bed.kubi.writePanSpeed(10);
    await bed.elapse(300);
    expect(bed.transport.writes.slice(before).map(describeWrite)).toEqual(['pan速さ']);
    expect(bed.transport.pan.speedDegPerSec).toBeCloseTo(60, 0);
    expect(bed.transport.pan.speedRegisterDegPerSec).toBeCloseTo(10, 0);
  });

  it('速度を書いてから同じ目標を書き直すと、新しい速度で残りを動く', async () => {
    const bed = await makeBed();
    await bed.kubi.writePanGoal(120);
    await bed.elapse(200);
    await bed.kubi.writePanSpeed(10);
    await bed.kubi.writePanGoal(120);
    expect(bed.transport.pan.speedDegPerSec).toBeCloseTo(10, 0);
    const at = bed.transport.pan.presentDeg;
    await bed.elapse(1000);
    expect(bed.transport.pan.presentDeg - at).toBeLessThan(15); // 60°/s なら 60° 進むところ
  });

  it('意味の無い値は拒否され、device への書き込みは起きない', async () => {
    const bed = await makeBed();
    const before = bed.transport.writes.length;
    await expect(bed.kubi.writePanSpeed(0)).rejects.toBeInstanceOf(RangeError);
    await expect(bed.kubi.writeTiltSpeed(-1)).rejects.toBeInstanceOf(RangeError);
    await expect(bed.kubi.writePanSpeed(Number.NaN)).rejects.toBeInstanceOf(RangeError);
    await bed.elapse(50);
    expect(bed.transport.writes.length).toBe(before);
  });

  it('未接続で呼ぶと KubiError で終わる', async () => {
    const bed = await makeBed({ connect: false });
    await expect(bed.kubi.writePanSpeed(30)).rejects.toBeInstanceOf(KubiError);
  });

  it('速度を device から読む操作は無い。同期の読み出しが最後に書いた設定を返す', async () => {
    const bed = await makeBed();
    expect('readPanSpeed' in bed.kubi).toBe(false);
    expect('readSpeed' in bed.kubi).toBe(false);
    await bed.kubi.writeTiltSpeed(33);
    expect(bed.kubi.speed.tilt).toBeCloseTo(33, 0);
  });
});
