/**
 * protocol: conversions between values and byte frames. Pure functions only; touches neither the DOM nor the engine.
 *
 * The reference vectors are in `spec/vectors/protocol.json`, pinned by `test/vectors.test.ts`.
 * Based on the Kubi 2.0 BLE specification v1.7 (2026-10-08).
 *
 * The GATT section below is written in English because it reaches the published type definitions
 * through `Characteristic`. The rest of this file is internal.
 */
import type { Axis } from '../types.js';

// ---------------------------------------------------------------------------
// GATT
// ---------------------------------------------------------------------------

/** Custom Control service (neck control). A 128-bit vendor UUID. */
export const CONTROL_SERVICE_UUID = '2a001800-2803-2801-2800-1d9ff2d5c442';
/** Custom Status service (device status). */
export const STATUS_SERVICE_UUID = '0000e001-0000-1000-8000-00805f9b34fb';
/** Device Information service (standard). */
export const DEVICE_INFORMATION_SERVICE_UUID = 0x180a;

const base = (short: string): string => `0000${short}-0000-1000-8000-00805f9b34fb`;

/** Characteristic UUIDs. The dummy characteristics (`9141` `9143` `9149`) and the LED (`e104`) are deliberately absent. */
export const CHARACTERISTIC_UUID = {
  /** `9142` 2-byte register write (speed). */
  registerWrite2: base('9142'),
  /** `9144` 2-byte register read request (present position). */
  registerRead2: base('9144'),
  /** `9145` pan goal position. */
  panGoal: base('9145'),
  /** `9146` tilt goal position. */
  tiltGoal: base('9146'),
  /** `9147` response to a read request (Notify). **Kubi ignores writes until this is enabled.** */
  readResponse: base('9147'),
  /** `e101` battery voltage (mV, little-endian). */
  batteryVoltage: base('e101'),
  /** `e102` servo error kind (bit flags, Notify). */
  servoError: base('e102'),
  /** `e103` ID of the servo that reported the error. */
  servoErrorAxis: base('e103'),
  /** `e105` battery status (bit flags, Notify). */
  batteryStatus: base('e105'),
  /** `e10a` device button (Notify). */
  button: base('e10a'),
  /** `2A25` serial number. */
  serialNumber: 0x2a25,
  /** `2A24` model number. */
  modelNumber: 0x2a24,
  /** `2A29` manufacturer name. */
  manufacturer: 0x2a29,
  /** `2A27` hardware revision. */
  hardwareRevision: 0x2a27,
  /** `2A26` firmware revision. */
  firmwareRevision: 0x2a26,
} as const;

/** Characteristic names. The transport and the engine refer to characteristics by name; UUIDs stay inside protocol. */
export type Characteristic = keyof typeof CHARACTERISTIC_UUID;

/** Characteristics required to move the neck. If any is missing the device is not connected (the old Kubi lacks `9147`). */
export const REQUIRED_CHARACTERISTICS: readonly Characteristic[] = [
  'registerWrite2',
  'registerRead2',
  'panGoal',
  'tiltGoal',
  'readResponse',
];

/** Device name prefix. A real example is `kubi24587CEFC55E`. */
export const DEVICE_NAME_PREFIX = 'kubi';

// ---------------------------------------------------------------------------
// servo（Dynamixel AX-12 互換）
// ---------------------------------------------------------------------------

/** 軸の motor id。pan = 1、tilt = 2。 */
export function motorId(axis: Axis): number {
  return axis === 'pan' ? 1 : 2;
}

/** motor id → 軸。1 / 2 以外は `null`。 */
export function axisOfMotorId(id: number): Axis | null {
  return id === 1 ? 'pan' : id === 2 ? 'tilt' : null;
}

/** Moving Speed レジスタ。`0` は「速度制限なし」の予約値なので書かない。 */
export const REGISTER_MOVING_SPEED = 0x20;
/** Present Position レジスタ（実測位置）。 */
export const REGISTER_PRESENT_POSITION = 0x24;

/** 位置レジスタの値域。0 … 1023 が −150° … +150°。 */
export const RAW_POSITION_MAX = 1023;
/** 速度レジスタの下限（0 を含まない）。 */
export const RAW_SPEED_MIN = 1;
/** 速度レジスタの上限。仕様書 v1.7 §5.4 の「動作が保証される範囲」の上端（約 104°/s）。指定できる範囲の端 1023 は使わない。 */
export const RAW_SPEED_MAX = 156;
/** 速度レジスタ 1 段階の角速度（度毎秒）。AX-12A 公称 0.111 rpm/step × 6。 */
export const DEG_PER_SEC_PER_RAW_STEP = 0.111 * 6;

// ---------------------------------------------------------------------------
// 変換
// ---------------------------------------------------------------------------

/** 角度 → 位置レジスタ値。`round((deg + 150) × 1023 / 300)`。0° は 512。−150 … 150 の外は端に留める。 */
export function degToRaw(deg: number): number {
  const d = Math.min(150, Math.max(-150, deg));
  return clampInt(Math.round(((d + 150) * RAW_POSITION_MAX) / 300), 0, RAW_POSITION_MAX);
}

/** 位置レジスタ値 → 角度。`raw × 300 / 1023 − 150`。端は刻みに乗らないので公称範囲をわずかに外れ得る。 */
export function rawToDeg(raw: number): number {
  return (raw * 300) / RAW_POSITION_MAX - 150;
}

/** 速度（度毎秒） → 速度レジスタ値。1 … 1023 に留める（`0` は書かない）。符号は捨てる。 */
export function degPerSecToRaw(degPerSec: number): number {
  return clampInt(Math.round(Math.abs(degPerSec) / DEG_PER_SEC_PER_RAW_STEP), RAW_SPEED_MIN, RAW_SPEED_MAX);
}

