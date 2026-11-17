/**
 * `foundation` capability のうち「この版の公開面」の Scenario 写し。
 * このファイルは公開面（`bed.kubi` と index.ts の export）だけで書く。`bed.adv` は使わない。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../src/index.js';
import { Kubi } from '../src/kubi.js';
import { Observed } from '../src/types.js';
import { makeBed, reachSlackDeg } from './support/bed.js';

afterEach(() => {
  vi.useRealTimers();
});

/** `Kubi` の public メンバー名（constructor を除く）。 */
const members = (): string[] => Object.getOwnPropertyNames(Kubi.prototype).filter((n) => n !== 'constructor');

describe('foundation: この版で首を動かす公開操作は基本 API に限る', () => {
  it('高度 API の操作が公開面に無い', () => {
    for (const name of ['moveTo', 'moveBy', 'drive', 'onDriveHalt', 'stay']) {
      expect(members()).not.toContain(name);
    }
  });

  it('位置を知る手段は読み取りだけ（snapshot / onChange が無い）', () => {
    expect(members()).not.toContain('snapshot');
    expect(members()).not.toContain('onChange');
    expect(members()).toContain('readPan');
    expect(members()).toContain('readTilt');
    expect(Object.keys(api)).not.toContain('Snapshot');
  });

  it('基本 API は変わらず使える。読み取りは角度と測定時刻を持つ値を返す', async () => {
    const bed = await makeBed();
    await bed.kubi.writePanSpeed(30);
    await bed.kubi.writePanGoal(45);
    await bed.elapse(4000); // 首が止まるまで
    const p = bed.kubi.readPan();
    await bed.elapse(100);
    const pan = await p;
    expect(pan).toBeInstanceOf(Observed);
    expect(Math.abs(pan.value - 45)).toBeLessThan(reachSlackDeg); // 目標の少し手前で止まる
    expect(pan.observedAt).toBeInstanceOf(Date);
  });

  it('基本 API 以外の公開面は残っている', () => {
    expect(members().sort()).toEqual(
      [
        // connection
        'capabilities',
        'connectionState',
        'device',
        'bluetoothAvailability',
        'onConnectionChange',
        'onBluetoothAvailabilityChange',
        'connect',
        'disconnect',
        'dispose',
        // servo（基本 API）
        'writePanGoal',
        'writeTiltGoal',
        'writePanSpeed',
        'writeTiltSpeed',
        'readPan',
        'readTilt',
        // speed
        'speed',
        // status / device-info
        'readBatteryVoltage',
        'batteryStatus',
        'onBatteryStatusChange',
        'onServoFault',
        'buttonPressed',
        'onButtonChange',
        'readDeviceInfo',
        // diagnostics
        'onDiagnostic',
      ].sort(),
    );
    expect(typeof Kubi.forBrowser).toBe('function');
    // 実行時に見える export。型だけの export は dist/index.d.ts で確かめる。
    expect(Object.keys(api).sort()).toEqual(
      ['Kubi', 'KubiDisposedError', 'KubiError', 'KubiUnsupportedError', 'Observed', 'TransportError', 'defaultSpeed', 'panRange', 'speedRange', 'tiltRange'].sort(),
    );
  });
});

// 「公開しない操作の契約は内部の振る舞いとして維持する」/ 公開されていない操作も契約どおりに動く:
// move.test.ts・drive.test.ts・stop.test.ts・observation.test.ts・command-delivery.test.ts が `bed.adv` 経由で確かめている。

describe('foundation: 操作を呼ばない限り device と通信しない', () => {
  it('何も呼ばなければ通信が出ない。速度の設定の読み出しも通信しない', async () => {
    const bed = await makeBed();
    const writes0 = bed.transport.writes.length;
    const reads0 = bed.transport.link!.readRequestCount;
    await bed.elapse(5000);
    expect(bed.kubi.speed.pan).toBeCloseTo(60, 0); // 既定値を device の刻みに合わせた値
    expect(bed.transport.writes.length).toBe(writes0);
    expect(bed.transport.link!.readRequestCount).toBe(reads0);
  });

  it('目標を書いた後も、呼ばなければ読まない', async () => {
    const bed = await makeBed();
    await bed.kubi.writePanGoal(60);
    const writes0 = bed.transport.writes.length;
    const reads0 = bed.transport.link!.readRequestCount;
    await bed.elapse(5000); // 首が動いて止まるまで
    expect(bed.transport.writes.length).toBe(writes0);
    expect(bed.transport.link!.readRequestCount).toBe(reads0);
  });
});
