/** `drive` capability の Scenario 写し。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeBed, probe } from './support/bed.js';
import { describeWrite } from './fake/fake-transport.js';
import type { DriveHalt } from '../src/types.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('drive', () => {
  it('一方向へ動かし続ける → 宣言はすぐ解決し、到達点（端）へ向かって動き続ける', async () => {
    const bed = await makeBed();
    const d = bed.adv.drive({ pan: 'right' });
    await bed.elapse(100);
    await d;
    expect(bed.adv.snapshot().pan.motion).toBe('driving');
    expect(bed.adv.snapshot().pan.goal).toBe(150);
    const a = bed.transport.pan.presentDeg;
    await bed.elapse(1000);
    expect(bed.transport.pan.presentDeg).toBeGreaterThan(a + 20);
    const st = bed.adv.stay('pan');
    await bed.elapse(1500);
    await st;
  });

  it('DR1: drive の通信列は pan到達点 → tilt到達点 → pan読み取り → tilt読み取り（速さは事前の設定なので出ない）', async () => {
    const bed = await makeBed();
    const before = bed.transport.writes.length;
    const d = bed.adv.drive({ pan: 'right', tilt: 'up' });
    await bed.elapse(300);
    await d;
    const seq = bed.transport.writes.slice(before).map(describeWrite);
    expect(seq.slice(0, 4)).toEqual(['pan到達点', 'tilt到達点', 'pan読み取り', 'tilt読み取り']);
    expect(seq.includes('pan速さ')).toBe(false);
  });

  it('到達点を指定する → そこで止まり、進まなくなった通知が鳴り、宣言が終わって idle・目標は止まった位置', async () => {
    const bed = await makeBed();
    const halts: DriveHalt[] = [];
    bed.adv.onDriveHalt((h) => halts.push(h));
    const d = bed.adv.drive({ pan: 'right', panTo: 60 });
    await bed.elapse(100);
    await d;
    await bed.elapse(6000);
    expect(halts.length).toBe(1);
    expect(halts[0]!.axis).toBe('pan');
    expect(halts[0]!.destination).toBeCloseTo(60, 0);
    expect(Math.abs(halts[0]!.present.value - 60)).toBeLessThan(2);
    expect(bed.adv.snapshot().pan.motion).toBe('idle');
    expect(bed.adv.snapshot().pan.goal).not.toBeCloseTo(60, 1);
  });

  it('到達点が後ろにある → 首は動かず、すぐ通知され、宣言は終わる', async () => {
    const bed = await makeBed();
    bed.transport.pan.placeAt(130);
    const rp = bed.kubi.readPan();
    await bed.elapse(100);
    await rp;
    const halts: DriveHalt[] = [];
    bed.adv.onDriveHalt((h) => halts.push(h));
    await bed.adv.drive({ pan: 'right', panTo: 60 });
    await bed.flush();
    expect(halts.length).toBe(1);
    expect(bed.adv.snapshot().pan.motion).toBe('idle');
    await bed.elapse(1000);
    expect(bed.transport.pan.presentDeg).toBeCloseTo(130, 0);
  });

  it('止めるのは stop → stopping を経て止まってから解決', async () => {
    const bed = await makeBed();
    void bed.adv.drive({ pan: 'right' });
    await bed.elapse(500);
    const d = probe(bed.adv.stay('pan'));
    await bed.elapse(10);
    expect(d.done).toBe(false);
    expect(bed.adv.snapshot().pan.motion).toBe('staying');
    await bed.elapse(1500);
    expect(d.done).toBe(true);
    expect(bed.adv.snapshot().pan.motion).toBe('idle');
  });

  it('速さは事前の設定。drive は速度を書かず、設定は変わらない', async () => {
    const bed = await makeBed();
    await bed.kubi.writePanSpeed(20);
    const before = bed.transport.writes.length;
    void bed.adv.drive({ pan: 'right' });
    await bed.elapse(1000);
    expect(bed.transport.writes.slice(before).map(describeWrite).filter((x) => x === 'pan速さ')).toEqual([]);
    expect(bed.transport.pan.speedDegPerSec).toBeCloseTo(20, 0);
    expect(bed.kubi.speed.pan).toBeCloseTo(20, 0);
    const st = bed.adv.stay('pan');
    await bed.elapse(1500);
    await st;
  });

  // 向きの名前以外の拒否（TypeError）は公開層の検査。drive を公開面へ戻すときに一緒に戻す。
  it('向きを 1 つも指定しないと TypeError。device へは何も出ない', async () => {
    const bed = await makeBed();
    const before = bed.transport.writes.length;
    await expect(bed.adv.drive({})).rejects.toBeInstanceOf(TypeError);
    await bed.flush();
    expect(bed.transport.writes.length).toBe(before);
  });

  it('観測を降りると自動で終わらず driving のまま。停止はできる', async () => {
    const bed = await makeBed();
    const halts: DriveHalt[] = [];
    bed.adv.onDriveHalt((h) => halts.push(h));
    const d = bed.adv.drive({ pan: 'right', panTo: 30, observe: false });
    await bed.elapse(100);
    await d;
    await bed.elapse(5000);
    expect(bed.adv.snapshot().pan.motion).toBe('driving');
    expect(halts.length).toBe(0);
    expect(Math.abs(bed.transport.pan.presentDeg - 30)).toBeLessThan(2);
    const s = bed.adv.stay('pan');
    await bed.elapse(1500);
    expect(await s).toBe('stayed');
    expect(bed.adv.snapshot().pan.present!.value).toBeCloseTo(bed.transport.pan.presentDeg, 0);
  });

  it('観測を降りた drive の連打中は、その軸の読み取りが出ない（DR3）', async () => {
    const bed = await makeBed();
    bed.transport.link!.ackDelayMs = 60;
    const before = bed.transport.writes.length;
    for (let i = 0; i < 10; i++) {
      void bed.adv.drive({ pan: 'right', panTo: 100 + i, observe: false });
      await bed.elapse(50);
    }
    const seq = bed.transport.writes.slice(before).map(describeWrite);
    expect(seq.filter((s) => s === 'pan読み取り')).toEqual([]);
    expect(seq.filter((s) => s === 'pan到達点').length).toBeGreaterThan(0);
    const st = bed.adv.stay('pan');
    await bed.elapse(4000);
    await st;
  });

  it('反転を宣言し続けても逆へ走らない（宣言した向きへ動く）', async () => {
    const bed = await makeBed();
    bed.transport.link!.ackDelayMs = 60;
    void bed.adv.drive({ pan: 'right' });
    await bed.elapse(600);
    const peak = bed.transport.pan.presentDeg;
    for (let i = 0; i < 8; i++) {
      void bed.adv.drive({ pan: 'left', panTo: -140 + i });
      await bed.elapse(50);
    }
    await bed.elapse(1500);
    expect(bed.transport.pan.presentDeg).toBeLessThan(peak);
    expect(bed.transport.link!.zeroSpeedWrites).toEqual([]);
    const st = bed.adv.stay('pan');
    await bed.elapse(4000);
    await st;
  });

  it('駆動中の moveBy は rejected（宣言が有効）', async () => {
    const bed = await makeBed();
    void bed.adv.drive({ pan: 'right', observe: false });
    await bed.elapse(200);
    expect(await bed.adv.moveBy({ pan: 5 })).toEqual({ type: 'rejected', reason: 'declarationActive' });
    const st = bed.adv.stay('pan');
    await bed.elapse(1500);
    await st;
  });
});
