/**
 * テスト用の決定的な transport —— FakeTransport / FakeLink / FakeServo。
 * 時計は `Date.now()` と `setTimeout`（vitest の fake timers で進める）。
 *
 * | 層 | 何をするか |
 * |---|---|
 * | FakeTransport | 能力・可用性・picker・リンクの生成 |
 * | FakeLink      | 書き込みの記録と ACK、`9147` の応答、Notify の注入、切断 |
 * | FakeServo     | 軸ごとの goal / speed / present。時間が進むと present が goal へ近づく |
 */
import {
  CHARACTERISTIC_UUID,
  REGISTER_MOVING_SPEED,
  REGISTER_PRESENT_POSITION,
  REQUIRED_CHARACTERISTICS,
  degPerSecToRaw,
  degToRaw,
  rawToDeg,
  rawToDegPerSec,
  type Characteristic,
} from '../../src/protocol/index.js';
import { panRange, tiltRange } from '../../src/values.js';
import type { Axis, Range } from '../../src/types.js';
import {
  TransportError,
  type BluetoothAvailability,
  type KubiLink,
  type KubiTransport,
  type PickResult,
  type TransportCapabilities,
} from '../../src/transport/types.js';

export interface FakeWrite {
  readonly characteristic: Characteristic;
  readonly bytes: Uint8Array;
  readonly at: number;
}

/** 書き込みの意味（テストが並びを読むため）。`pan速さ` `tilt到達点` `pan読み取り` の形。 */
export function describeWrite(w: FakeWrite): string {
  const axisOf = (id: number): string => (id === 1 ? 'pan' : id === 2 ? 'tilt' : '?');
  switch (w.characteristic) {
    case 'panGoal':
      return 'pan到達点';
    case 'tiltGoal':
      return 'tilt到達点';
    case 'registerWrite2':
      return `${axisOf(w.bytes[0]!)}${w.bytes[1] === REGISTER_MOVING_SPEED ? '速さ' : 'レジスタ'}`;
    case 'registerRead2':
      return `${axisOf(w.bytes[0]!)}読み取り`;
    default:
      return w.characteristic;
  }
}

/** 軸 1 本ぶんの servo のシミュレーション。実機は目標ぴったりでは止まらない（4 LSB 手前）。 */
export class FakeServo {
  constructor(
    readonly axis: Axis,
    public reachable: Range,
  ) {}

  presentDeg = 0;
  goalRaw = degToRaw(0);
  /** 動きに使っている速度。**最後に目標を書いた時点の速度レジスタの値**（実機 S-A6: 速度は次の目標書き込みから効く）。 */
  speedRaw = degPerSecToRaw(60);
  /** 速度レジスタ（`9142` で書いた値）。次の目標書き込みで `speedRaw` に写る。 */
  speedRegisterRaw = degPerSecToRaw(60);
  /** 真の間、時間が進んでも動かない（手で押さえられている）。 */
  frozen = false;
  /** servo の不感帯（度）。1 LSB 未満の差では動かない。 */
  static readonly deadbandDeg = 300 / 1023;
  /** 止まる手前の不感帯（度）。実機の中央値 4 LSB。 */
  settleGapDeg = (4 * 300) / 1023;
  /** 今の速度（度毎秒・符号付き）。 */
  velocityDegPerSec = 0;
  /** 加減速（度毎秒毎秒）。本体は速度を一定の割合でしか変えない（実機 S-A8: 約 68°/s²）。 */
  static readonly accelDegPerSec2 = 68;

  get goalDeg(): number {
    return rawToDeg(this.goalRaw);
  }
  /** 動きに使っている速度（度毎秒）。 */
  get speedDegPerSec(): number {
    return rawToDegPerSec(this.speedRaw);
  }
  /** 速度レジスタの値（度毎秒）。書いただけでまだ効いていない速度もここに出る。 */
  get speedRegisterDegPerSec(): number {
    return rawToDegPerSec(this.speedRegisterRaw);
  }

  /** 目標の書き込み。device はこのときに速度レジスタの値を動きに使い始める。 */
  writeGoal(raw: number): void {
    this.goalRaw = raw;
    this.speedRaw = this.speedRegisterRaw;
  }
  get presentRaw(): number {
    return degToRaw(this.presentDeg);
  }

  /** 首を置く（手で動かす / 初期位置）。目標も同じ位置にする。 */
  placeAt(deg: number): void {
    this.presentDeg = deg;
    this.goalRaw = degToRaw(deg);
    this.velocityDegPerSec = 0;
  }

