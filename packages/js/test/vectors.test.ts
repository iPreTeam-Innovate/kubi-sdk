/**
 * `spec/vectors/protocol.json` を読んで protocol を固定する。他言語の実装も同じファイルを読む。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as p from '../src/protocol/index.js';
import type { Axis } from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(here, '../../../spec/vectors/protocol.json'), 'utf8')) as Record<
  string,
  Array<Record<string, unknown>>
>;

const hex = (s: unknown): Uint8Array => p.hexToBytes(String(s));
const label = (v: Record<string, unknown>): string => JSON.stringify(v).slice(0, 80);

describe('protocol vectors', () => {
  it('degToRaw', () => {
    for (const v of vectors['degToRaw']!) expect(p.degToRaw(v['deg'] as number), label(v)).toBe(v['raw']);
  });

  it('rawToDeg', () => {
    for (const v of vectors['rawToDeg']!)
      expect(p.rawToDeg(v['raw'] as number), label(v)).toBeCloseTo(v['deg'] as number, 3);
  });

  it('degPerSecToRaw', () => {
    for (const v of vectors['degPerSecToRaw']!)
      expect(p.degPerSecToRaw(v['degPerSec'] as number), label(v)).toBe(v['raw']);
  });

  it('rawToDegPerSec', () => {
    for (const v of vectors['rawToDegPerSec']!)
      expect(p.rawToDegPerSec(v['raw'] as number), label(v)).toBeCloseTo(v['degPerSec'] as number, 3);
  });

  it('encodeGoal', () => {
    for (const v of vectors['encodeGoal']!) expect(p.bytesToHex(p.encodeGoal(v['raw'] as number)), label(v)).toBe(v['bytes']);
  });

  it('encodeRegisterWrite2', () => {
    for (const v of vectors['encodeRegisterWrite2']!)
      expect(
        p.bytesToHex(p.encodeRegisterWrite2(v['axis'] as Axis, v['register'] as number, v['value'] as number)),
        label(v),
      ).toBe(v['bytes']);
  });

  it('encodeRegisterRead', () => {
    for (const v of vectors['encodeRegisterRead']!)
      expect(p.bytesToHex(p.encodeRegisterRead(v['axis'] as Axis, v['register'] as number)), label(v)).toBe(v['bytes']);
  });

  it('decodeRegisterReadResponse', () => {
    for (const v of vectors['decodeRegisterReadResponse']!) {
      const r = p.decodeRegisterReadResponse(hex(v['bytes']));
      if ('result' in v) expect(r, label(v)).toBeNull();
      else expect(r, label(v)).toEqual({ axis: v['axis'], register: v['register'], value: v['value'] });
    }
  });

  it('decodeBatteryVoltage', () => {
    for (const v of vectors['decodeBatteryVoltage']!) {
      const r = p.decodeBatteryVoltage(hex(v['bytes']));
      if ('result' in v) expect(r, label(v)).toBeNull();
      else expect(r, label(v)).toBe(v['mV']);
    }
  });

  it('decodeServoErrorFlags', () => {
    for (const v of vectors['decodeServoErrorFlags']!) {
      const r = p.decodeServoErrorFlags(hex(v['bytes']));
      if ('result' in v) expect(r, label(v)).toBeNull();
      else
        expect(r, label(v)).toEqual({
          inputVoltage: v['inputVoltage'],
          overheating: v['overheating'],
          electricalShock: v['electricalShock'],
          overload: v['overload'],
        });
    }
  });

  it('decodeServoErrorAxis', () => {
    for (const v of vectors['decodeServoErrorAxis']!) {
      const r = p.decodeServoErrorAxis(hex(v['bytes']));
      if ('result' in v) expect(r, label(v)).toBeNull();
      else expect(r, label(v)).toBe(v['axis']);
    }
  });

  it('decodeBatteryStatus', () => {
    for (const v of vectors['decodeBatteryStatus']!) {
      const r = p.decodeBatteryStatus(hex(v['bytes']));
      if ('result' in v) expect(r, label(v)).toBeNull();
      else expect(r, label(v)).toEqual({ charging: v['charging'], low: v['low'] });
    }
  });

  it('decodeButton', () => {
    for (const v of vectors['decodeButton']!) {
      const r = p.decodeButton(hex(v['bytes']));
      if ('result' in v) expect(r, label(v)).toBeNull();
      else expect(r, label(v)).toBe(v['pressed']);
    }
  });

  it('round trip: deg → raw → deg stays within one step', () => {
    for (let deg = -150; deg <= 150; deg += 7.3) {
      expect(Math.abs(p.rawToDeg(p.degToRaw(deg)) - deg)).toBeLessThanOrEqual(300 / 1023 / 2 + 1e-9);
    }
  });
});