/** 速度レジスタ値 → 速度（度毎秒）。 */
export function rawToDegPerSec(raw: number): number {
  return raw * DEG_PER_SEC_PER_RAW_STEP;
}

function clampInt(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// ---------------------------------------------------------------------------
// フレーム（首の操作）
// ---------------------------------------------------------------------------

/** 目標位置の payload（`9145` / `9146`）。**上位が先**の 2 byte。 */
export function encodeGoal(raw: number): Uint8Array {
  return Uint8Array.of((raw >> 8) & 0xff, raw & 0xff);
}

/** 2 byte レジスタ書き込みの payload（`9142`）。`[motorId, register, lo, hi]`（**下位が先**）。 */
export function encodeRegisterWrite2(axis: Axis, register: number, value: number): Uint8Array {
  return Uint8Array.of(motorId(axis), register & 0xff, value & 0xff, (value >> 8) & 0xff);
}

/** レジスタ読み取り要求の payload（`9144`）。`[motorId, register]`。 */
export function encodeRegisterRead(axis: Axis, register: number): Uint8Array {
  return Uint8Array.of(motorId(axis), register & 0xff);
}

/** 復号した `9147` の応答。 */
export interface RegisterReadResponse {
  readonly axis: Axis;
  readonly register: number;
  /** 値（下位が先で復号済み）。 */
  readonly value: number;
}

/**
 * `9147` の応答フレームを復号する。実機のフレームは `[motorId, register, length, lo, hi]`。
 * 先頭 2 byte で「どの軸のどのレジスタへの応答か」が分かるので、要求と突き合わせられる。形が合わなければ `null`。
 */
export function decodeRegisterReadResponse(bytes: Uint8Array): RegisterReadResponse | null {
  if (bytes.length < 4) return null;
  const axis = axisOfMotorId(bytes[0]!);
  if (axis === null) return null;
  const register = bytes[1]!;
  const length = bytes[2]!;
  if (length === 1) return { axis, register, value: bytes[3]! };
  if (length === 2 && bytes.length >= 5) return { axis, register, value: bytes[3]! | (bytes[4]! << 8) };
  return null;
}

// ---------------------------------------------------------------------------
// フレーム（本体の状態）—— 先頭の必要バイトだけを見て、余分なバイトは無視する
// ---------------------------------------------------------------------------

/** `e101` → バッテリー電圧（mV）。下位が先の 2 byte。短ければ `null`。 */
export function decodeBatteryVoltage(bytes: Uint8Array): number | null {
  if (bytes.length < 2) return null;
  return bytes[0]! | (bytes[1]! << 8);
}

/** サーボエラーの種類。仕様書 v1.7 p.10 の bit 0 / 2 / 4 / 5。 */
export interface ServoErrorFlags {
  /** bit 0 入力電圧が動作範囲を超えた。 */
  readonly inputVoltage: boolean;
  /** bit 2 内部温度が動作温度を超えた。 */
  readonly overheating: boolean;
  /** bit 4 回路の電気的障害、またはモーターを動かす電力の不足。 */
  readonly electricalShock: boolean;
  /** bit 5 最大出力を超える負荷が継続（手で押さえた等）。 */
  readonly overload: boolean;
}

/** `e102` → エラーの種類。先頭 1 byte だけを見る（2 byte 目の意味は実機で確かめるまで不明）。空なら `null`。 */
export function decodeServoErrorFlags(bytes: Uint8Array): ServoErrorFlags | null {
  if (bytes.length < 1) return null;
  const b = bytes[0]!;
  return {
    inputVoltage: (b & 0x01) !== 0,
    overheating: (b & 0x04) !== 0,
    electricalShock: (b & 0x10) !== 0,
    overload: (b & 0x20) !== 0,
  };
}

/** エラーが 1 つも立っていないか（解消の通知の判定に使う）。 */
export function isServoErrorClear(flags: ServoErrorFlags): boolean {
  return !flags.inputVoltage && !flags.overheating && !flags.electricalShock && !flags.overload;
}

/** `e103` → エラーが起きた軸。先頭 1 byte。1 / 2 以外は `null`。 */
export function decodeServoErrorAxis(bytes: Uint8Array): Axis | null {
  if (bytes.length < 1) return null;
  return axisOfMotorId(bytes[0]!);
}

/** バッテリー状態。bit 1（battStateCritical）は意味が未確定なので公開しない。 */
export interface BatteryStatus {
  /** bit 3 充電中。 */
  readonly charging: boolean;
  /** bit 2 残量が少ない。 */
  readonly low: boolean;
}

/** `e105` → バッテリー状態。先頭 1 byte。空なら `null`。 */
export function decodeBatteryStatus(bytes: Uint8Array): BatteryStatus | null {
  if (bytes.length < 1) return null;
  const b = bytes[0]!;
  return { charging: (b & 0x08) !== 0, low: (b & 0x04) !== 0 };
}

/** `e10a` → ボタンが押されているか。先頭 1 byte。`0x01` = 押している。空なら `null`。 */
export function decodeButton(bytes: Uint8Array): boolean | null {
  if (bytes.length < 1) return null;
  return bytes[0] === 0x01;
}

/** Device Information の文字列（UTF-8）。末尾の NUL と空白は落とす。 */
export function decodeUtf8String(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes).replace(/\0+$/, '').trim();
}

/** `"02 00"` のような 16 進表記 → バイト列。テストベクタと診断で使う。 */
export function hexToBytes(hex: string): Uint8Array {
  const parts = hex.trim().split(/\s+/).filter((p) => p.length > 0);
  return Uint8Array.from(parts.map((p) => parseInt(p, 16)));
}

/** バイト列 → `"02 00"` のような 16 進表記（大文字・空白区切り）。 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}