  /**
   * 一定の加減速の速度プロファイル。目標が前にあれば「減速しきれる最大の速さ」と速度の上限の小さい方へ、
   * 目標が後ろにあれば減速 → 反転して戻る。だから目標を首より手前に書くと、行き過ぎてから戻る（実機 S-A8）。
   */
  step(dtMs: number): void {
    if (this.frozen) {
      this.velocityDegPerSec = 0;
      return;
    }
    const dt = dtMs / 1000;
    const a = FakeServo.accelDegPerSec2;
    const target = Math.min(this.reachable.max, Math.max(this.reachable.min, this.goalDeg));
    const diff = target - this.presentDeg;
    const adiff = Math.abs(diff);
    const v = this.velocityDegPerSec;
    if (v === 0 && (adiff < FakeServo.deadbandDeg || adiff <= this.settleGapDeg)) return;
    const dir = diff < 0 ? -1 : 1;
    const remaining = Math.max(0, adiff - this.settleGapDeg);
    const desired = remaining === 0 ? 0 : dir * Math.min(Math.abs(this.speedDegPerSec), Math.sqrt(2 * a * remaining));
    const dv = desired - v;
    const nv = Math.abs(dv) <= a * dt ? desired : v + Math.sign(dv) * a * dt;
    const step = nv * dt;
    if (nv * dir >= 0 && Math.abs(step) >= remaining && Math.abs(nv) <= Math.sqrt(2 * a * remaining) + a * dt) {
      // 目標の手前の不感帯に着いた
      this.presentDeg = target - dir * Math.min(this.settleGapDeg, adiff);
      this.velocityDegPerSec = 0;
      return;
    }
    this.velocityDegPerSec = nv;
    this.presentDeg += step;
  }
}

export class FakeTransport implements KubiTransport {
  constructor(opts: { providesDevicePicker?: boolean; canScan?: boolean } = {}) {
    this.capabilities = { providesDevicePicker: opts.providesDevicePicker ?? true, canScan: opts.canScan ?? false };
  }

  readonly capabilities: TransportCapabilities;
  private avail: BluetoothAvailability = 'available';
  private readonly availSubs = new Set<(a: BluetoothAvailability) => void>();

  get availability(): BluetoothAvailability {
    return this.avail;
  }
  setAvailability(a: BluetoothAvailability): void {
    if (a === this.avail) return;
    this.avail = a;
    for (const cb of Array.from(this.availSubs)) cb(a);
  }
  onAvailabilityChange(cb: (a: BluetoothAvailability) => void): () => void {
    this.availSubs.add(cb);
    return () => {
      this.availSubs.delete(cb);
    };
  }

  /** picker の結果。`null` = 選ばなかった。 */
  pickerResult: { id: string; name: string | null } | null = { id: 'kubi-0001', name: 'kubi000012AB01' };
  /** 選んだ端末に繋げない（圏外）。 */
  unreachable = false;
  /** picker が開かれた回数（呼ばれた瞬間に増える）。 */
  pickerOpenCount = 0;
  /** リンクを作る前に待つ時間（ms）。 */
  openDelayMs = 0;
  /** 持たない特性（Status が無い機体・旧 kubi など）。 */
  readonly missing = new Set<Characteristic>();
  /** リンクが作られた直後に呼ばれる。 */
  onLinkOpened: ((link: FakeLink) => void) | null = null;

  readonly servos: Record<Axis, FakeServo> = {
    pan: new FakeServo('pan', panRange),
    tilt: new FakeServo('tilt', tiltRange),
  };
  readonly links: FakeLink[] = [];

  get pan(): FakeServo {
    return this.servos.pan;
  }
  get tilt(): FakeServo {
    return this.servos.tilt;
  }
  get link(): FakeLink | null {
    for (let i = this.links.length - 1; i >= 0; i--) if (!this.links[i]!.isClosed) return this.links[i]!;
    return null;
  }
  get writes(): FakeWrite[] {
    return this.link?.writes ?? [];
  }

  pick(): Promise<PickResult> {
    if (!this.capabilities.providesDevicePicker) throw new TransportError('この経路は picker を持たない');
    this.pickerOpenCount++;
    const chosen = this.pickerResult;
    return (async (): Promise<PickResult> => {
      await Promise.resolve();
      if (chosen === null) return { ok: false, reason: 'notSelected' };
      if (this.openDelayMs > 0) await new Promise((r) => setTimeout(r, this.openDelayMs));
      if (this.unreachable) return { ok: false, reason: 'couldNotConnect', detail: '圏外' };
      const required = REQUIRED_CHARACTERISTICS.filter((c) => this.missing.has(c));
      if (required.length > 0) return { ok: false, reason: 'couldNotConnect', detail: `必須の特性が無い: ${required.join(', ')}` };
      const link = new FakeLink(chosen, this.servos, this.missing);
      this.links.push(link);
      this.onLinkOpened?.(link);
      return { ok: true, link };
    })();
  }

  /** 今のリンクを外から失わせる（電源が落ちた / 圏外）。 */
  loseLink(): void {
    this.link?.loseLink();
  }
}

export class FakeLink implements KubiLink {
  constructor(
    readonly device: { id: string; name: string | null },
    private readonly servos: Record<Axis, FakeServo>,
    private readonly missing: Set<Characteristic>,
  ) {
    this.ticker = setInterval(() => this.tick(), FakeLink.tickMs);
  }

  static readonly tickMs = 10;
  private ticker: ReturnType<typeof setInterval>;
  private closed = false;
  private inFlight = 0;
  private readonly subs = new Map<Characteristic, Set<(b: Uint8Array) => void>>();
  private readonly disconnectSubs = new Set<() => void>();

  readonly writes: FakeWrite[] = [];
  /** 速度 `0` の書き込み。1 件でもあれば契約違反。 */
  readonly zeroSpeedWrites: FakeWrite[] = [];
  /** 同時に走った書き込み。直列化されていれば空。 */
  readonly overlappingWrites: FakeWrite[] = [];
  /** ACK までの時間（ms）。0 でも 1 マイクロタスク挟む。 */
  ackDelayMs = 0;
  /** 読み取り要求から `9147` の応答までの時間（ms）。 */
  readResponseDelayMs = 20;
  /** 真なら読み取り要求の応答を ACK を待たずに出す（`readResponseDelayMs` < `ackDelayMs` で「応答が先」になる）。 */
  responseBeforeAck = false;
  /** この軸への読み取りに応答しない。 */
  readonly silentAxes = new Set<Axis>();
  /** 先頭 N 件の読み取り要求に応答しない。 */
  dropNextResponses = 0;
  /** 真を返す書き込みを失敗させる（リンクは生きたまま）。 */
  failWriteWhen: ((w: FakeWrite) => boolean) | null = null;
  /** `close()` が終わるまでの時間（teardown の間を観測する）。 */
  closeDelayMs = 0;
  readRequestCount = 0;

  // 本体の状態（Status / Device Information の Read に答える）
  batteryMv = 3700;
  batteryStatusByte = 0x01;
  buttonByte = 0x00;
  servoErrorByte = 0x00;
  servoErrorAxisByte = 0x01;
  readonly deviceInfo: Record<string, string> = {
    serialNumber: 'EFC55E',
    modelNumber: 'iPre-K',
    manufacturer: 'iPresence Co., Ltd.',
    hardwareRevision: '1.0.0',
    firmwareRevision: '1.1.1',
  };

  get isClosed(): boolean {
    return this.closed;
  }
  get inFlightWrites(): number {
    return this.inFlight;
  }

  has(c: Characteristic): boolean {
    return !this.missing.has(c);
  }

  private tick(): void {
    for (const a of ['pan', 'tilt'] as const) this.servos[a].step(FakeLink.tickMs);
  }

  async write(c: Characteristic, bytes: Uint8Array): Promise<void> {
    if (this.closed) throw new TransportError('リンクが失われている');
    if (!this.has(c)) throw new TransportError(`特性 ${c} は無い`);
    const w: FakeWrite = { characteristic: c, bytes: Uint8Array.from(bytes), at: Date.now() };
    this.writes.push(w);
    if (c === 'registerWrite2' && bytes[1] === REGISTER_MOVING_SPEED && (bytes[2]! | (bytes[3]! << 8)) === 0) this.zeroSpeedWrites.push(w);
    this.inFlight++;
    if (this.inFlight > 1) this.overlappingWrites.push(w);
    // Chrome / macOS では読み取り要求の応答（9147）が要求の ACK より先に届くことがある。その順序を再現する
    const early = this.responseBeforeAck && c === 'registerRead2';
    if (early) this.apply(w);
    try {
      if (this.ackDelayMs > 0) await new Promise((r) => setTimeout(r, this.ackDelayMs));
      else await Promise.resolve();
      if (this.closed) throw new TransportError('書き込みの途中でリンクが失われた');
      if (this.failWriteWhen?.(w)) throw new TransportError('書き込みが失敗した');
      if (!early) this.apply(w);
    } finally {
      this.inFlight--;
    }
  }

  private apply(w: FakeWrite): void {
    const axisOf = (id: number): Axis | null => (id === 1 ? 'pan' : id === 2 ? 'tilt' : null);
    switch (w.characteristic) {
      case 'panGoal':
        this.servos.pan.writeGoal((w.bytes[0]! << 8) | w.bytes[1]!);
        return;
      case 'tiltGoal':
        this.servos.tilt.writeGoal((w.bytes[0]! << 8) | w.bytes[1]!);
        return;
      case 'registerWrite2': {
        const a = axisOf(w.bytes[0]!);
        if (a && w.bytes[1] === REGISTER_MOVING_SPEED) this.servos[a].speedRegisterRaw = w.bytes[2]! | (w.bytes[3]! << 8);
        return;
      }
      case 'registerRead2': {
        const a = axisOf(w.bytes[0]!);
        const reg = w.bytes[1]!;
        this.readRequestCount++;
        if (!a) return;
        if (this.silentAxes.has(a)) return;
        if (this.dropNextResponses > 0) {
          this.dropNextResponses--;
          return;
        }
        setTimeout(() => {
          if (this.closed) return;
          const value = reg === REGISTER_PRESENT_POSITION ? this.servos[a].presentRaw : reg === REGISTER_MOVING_SPEED ? this.servos[a].speedRegisterRaw : 0;
          this.notify('readResponse', Uint8Array.of(a === 'pan' ? 1 : 2, reg, 2, value & 0xff, (value >> 8) & 0xff));
        }, this.readResponseDelayMs);
        return;
      }
      default:
        return;
    }
  }

  async read(c: Characteristic): Promise<Uint8Array> {
    if (this.closed) throw new TransportError('リンクが失われている');
    if (!this.has(c)) throw new TransportError(`特性 ${c} は無い`);
    await Promise.resolve();
    switch (c) {
      case 'batteryVoltage':
        return Uint8Array.of(this.batteryMv & 0xff, (this.batteryMv >> 8) & 0xff);
      case 'batteryStatus':
        return Uint8Array.of(this.batteryStatusByte);
      case 'button':
        return Uint8Array.of(this.buttonByte);
      case 'servoError':
        return Uint8Array.of(this.servoErrorByte, 0x00);
      case 'servoErrorAxis':
        return Uint8Array.of(this.servoErrorAxisByte, 0x00);
      case 'serialNumber':
      case 'modelNumber':
      case 'manufacturer':
      case 'hardwareRevision':
      case 'firmwareRevision':
        return new TextEncoder().encode(this.deviceInfo[c] ?? '');
      default:
        throw new TransportError(`${c} は Read できない`);
    }
  }

  async subscribe(c: Characteristic, cb: (bytes: Uint8Array) => void): Promise<() => void> {
    if (this.closed) throw new TransportError('リンクが失われている');
    if (!this.has(c)) throw new TransportError(`特性 ${c} は無い`);
    await Promise.resolve();
    let set = this.subs.get(c);
    if (!set) {
      set = new Set();
      this.subs.set(c, set);
    }
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  /** Notify を注入する（テストから。`e102` `e105` `e10a` と `9147`）。 */
  notify(c: Characteristic, bytes: Uint8Array): void {
    if (this.closed) return;
    for (const cb of Array.from(this.subs.get(c) ?? [])) cb(bytes);
  }

  onDisconnected(cb: () => void): () => void {
    this.disconnectSubs.add(cb);
    return () => {
      this.disconnectSubs.delete(cb);
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (this.closeDelayMs > 0) await new Promise((r) => setTimeout(r, this.closeDelayMs));
    this.teardown();
  }

  /** 外からリンクを失わせる。 */
  loseLink(): void {
    this.teardown();
  }

  private teardown(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.ticker);
    for (const cb of Array.from(this.disconnectSubs)) cb();
  }
}

/** 診断の特性名 → 表示。 */
export const uuidOf = CHARACTERISTIC_UUID;
