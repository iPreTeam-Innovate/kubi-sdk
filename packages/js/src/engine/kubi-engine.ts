/**
 * engine —— 制御ループ・状態・停止の割り込み・観測・初期同期。
 *
 * 通信の並びの規則:
 *   - in-flight の通信は常に 1 本
 *   - 停止は周の外（制動 → 100ms → 保持の読み取り → 保持の到達点）。飛行中の 1 本だけ待つ
 *   - 1 周 = [pan の 2 本] → [tilt の 2 本] → [読み取り]。move は 速さ → 到達点、drive は 到達点 → 速さ
 *   - 書くものが無ければ、動いている軸を 120ms に 1 本読む
 *   - 状態の読み出し（電圧・デバイス情報）は末尾
 *
 * DOM にも経路の API にも触れない。見るのは `KubiTransport` / `KubiLink` だけ。
 */
import {
  CHARACTERISTIC_UUID,
  REGISTER_MOVING_SPEED,
  REGISTER_PRESENT_POSITION,
  RAW_SPEED_MAX,
  RAW_POSITION_MAX,
  RAW_SPEED_MIN,
  decodeBatteryStatus,
  decodeBatteryVoltage,
  decodeButton,
  decodeRegisterReadResponse,
  decodeServoErrorAxis,
  decodeServoErrorFlags,
  decodeUtf8String,
  degPerSecToRaw,
  degToRaw,
  encodeGoal,
  encodeRegisterRead,
  encodeRegisterWrite2,
  rawToDeg,
  rawToDegPerSec,
  type Characteristic,
} from '../protocol/index.js';
import type { KubiLink, KubiTransport } from '../transport/types.js';
import { KubiDisposedError, KubiError, KubiUnsupportedError } from '../errors.js';
import { clampTo, defaultSpeed, panRange, speedRange, tiltRange } from '../values.js';
import {
  Observed,
  Snapshot,
  type Axis,
  type AxisMotion,
  type AxisSnapshot,
  type AxisValues,
  type BatteryStatus,
  type BluetoothAvailability,
  type ConnectResult,
  type ConnectionChange,
  type ConnectionState,
  type DeviceInfo,
  type DiagnosticEvent,
  type DriveHalt,
  type DriveOptions,
  type KubiDevice,
  type MoveOptions,
  type MoveResult,
  type PanTilt,
  type ServoFault,
  type StayResult,
  type WritePurpose,
} from '../types.js';
import { AxisState } from './axis-state.js';
import { Emitter } from './emitter.js';

// --- 校正値（公開しない。実機で決めた値） -------------------------------------------------------------

/** 動いている軸の測定間隔。 */
const POLL_INTERVAL_MS = 120;
/** 応答が来ない読み取りを打ち切る内部上限。 */
const READ_TIMEOUT_MS = 800;
/** 本体の加減速（度毎秒毎秒）。停止で「減速しきる位置」を計算するのに使う。60 °/s からの減速の実測で約 68。 */
const DECEL_DEG_PER_SEC2 = 68;
/** 停止の静止判定: 続けて動かなかった測定の回数。 */
const STAY_STILL_READS = 2;
/** present がこの間ほとんど動かなければ静止（遅い判定）。 */
const STALL_WINDOW_MS = 2000;
/** 進捗ありとみなす raw の差。 */
const STALL_THRESHOLD_RAW = 2;
/** 最後に見えた速さで 1 刻み進む時間の、この倍だけ動かなければ静止（速い判定）。 */
const STILL_STEPS = 3;
/** 目標に十分近いか（raw）。 */
const CONVERGE_TOLERANCE_RAW = 1;

const AXES: readonly Axis[] = ['pan', 'tilt'];

type MoveWaiter = {
  axes: Set<Axis>;
  clamped: boolean;
  seq: Partial<Record<Axis, number>>;
  resolve: (r: MoveResult) => void;
  reject: (e: unknown) => void;
  interrupts: Partial<Record<Axis, 'superseded' | 'stayed'>>;
  done: boolean;
};

/** 開発者の基本操作（servo）。呼ばれた順に 1 つずつ、周の外で出す。 */
type ExplicitOp =
  | { kind: 'goal'; axis: Axis; raw: number; resolve: () => void; reject: (e: unknown) => void }
  | { kind: 'speed'; axis: Axis; raw: number; resolve: () => void; reject: (e: unknown) => void }
  | { kind: 'read'; axis: Axis; resolve: (o: Observed) => void; reject: (e: unknown) => void };

type PendingRead = {
  axis: Axis;
  seq: number;
  kind: 'progress' | 'hold' | 'explicit';
  resolve: (raw: number | null) => void;
  timer: ReturnType<typeof setTimeout>;
  abandoned: boolean;
};

export class KubiEngine {
  constructor(private readonly transport: KubiTransport) {
    this.pan = new AxisState('pan', panRange, defaultSpeed);
    this.tilt = new AxisState('tilt', tiltRange, defaultSpeed);
    this.availability = transport.availability;
    this.unsubAvailability = transport.onAvailabilityChange((a) => {
      if (a === this.availability) return;
      this.availability = a;
      this.availabilityEmitter.emit(a);
    });
  }

  // --- 状態 -------------------------------------------------------------------------------------

  private readonly pan: AxisState;
  private readonly tilt: AxisState;
  private link: KubiLink | null = null;
  private connecting = false;
  private disconnectPromise: Promise<void> | null = null;
  private disposed = false;
  private connectionGen = 0;

  private state: ConnectionState = 'disconnected';
  private availability: BluetoothAvailability;
  private readonly unsubAvailability: () => void;
  private linkCleanups: Array<() => void> = [];

  private readonly connectionEmitter = new Emitter<ConnectionChange>();
  private readonly availabilityEmitter = new Emitter<BluetoothAvailability>();
  private readonly snapshotEmitter = new Emitter<Snapshot>();
  private readonly driveHaltEmitter = new Emitter<DriveHalt>();
  private readonly diagnosticEmitter = new Emitter<DiagnosticEvent>();
  private readonly batteryEmitter = new Emitter<BatteryStatus>();
  private readonly buttonEmitter = new Emitter<boolean>();
  private readonly servoErrorEmitter = new Emitter<ServoFault>();
  private lastSnapshot: Snapshot | null = null;

  private battery: BatteryStatus | null = null;
  private button: boolean | null = null;

  // 制御ループ
  private inFlight = false;
  private pumpScheduled = false;
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;
  private slot = 0; // 0 = pan, 1 = tilt, 2 = 読み取り
  private wroteThisCycle = false;
  private lastIdleReadAt = 0;
  private readonly moveWaiters: MoveWaiter[] = [];
  private readonly explicitOps: ExplicitOp[] = [];
  private pendingRead: PendingRead | null = null;
  private readonly tail: Array<() => Promise<void>> = [];
  /** 通信を 1 本出すたびに増える。pump が何もしなかった周で自分を呼び直さないために見る。 */
  private ioCount = 0;

  // --- 寿命・ガード ------------------------------------------------------------------------------

  private assertAlive(): void {
    if (this.disposed) throw new KubiDisposedError();
  }

  private requireLink(): KubiLink {
    const l = this.link;
    if (l === null || l.isClosed || this.state !== 'connected') {
      throw new KubiError('noLink', 'Kubi に繋がっていない。先に connect() を呼ぶこと。');
    }
    return l;
  }

  private axis(a: Axis): AxisState {
    return a === 'pan' ? this.pan : this.tilt;
  }

  private now(): number {
    return Date.now();
  }

  // --- connection ---------------------------------------------------------------------------------

  get capabilities(): { providesDevicePicker: boolean; canScan: boolean } {
    this.assertAlive();
    return this.transport.capabilities;
  }

  get connectionState(): ConnectionState {
    this.assertAlive();
    return this.state;
  }

  get device(): KubiDevice | null {
    this.assertAlive();
    return this.link?.device ?? null;
  }

  get bluetoothAvailability(): BluetoothAvailability {
    this.assertAlive();
    return this.availability;
  }

  onConnectionChange(cb: (c: ConnectionChange) => void): () => void {
    this.assertAlive();
    return this.connectionEmitter.on(cb);
  }

  onBluetoothAvailabilityChange(cb: (a: BluetoothAvailability) => void): () => void {
    this.assertAlive();
    return this.availabilityEmitter.on(cb);
  }

  /**
   * 経路の picker で選ばせて繋ぐ。**picker を開くより前に非同期処理を挟まない**（ジェスチャーの文脈を失わないため）。
   */
  connect(): Promise<ConnectResult> {
    this.assertAlive();
    if (!this.transport.capabilities.providesDevicePicker) {
      throw new KubiUnsupportedError('この経路は picker を持たない（providesDevicePicker が偽）');
    }
    if (this.connecting) return Promise.resolve({ type: 'notConnected', reason: 'connectionInProgress' });
    if (this.state === 'connected') return Promise.resolve({ type: 'notConnected', reason: 'alreadyConnected' });
    // 同期で picker を開く（pick() の先頭で開かれる）。状態の更新はその後。
    const picking = this.transport.pick();
    this.connecting = true;
    const gen = ++this.connectionGen;
    this.setState({ state: 'connecting' });
    return this.finishConnect(picking, gen);
  }

  private async finishConnect(picking: Promise<import('../transport/types.js').PickResult>, gen: number): Promise<ConnectResult> {
    let link: KubiLink | null = null;
    try {
      const picked = await picking;
      if (gen !== this.connectionGen) {
        if (picked.ok) await picked.link.close();
        return { type: 'notConnected', reason: 'couldNotConnect' };
      }
      if (!picked.ok) {
        this.connecting = false;
        this.setState({ state: 'disconnected', cause: picked.reason === 'notSelected' ? 'byApp' : 'connectFailed' });
        return { type: 'notConnected', reason: picked.reason };
      }
      link = picked.link;
      this.link = link;
      this.linkCleanups.push(link.onDisconnected(() => this.onLinkLost(link!)));
      await this.initialSync(link, gen);
      if (gen !== this.connectionGen || link.isClosed) throw new KubiError('linkLost', '接続の途中でリンクが失われた');
      this.connecting = false;
      this.setState({ state: 'connected' });
      this.emitSnapshot();
      this.schedulePump();
      return { type: 'connected' };
    } catch (e) {
      // 初期同期が成立しなければ、途中まで成立したリンクは畳む。
      if (link !== null) {
        this.teardownLink();
        await link.close().catch(() => {});
      }
      if (gen === this.connectionGen) {
        this.connecting = false;
        this.setState({ state: 'disconnected', cause: 'connectFailed' });
        this.emitSnapshot();
      }
      this.note(`接続に失敗: ${String(e instanceof Error ? e.message : e)}`);
      return { type: 'notConnected', reason: 'couldNotConnect' };
    }
  }

  /** 接続の通信列: pan読み取り → tilt読み取り → pan速さ → tilt速さ。先に `9147` の Notify を有効にする。 */
  private async initialSync(link: KubiLink, gen: number): Promise<void> {
    const unsubFrames = await link.subscribe('readResponse', (bytes) => this.onFrame(bytes));
    this.linkCleanups.push(unsubFrames);
    for (const a of AXES) {
      const raw = await this.readRegisterDirect(link, a);
      if (raw === null) throw new KubiError('readFailed', `${a} の現在位置を読めなかった`);
      this.applyPresent(this.axis(a), raw, this.axis(a).seq, false);
    }
    for (const a of AXES) {
      const s = this.axis(a);
      await this.writeDirect(link, 'registerWrite2', encodeRegisterWrite2(a, REGISTER_MOVING_SPEED, s.settingRaw), 'speed', a);
      s.committedSpeedRaw = s.settingRaw;
      s.pendingSpeedWrite = false;
    }
    if (gen !== this.connectionGen) return;
    // status: 特性があれば購読と初期値の読み出し。無い機体でも首は動かせる。
    if (link.has('batteryStatus')) {
      this.linkCleanups.push(await link.subscribe('batteryStatus', (b) => this.onBatteryStatusBytes(b)));
      this.onBatteryStatusBytes(await link.read('batteryStatus').catch(() => new Uint8Array()));
    }
    if (link.has('button')) {
      this.linkCleanups.push(await link.subscribe('button', (b) => this.onButtonBytes(b)));
      this.onButtonBytes(await link.read('button').catch(() => new Uint8Array()));
    }
    if (link.has('servoError')) {
      this.linkCleanups.push(await link.subscribe('servoError', (b) => this.onServoErrorBytes(b)));
    }
  }

  /**
   * 初期同期の中だけで使う直列の読み取り（制御ループはまだ回っていない）。
   * 応答（`9147`）が要求の ACK より先に届くことがある（Chrome / macOS で実測）。ACK を待たずに次の要求を書くと
   * 「GATT operation already in progress」で失敗するので、応答と ACK の両方を待つ。
   */
  private readRegisterDirect(link: KubiLink, a: Axis): Promise<number | null> {
    let request: Promise<void> = Promise.resolve();
    const frame = new Promise<number | null>((resolve) => {
      const s = this.axis(a);
      const timer = setTimeout(() => {
        if (this.pendingRead?.resolve === resolve) this.pendingRead = null;
        resolve(null);
      }, READ_TIMEOUT_MS);
      this.pendingRead = { axis: a, seq: s.seq, kind: 'progress', resolve, timer, abandoned: false };
      request = this.writeDirect(link, 'registerRead2', encodeRegisterRead(a, REGISTER_PRESENT_POSITION), 'readRequest', a).catch(() => {
        clearTimeout(timer);
        this.pendingRead = null;
        resolve(null);
      });
    });
    return Promise.all([frame, request]).then(([raw]) => raw);
  }

  private async writeDirect(link: KubiLink, c: Characteristic, bytes: Uint8Array, purpose: WritePurpose, axis: Axis | null): Promise<void> {
    this.ioCount++;
    try {
      await link.write(c, bytes);
      this.diag({ type: 'write', purpose, axis, characteristic: String(CHARACTERISTIC_UUID[c]), bytes, at: new Date(this.now()), ok: true });
    } catch (e) {
      this.diag({ type: 'write', purpose, axis, characteristic: String(CHARACTERISTIC_UUID[c]), bytes, at: new Date(this.now()), ok: false });
      throw e;
    }
  }

  disconnect(): Promise<void> {
    this.assertAlive();
    return this.disconnectInternal('byApp');
  }

  private disconnectInternal(cause: 'byApp'): Promise<void> {
    if (this.disconnectPromise !== null) return this.disconnectPromise;
    if (this.connecting) {
      // 進行中の接続を打ち切る。その接続操作は「繋げなかった」として終わる。
      this.connectionGen++;
      this.connecting = false;
      const l = this.link;
      this.teardownLink();
      this.setState({ state: 'disconnected', cause });
      this.emitSnapshot();
      return l ? l.close().catch(() => {}) : Promise.resolve();
    }
    const l = this.link;
    if (l === null || this.state === 'disconnected') return Promise.resolve();
    // teardown の間、状態は connected のまま（リンクはまだ生きている）。
    this.closingByApp = true;
    this.disconnectPromise = (async () => {
      try {
        await l.close();
      } catch {
        // 切れればよい
      } finally {
        if (this.link === l) this.afterLinkGone(cause);
        this.disconnectPromise = null;
        this.closingByApp = false;
      }
    })();
    return this.disconnectPromise;
  }

  private closingByApp = false;

  private onLinkLost(link: KubiLink): void {
    if (this.link !== link) return;
    if (this.closingByApp) return; // 自分で切った。close() の完了側が片付ける
    if (this.connecting) {
      // 接続の途中で切れた。finishConnect が失敗として畳む。
      return;
    }
    this.afterLinkGone('linkLost');
  }

  /** リンクが無くなったあとの片付け。観測を捨て、待っている人を終わらせ、状態を変える。 */
  private afterLinkGone(cause: 'byApp' | 'linkLost'): void {
    this.teardownLink();
    const err = new KubiError(cause === 'linkLost' ? 'linkLost' : 'noLink', cause === 'linkLost' ? 'リンクが失われた' : 'アプリが切断した');
    for (const w of this.moveWaiters.splice(0)) {
      if (!w.done) {
        w.done = true;
        w.reject(err);
      }
    }
    for (const r of this.explicitOps.splice(0)) r.reject(err);
    for (const a of AXES) {
      const s = this.axis(a);
      for (const w of s.stopWaiters.splice(0)) w('superseded');
      for (const w of s.driveWaiters.splice(0)) w.reject(err);
      s.forgetLink();
    }
    if (this.pendingRead) {
      clearTimeout(this.pendingRead.timer);
      this.pendingRead.resolve(null);
      this.pendingRead = null;
    }
    this.battery = null;
    this.button = null;
    this.inFlight = false;
    this.setState({ state: 'disconnected', cause });
    this.emitSnapshot();
  }

  private teardownLink(): void {
    for (const c of this.linkCleanups.splice(0)) {
      try {
        c();
      } catch {
        // 解除の失敗は無視
      }
    }
    this.link = null;
    if (this.pumpTimer) {
      clearTimeout(this.pumpTimer);
      this.pumpTimer = null;
    }
  }

  private setState(c: ConnectionChange): void {
    if (c.state === this.state && c.state !== 'disconnected') return;
    const changed = c.state !== this.state;
    this.state = c.state;
    if (changed) this.connectionEmitter.emit(c);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubAvailability();
    const l = this.link;
    this.connectionGen++;
    this.connecting = false;
    if (l !== null) {
      this.afterLinkGone('byApp');
      await l.close().catch(() => {});
    }
    for (const e of [
      this.connectionEmitter,
      this.availabilityEmitter,
      this.snapshotEmitter,
      this.driveHaltEmitter,
      this.diagnosticEmitter,
      this.batteryEmitter,
      this.buttonEmitter,
      this.servoErrorEmitter,
    ]) {
      e.end();
    }
  }

  // --- observation --------------------------------------------------------------------------------

  private motionOf(s: AxisState): AxisMotion {
    switch (s.kind) {
      case 'move':
        return 'moving';
      case 'drive':
        return 'driving';
      case 'stop':
        return 'staying';
      case 'raw':
        return 'unknown';
      case 'idle':
        return s.present === null ? 'unknown' : 'idle';
    }
  }

  private axisSnapshot(s: AxisState): AxisSnapshot {
    return {
      goal: s.intentGoalRaw === null ? null : clampTo(rawToDeg(s.intentGoalRaw), s.range),
      present: s.present,
      motion: this.motionOf(s),
      speed: clampTo(rawToDegPerSec(s.settingRaw), speedRange),
    };
  }

  snapshot(): Snapshot {
    this.assertAlive();
    return new Snapshot(this.axisSnapshot(this.pan), this.axisSnapshot(this.tilt));
  }

  onChange(cb: (s: Snapshot) => void): () => void {
    this.assertAlive();
    return this.snapshotEmitter.on(cb);
  }

  /** 中身が変わったときだけ配信する（測定時刻の更新も「変わった」）。 */
  private emitSnapshot(): void {
    if (this.disposed) return;
    const s = new Snapshot(this.axisSnapshot(this.pan), this.axisSnapshot(this.tilt));
    if (this.lastSnapshot !== null && this.lastSnapshot.equals(s)) return;
    this.lastSnapshot = s;
    this.snapshotEmitter.emit(s);
  }

  // --- servo（基本 API）----------------------------------------------------------------------------

  /** 1 軸の present を device から読む（1 往復）。停止に捨てられたらやり直す。 */
  readAxis(a: Axis): Promise<Observed> {
    this.assertAlive();
    this.requireLink();
    return new Promise((resolve, reject) => {
      this.explicitOps.push({ kind: 'read', axis: a, resolve, reject });
      this.schedulePump();
    });
  }

  /** 1 軸の目標を書く。書き込みが済んだら解決。観測は始めず、その軸は `raw`（motion は unknown）になる。 */
  writeGoal(a: Axis, deg: number): Promise<void> {
    this.assertAlive();
    this.requireLink();
    const { raw } = this.clampAngle(a, deg);
    const s = this.axis(a);
    this.interrupt({ [a]: 'superseded' });
    s.kind = 'raw';
    s.intentGoalRaw = raw;
    s.syncRaw = null;
    s.atRest = false;
    s.braking = false;
    s.holdAtPresent = false;
    s.holdReadyAt = null;
    s.driveDestinationRaw = null;
    s.driveDir = 0;
    s.observeDrive = true;
    s.bump();
    this.emitSnapshot();
    return new Promise((resolve, reject) => {
      this.explicitOps.push({ kind: 'goal', axis: a, raw, resolve, reject });
      this.schedulePump();
    });
  }

  /** 1 軸の速度を書く。設定を更新し、device へ 1 本書く。目標は書き直さない（device は次の目標書き込みから使う）。 */
  writeSpeed(a: Axis, degPerSec: number): Promise<void> {
    this.assertAlive();
    this.requireLink();
    const s = this.axis(a);
    const applied = clampTo(degPerSec, speedRange);
    if (applied !== degPerSec) this.diag({ type: 'clamped', what: 'speed', axis: a, requested: degPerSec, applied, at: new Date(this.now()) });
    const raw = degPerSecToRaw(applied);
    s.settingRaw = raw;
    this.emitSnapshot();
    return new Promise((resolve, reject) => {
      this.explicitOps.push({ kind: 'speed', axis: a, raw, resolve, reject });
      this.schedulePump();
    });
  }

  /** 開発者の基本操作を 1 つ出す関数。無ければ `null`。読み取りが停止に捨てられたら列に残してやり直す。 */
  private nextExplicitOp(): (() => Promise<void>) | null {
    const op = this.explicitOps[0];
    if (!op || this.link === null) return null;
    const link = this.link;
    const s = this.axis(op.axis);
    return async () => {
      if (op.kind === 'read') {
        const seq = s.seq;
        const raw = await this.readRegister(link, s, 'explicit');
        if (raw === null) {
          if (this.pendingReadWasAbandoned) {
            this.pendingReadWasAbandoned = false;
            return; // 停止に捨てられた。やり直す
          }
          this.explicitOps.shift();
          op.reject(new KubiError('readFailed', `${op.axis} の現在位置を読めなかった`));
          return;
        }
        this.explicitOps.shift();
        op.resolve(this.applyPresent(s, raw, seq, true));
        return;
      }
      this.explicitOps.shift();
      try {
        if (op.kind === 'goal') {
          await this.writeDirect(link, op.axis === 'pan' ? 'panGoal' : 'tiltGoal', encodeGoal(op.raw), 'goal', op.axis);
          s.committedGoalRaw = op.raw;
          s.committedGoalDir = 0;
        } else {
          await this.writeDirect(link, 'registerWrite2', encodeRegisterWrite2(op.axis, REGISTER_MOVING_SPEED, op.raw), 'speed', op.axis);
          s.committedSpeedRaw = op.raw;
          s.pendingSpeedWrite = false;
          this.relatchGoalAfterSpeed(s); // 進行中の宣言には新しい速度を効かせる（speed capability）
        }
        op.resolve();
      } catch (e) {
        op.reject(new KubiError(link.isClosed ? 'linkLost' : 'writeFailed', `${op.axis} への書き込みが失敗した`, { cause: e }));
      }
    };
  }


  // --- speed --------------------------------------------------------------------------------------

  get speed(): PanTilt<number> {
    this.assertAlive();
    return {
      pan: clampTo(rawToDegPerSec(this.pan.settingRaw), speedRange),
      tilt: clampTo(rawToDegPerSec(this.tilt.settingRaw), speedRange),
    };
  }

  // --- move ---------------------------------------------------------------------------------------

  private clampAngle(a: Axis, deg: number): { raw: number; clamped: boolean } {
    const s = this.axis(a);
    const applied = clampTo(deg, s.range);
    const clamped = applied !== deg;
    if (clamped) this.diag({ type: 'clamped', what: 'angle', axis: a, requested: deg, applied, at: new Date(this.now()) });
    return { raw: degToRaw(applied), clamped };
  }

  /** 宣言が来た軸の、進行中の待ちを打ち切る。 */
  private interrupt(by: Partial<Record<Axis, 'superseded' | 'stayed'>>): void {
    for (const w of this.moveWaiters) {
      if (w.done) continue;
      let hit = false;
      for (const a of AXES) {
        const b = by[a];
        if (b !== undefined && w.axes.has(a)) {
          w.interrupts[a] = b;
          hit = true;
        }
      }
      if (!hit) continue;
      w.done = true;
      const anySuperseded = Object.values(w.interrupts).some((v) => v === 'superseded');
      w.resolve({ type: 'cancelled', by: anySuperseded ? 'superseded' : 'stayed', clamped: w.clamped });
    }
    this.moveWaiters.splice(0, this.moveWaiters.length, ...this.moveWaiters.filter((w) => !w.done));
    for (const a of AXES) {
      const b = by[a];
      if (b === undefined) continue;
      const s = this.axis(a);
      if (b === 'superseded') for (const w of s.stopWaiters.splice(0)) w('superseded');
      for (const w of s.driveWaiters.splice(0)) w.resolve(); // 追い越された drive の待ちは解決（届くか追い越されるか）
    }
  }

  /** 目標を宣言する共通部。kind を move にし、待ちを打ち切り、進捗をやり直す。 */
  private declareGoal(a: Axis, raw: number, syncRaw: number | null): void {
    const s = this.axis(a);
    s.kind = 'move';
    s.intentGoalRaw = raw;
    s.syncRaw = syncRaw;
    if (syncRaw !== null) s.pendingSpeedWrite = true; // 同時到達は同じ値でも書く
    s.atRest = false;
    s.braking = false;
    s.holdAtPresent = false;
    s.holdReadyAt = null;
    s.driveDestinationRaw = null;
    s.driveDir = 0;
    s.observeDrive = true;
    s.bump();
    s.resetProgress(this.now());
  }

  /** 目標へ動かし、静止するまで待つ。 */
  moveTo(goals: AxisValues, opts: MoveOptions = {}): Promise<MoveResult> {
    this.assertAlive();
    this.requireLink();
    const targets = this.pickAxes(goals);
    const raws: Partial<Record<Axis, number>> = {};
    let clamped = false;
    for (const a of targets) {
      const r = this.clampAngle(a, goals[a]!);
      raws[a] = r.raw;
      clamped ||= r.clamped;
    }
    return this.startMove(targets, raws, clamped, opts.together === true && targets.length === 2);
  }

  /** 現在地（present）からの相対移動。両軸 idle のときだけ。 */
  moveBy(deltas: AxisValues, opts: MoveOptions = {}): Promise<MoveResult> {
    this.assertAlive();
    this.requireLink();
    const targets = this.pickAxes(deltas);
    if (this.pan.kind === 'raw' || this.tilt.kind === 'raw') {
      return Promise.resolve({ type: 'rejected', reason: 'motionUnknown' });
    }
    if (!(this.pan.kind === 'idle' && this.tilt.kind === 'idle')) {
      return Promise.resolve({ type: 'rejected', reason: 'declarationActive' });
    }
    const raws: Partial<Record<Axis, number>> = {};
    let clamped = false;
    for (const a of targets) {
      const s = this.axis(a);
      if (s.present === null) throw new KubiError('noLink', `${a} の位置が未知のため相対移動できない`);
      const r = this.clampAngle(a, s.present.value + deltas[a]!);
      raws[a] = r.raw;
      clamped ||= r.clamped;
    }
    return this.startMove(targets, raws, clamped, opts.together === true && targets.length === 2);
  }

  private startMove(targets: Axis[], raws: Partial<Record<Axis, number>>, clamped: boolean, together: boolean): Promise<MoveResult> {
    const by: Partial<Record<Axis, 'superseded'>> = {};
    for (const a of targets) by[a] = 'superseded';
    this.interrupt(by);
    // 同時到達: 軸ごとに 設定 × (その軸の距離 ÷ 長い方の距離)。下限へ丸める（0 は書かない）。
    let sync: Partial<Record<Axis, number>> = {};
    if (together) {
      const dist: Partial<Record<Axis, number>> = {};
      let longest = 0;
      for (const a of targets) {
        const s = this.axis(a);
        const from = s.presentRaw ?? raws[a]!;
        dist[a] = Math.abs(raws[a]! - from);
        longest = Math.max(longest, dist[a]!);
      }
      if (longest > 0) {
        for (const a of targets) {
          const s = this.axis(a);
          const ratio = dist[a]! / longest;
          sync[a] = Math.min(RAW_SPEED_MAX, Math.max(RAW_SPEED_MIN, Math.round(s.settingRaw * ratio)));
        }
      } else {
        sync = {};
      }
    }
    const waiter: MoveWaiter = {
      axes: new Set(targets),
      clamped,
      seq: {},
      resolve: () => {},
      reject: () => {},
      interrupts: {},
      done: false,
    };
    const p = new Promise<MoveResult>((resolve, reject) => {
      waiter.resolve = resolve;
      waiter.reject = reject;
    });
    for (const a of targets) {
      this.declareGoal(a, raws[a]!, sync[a] ?? null);
      waiter.seq[a] = this.axis(a).seq;
    }
    this.moveWaiters.push(waiter);
    this.emitSnapshot();
    this.schedulePump();
    // すでに目標にいて動かない場合も、観測で静止を判定して解決する（次の測定で converged）。
    return p;
  }

  private pickAxes(values: AxisValues): Axis[] {
    const targets = AXES.filter((a) => values[a] !== undefined);
    if (targets.length === 0) throw new TypeError('pan か tilt の少なくとも一方を指定すること');
    return targets;
  }

  // --- drive --------------------------------------------------------------------------------------

  onDriveHalt(cb: (h: DriveHalt) => void): () => void {
    this.assertAlive();
    return this.driveHaltEmitter.on(cb);
  }

  /**
   * 向きを指定して動かし続ける。速さは事前の設定。指令（到達点）が device に届いた時点で解決。
   */
  drive(opts: DriveOptions): Promise<void> {
    this.assertAlive();
    this.requireLink();
    const targets = AXES.filter((a) => opts[a] !== undefined);
    if (targets.length === 0) throw new TypeError('pan か tilt の少なくとも一方を指定すること');
    const now = this.now();
    const waits: Promise<void>[] = [];
    const by: Partial<Record<Axis, 'superseded'>> = {};
    for (const a of targets) by[a] = 'superseded';
    this.interrupt(by);
    const halts: DriveHalt[] = [];
    for (const a of targets) {
      const s = this.axis(a);
      const dir = opts[a] === 'right' || opts[a] === 'up' ? 1 : -1;
      const destDeg = a === 'pan' ? opts.panTo : opts.tiltTo;
      const destRaw =
        destDeg === undefined ? (dir > 0 ? degToRaw(s.range.max) : degToRaw(s.range.min)) : this.clampAngle(a, destDeg).raw;
      const present = s.presentRaw ?? destRaw;
      const ahead = dir > 0 ? destRaw > present : destRaw < present;
      s.kind = 'drive';
      s.syncRaw = null;
      s.driveDir = dir;
      s.observeDrive = opts.observe !== false;
      s.braking = false;
      s.holdAtPresent = false;
      s.holdReadyAt = null;
      s.atRest = false;
      s.bump();
      s.resetProgress(now);
      if (!ahead) {
        // 到達点が前方にない: 目標は今いる位置。首は動かさない。通知は鳴り、宣言は終わる。
        s.intentGoalRaw = present;
        s.driveDestinationRaw = destRaw;
        this.endDrive(s);
        if (s.present) halts.push({ axis: a, destination: clampTo(rawToDeg(destRaw), s.range), present: s.present });
        waits.push(Promise.resolve());
        continue;
      }
      s.intentGoalRaw = destRaw;
      s.driveDestinationRaw = destRaw;
      waits.push(new Promise<void>((resolve, reject) => s.driveWaiters.push({ resolve, reject })));
    }
    this.emitSnapshot();
    for (const h of halts) this.driveHaltEmitter.emit(h);
    this.schedulePump();
    return Promise.all(waits).then(() => undefined);
  }

  /** drive の宣言を終える（進まなくなった・到達点が前方にない）。目標は止まった位置。 */
  private endDrive(s: AxisState): void {
    s.kind = 'idle';
    s.driveDir = 0;
    s.observeDrive = true;
    s.atRest = true;
    for (const w of s.driveWaiters.splice(0)) w.resolve();
  }

  // --- stop ---------------------------------------------------------------------------------------

  stay(): Promise<PanTilt<StayResult>>;
  stay(axis: Axis): Promise<StayResult>;
  stay(axis?: Axis): Promise<PanTilt<StayResult> | StayResult> {
    this.assertAlive();
    this.requireLink();
    if (axis !== undefined) {
      this.interrupt({ [axis]: 'stayed' });
      const p = this.stopAxis(axis);
      this.emitSnapshot();
      this.schedulePump();
      return p;
    }
    this.interrupt({ pan: 'stayed', tilt: 'stayed' });
    const p = Promise.all([this.stopAxis('pan'), this.stopAxis('tilt')]).then(([pan, tilt]) => ({ pan, tilt }));
    this.emitSnapshot();
    this.schedulePump();
    return p;
  }

  /** 1 軸の停止を宣言し、止まって保持した時点で解決する Promise を返す。 */
  private stopAxis(a: Axis): Promise<StayResult> {
    const s = this.axis(a);
    if (s.kind === 'idle' && s.atRest) return Promise.resolve('stayed');
    const p = new Promise<StayResult>((resolve) => s.stopWaiters.push(resolve));
    if (s.kind === 'stop') return p; // 同じ停止に合流
    // 観測していた軸は手元の測定ですぐ止めにいく。観測していなかった軸（基本 API・観測を降りた drive）は先に測る。
    const observed = s.kind === 'move' || (s.kind === 'drive' && s.observeDrive);
    s.kind = 'stop';
    s.syncRaw = null;
    s.driveDir = 0;
    s.observeDrive = true;
    s.braking = true;
    s.holdAtPresent = false;
    s.holdReadyAt = null;
    s.stayReadTries = observed ? 2 : 0;
    s.atRest = false;
    s.bump();
    // 進行中の測定は捨てる（開発者の読み直しはやり直す）。
    if (this.pendingRead && this.pendingRead.kind !== 'explicit') this.abandonPendingRead();
    this.schedulePump();
    return p;
  }

  private abandonPendingRead(): void {
    const pr = this.pendingRead;
    if (!pr) return;
    pr.abandoned = true;
    clearTimeout(pr.timer);
    this.pendingRead = null;
    this.lastAbandoned = true;
    pr.resolve(null);
  }

  // --- 制御ループ ---------------------------------------------------------------------------------

  private schedulePump(delayMs = 0): void {
    if (this.disposed || this.link === null || this.state !== 'connected') return;
    if (delayMs > 0) {
      if (this.pumpTimer) return;
      this.pumpTimer = setTimeout(() => {
        this.pumpTimer = null;
        this.schedulePump();
      }, delayMs);
      return;
    }
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.inFlight || this.link === null || this.state !== 'connected' || this.disposed) return;
    if (this.pumpTimer) {
      clearTimeout(this.pumpTimer);
      this.pumpTimer = null;
    }
    const link = this.link;
    const now = this.now();
    const ioBefore = this.ioCount;
    this.inFlight = true;
    try {
      // 停止は周の外。減速しきる位置を到達点に書く → 静止を測定で確かめる → 止まった位置を到達点に書く。
      for (const a of AXES) {
        const s = this.axis(a);
        if (s.kind === 'stop' && s.braking) {
          const age = s.present === null ? Number.POSITIVE_INFINITY : now - s.present.observedAt.getTime();
          if ((age > 2 * POLL_INTERVAL_MS || s.velocityRawPerMs === null) && s.stayReadTries < 2) {
            // 観測していなかった軸は位置か速さが古い。先に測る（2 回で速さが出る）。
            s.stayReadTries++;
            const seq = s.seq;
            const raw = await this.readRegister(link, s, 'hold');
            if (raw !== null && seq === s.seq) this.applyPresent(s, raw, seq, false);
            return;
          }
          const goal = this.stayGoalRaw(s, this.now());
          if (goal !== null && goal !== s.committedGoalRaw) {
            await this.doWrite(link, s, a === 'pan' ? 'panGoal' : 'tiltGoal', encodeGoal(goal), 'brake');
            s.committedGoalRaw = goal;
            s.committedGoalDir = 0;
            s.intentGoalRaw = goal;
          }
          s.braking = false;
          s.holdAtPresent = true;
          s.holdReadyAt = this.now() + POLL_INTERVAL_MS;
          s.resetProgress(this.now());
          this.emitSnapshot();
          this.schedulePump(POLL_INTERVAL_MS);
          return;
        }
      }
      for (const a of AXES) {
        const s = this.axis(a);
        if (s.kind === 'stop' && s.holdAtPresent && s.holdReadyAt !== null && s.holdReadyAt <= now) {
          const seq = s.seq;
          const raw = await this.readRegister(link, s, 'hold');
          if (raw !== null && seq === s.seq) {
            this.applyPresent(s, raw, seq, false);
            this.trackMovement(s, raw);
            if (s.readsSinceMove >= STAY_STILL_READS) {
              // 止まった。その位置を目標にする（次の周で保持の到達点を書く）。
              s.intentGoalRaw = raw;
              s.holdAtPresent = false;
              s.holdReadyAt = null;
            } else {
              s.holdReadyAt = this.now() + POLL_INTERVAL_MS;
            }
          }
          return;
        }
      }
      for (const a of AXES) {
        const s = this.axis(a);
        if (s.kind === 'stop' && !s.braking && !s.holdAtPresent && s.intentGoalRaw !== null && s.committedGoalRaw !== s.intentGoalRaw) {
          const raw = s.intentGoalRaw;
          await this.doWrite(link, s, a === 'pan' ? 'panGoal' : 'tiltGoal', encodeGoal(raw), 'hold');
          s.committedGoalRaw = raw;
          s.committedGoalDir = 0;
          this.finishStop(s);
          return;
        }
        if (s.kind === 'stop' && !s.braking && !s.holdAtPresent && s.intentGoalRaw !== null && s.committedGoalRaw === s.intentGoalRaw) {
          this.finishStop(s);
        }
      }

      // 開発者の基本操作は周の外・停止の次。呼ばれた順に 1 つずつ。
      const explicit = this.nextExplicitOp();
      if (explicit) {
        await explicit();
        return;
      }

      // 1 周: pan → tilt → 読み取り
      for (let guard = 0; guard < 3; guard++) {
        if (this.slot < 2) {
          const s = this.axis(AXES[this.slot]!);
          const w = this.nextWriteFor(s, now);
          if (w !== null) {
            await w();
            return;
          }
          this.slot++;
          continue;
        }
        // 読み取りの席
        this.slot = 0;
        if (this.wroteThisCycle) {
          this.wroteThisCycle = false;
          for (const a of AXES) {
            const s = this.axis(a);
            if (this.isObservedMotion(s)) {
              await this.readProgress(link, s);
              return;
            }
          }
        }
        break;
      }

      // 書くものが無いとき。末尾: 状態の読み出し
      const t = this.tail.shift();
      if (t) {
        await t();
        return;
      }
      const moving = AXES.map((a) => this.axis(a)).filter((s) => !s.atRest && (s.kind === 'move' || s.kind === 'drive'));
      if (moving.length > 0) {
        const wait = this.lastIdleReadAt + POLL_INTERVAL_MS - now;
        if (wait > 0) {
          this.schedulePump(wait);
          return;
        }
        moving.sort((x, y) => x.lastReadAt - y.lastReadAt);
        this.lastIdleReadAt = now;
        await this.readProgress(link, moving[0]!);
        return;
      }
      // 停止の保持待ち・書き直し待ちがあれば起こし直す
      let nextWake: number | null = null;
      for (const a of AXES) {
        const s = this.axis(a);
        if (s.holdReadyAt !== null && s.holdAtPresent) nextWake = nextWake === null ? s.holdReadyAt : Math.min(nextWake, s.holdReadyAt);
        if (s.retryAfter !== null) nextWake = nextWake === null ? s.retryAfter : Math.min(nextWake, s.retryAfter);
      }
      if (nextWake !== null) this.schedulePump(Math.max(1, nextWake - now));
    } catch (e) {
      this.note(`制御ループの例外: ${String(e instanceof Error ? e.message : e)}`);
      this.schedulePump(POLL_INTERVAL_MS);
    } finally {
      this.inFlight = false;
      // 通信を出した周だけ続きを呼ぶ。何もしなかった周は、仕掛けたタイマーに任せる（busy loop を作らない）。
      if (this.ioCount !== ioBefore && this.hasWork()) this.schedulePump();
    }
  }

  private hasWork(): boolean {
    if (this.link === null || this.state !== 'connected') return false;
    if (this.explicitOps.length > 0 || this.tail.length > 0) return true;
    for (const a of AXES) {
      const s = this.axis(a);
      if (s.kind === 'stop') return true;
      if (s.kind === 'raw') continue; // 基本 API の軸は周では触らない
      if (s.retryAfter !== null) continue;
      if (s.intentGoalRaw !== null && s.committedGoalRaw !== s.intentGoalRaw) return true;
      if (s.pendingSpeedWrite || (s.kind !== 'idle' && s.committedSpeedRaw !== s.wantedSpeedRaw)) return true;
      if (!s.atRest && (s.kind === 'move' || s.kind === 'drive')) return true;
    }
    return false;
  }

  /** この軸の席で出す書き込み。速さ → 到達点（drive も同じ。drive は速さを持たないので、設定が device と違うときだけ速さが出る）。無ければ `null`。 */
  private nextWriteFor(s: AxisState, now: number): (() => Promise<void>) | null {
    if (s.kind === 'stop' || s.kind === 'raw') return null;
    if (s.retryAfter !== null) {
      if (s.retryAfter > now) return null;
      s.retryAfter = null;
    }
    const link = this.link!;
    const a = s.axis;
    const wantSpeed = s.wantedSpeedRaw;
    const needSpeed = s.pendingSpeedWrite || (s.kind !== 'idle' && s.committedSpeedRaw !== wantSpeed);
    const needGoal = s.intentGoalRaw !== null && s.committedGoalRaw !== s.intentGoalRaw;
    const speedWrite = async (): Promise<void> => {
      await this.doWrite(link, s, 'registerWrite2', encodeRegisterWrite2(a, REGISTER_MOVING_SPEED, wantSpeed), 'speed');
      s.committedSpeedRaw = wantSpeed;
      s.pendingSpeedWrite = false;
      this.wroteThisCycle = true;
      this.relatchGoalAfterSpeed(s);
    };
    const goalWrite = async (): Promise<void> => {
      const raw = s.intentGoalRaw!;
      const seq = s.seq;
      await this.doWrite(link, s, a === 'pan' ? 'panGoal' : 'tiltGoal', encodeGoal(raw), 'goal');
      s.committedGoalRaw = raw;
      s.committedGoalDir = s.kind === 'drive' ? s.driveDir : 0;
      this.wroteThisCycle = true;
      if (seq === s.seq) {
        s.resetProgress(this.now());
        if (s.kind === 'drive') for (const w of s.driveWaiters.splice(0)) w.resolve();
      }
    };
    if (needSpeed) return speedWrite;
    if (needGoal) return goalWrite;
    return null;
  }

  private async doWrite(link: KubiLink, s: AxisState, c: Characteristic, bytes: Uint8Array, purpose: WritePurpose): Promise<void> {
    try {
      await this.writeDirect(link, c, bytes, purpose, s.axis);
    } catch (e) {
      // 書き込みが失敗した軸は、間隔のあとに同じ値を書き直す。待っている人には例外で伝える（宣言は残る）。
      s.retryAfter = this.now() + POLL_INTERVAL_MS;
      const err = new KubiError(link.isClosed ? 'linkLost' : 'writeFailed', `${s.axis} への書き込みが失敗した`, { cause: e });
      for (const w of s.driveWaiters.splice(0)) w.reject(err);
      for (const w of this.moveWaiters) {
        if (!w.done && w.axes.has(s.axis)) {
          w.done = true;
          w.reject(err);
        }
      }
      this.moveWaiters.splice(0, this.moveWaiters.length, ...this.moveWaiters.filter((w) => !w.done));
      throw err;
    }
  }

  /**
   * D-4: device は速度を**次の到達点書き込みから**使う（S-A6）。進行中の move / drive の軸に速さを書いたら、
   * 届いている到達点を「未達」に戻して、次の席で同じ到達点をもう一度書かせる。idle / raw の軸は書き直さない。
   */
  private relatchGoalAfterSpeed(s: AxisState): void {
    if (s.kind !== 'move' && s.kind !== 'drive') return;
    if (s.committedGoalRaw === null || s.committedGoalRaw !== s.intentGoalRaw) return;
    s.committedGoalRaw = null;
  }

  private isObservedMotion(s: AxisState): boolean {
    if (s.atRest) return false;
    if (s.kind === 'move') return true;
    if (s.kind === 'drive') return s.observeDrive;
    return false;
  }

  private pendingReadWasAbandoned = false;

  private async readProgress(link: KubiLink, s: AxisState): Promise<void> {
    const seq = s.seq;
    const raw = await this.readRegister(link, s, 'progress');
    if (raw === null || seq !== s.seq) return;
    this.applyPresent(s, raw, seq, true);
  }

  /** `9144` に要求を書き、`9147` の応答を待つ。捨てられたら / 届かなければ `null`。 */
  private readRegister(link: KubiLink, s: AxisState, kind: PendingRead['kind']): Promise<number | null> {
    s.lastReadAt = this.now();
    let request: Promise<void> = Promise.resolve();
    const frame = new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingRead?.resolve === resolve) this.pendingRead = null;
        resolve(null);
      }, READ_TIMEOUT_MS);
      const pr: PendingRead = { axis: s.axis, seq: s.seq, kind, resolve, timer, abandoned: false };
      this.pendingRead = pr;
      request = this.writeDirect(link, 'registerRead2', encodeRegisterRead(s.axis, REGISTER_PRESENT_POSITION), 'readRequest', s.axis).catch(() => {
        clearTimeout(timer);
        if (this.pendingRead === pr) this.pendingRead = null;
        resolve(null);
      });
    });
    // 捨てられても、飛行中の要求の書き込み 1 本（ACK）は待つ。同時に 2 本走らせないため。
    return Promise.all([frame, request]).then(([raw]) => {
      if (raw === null && kind === 'explicit') this.pendingReadWasAbandoned = this.lastAbandoned;
      this.lastAbandoned = false;
      return raw;
    });
  }

  private lastAbandoned = false;

  /** `9147` のフレーム。要求と突き合わせる。 */
  private onFrame(bytes: Uint8Array): void {
    this.diag({ type: 'frame', characteristic: String(CHARACTERISTIC_UUID.readResponse), bytes, at: new Date(this.now()) });
    const r = decodeRegisterReadResponse(bytes);
    if (r === null || r.register !== REGISTER_PRESENT_POSITION) return;
    const pr = this.pendingRead;
    if (pr && pr.axis === r.axis) {
      clearTimeout(pr.timer);
      this.pendingRead = null;
      pr.resolve(r.value);
      return;
    }
    // 要求が無い応答（捨てたあとに届いた等）: 位置の更新にだけ使う。
    const s = this.axis(r.axis);
    if (this.state === 'connected') this.applyPresent(s, r.value, s.seq, false);
  }

  /** 測定を反映し、必要なら静止判定を回す。 */
  private applyPresent(s: AxisState, raw: number, seq: number, evaluate: boolean): Observed {
    const observed = new Observed(clampTo(rawToDeg(raw), s.range), new Date(this.now()));
    const dt = s.present === null ? 0 : observed.observedAt.getTime() - s.present.observedAt.getTime();
    s.velocityRawPerMs = s.presentRaw !== null && dt > 0 && dt <= 1000 ? (raw - s.presentRaw) / dt : null;
    s.present = observed;
    s.presentRaw = raw;
    if (evaluate && seq === s.seq && !s.holdAtPresent) this.evaluateProgress(s);
    this.emitSnapshot();
    return observed;
  }

  private trackMovement(s: AxisState, present: number): void {
    const prev = s.lastPresentRaw;
    s.lastPresentRaw = present;
    if (prev === null) return;
    const moved = Math.abs(present - prev);
    if (moved < 1) {
      s.readsSinceMove++;
      return;
    }
    s.readsSinceMove = 0;
    const now = this.now();
    const span = s.lastMovedAt === null ? POLL_INTERVAL_MS : now - s.lastMovedAt;
    s.stillWindowMs = Math.max(1, (span * STILL_STEPS) / moved);
    s.lastMovedAt = now;
    s.movedSinceCommand = true;
  }

  private isStalled(s: AxisState): boolean {
    const now = this.now();
    if (s.progressSince !== null && now - s.progressSince >= STALL_WINDOW_MS) return true;
    if (!s.movedSinceCommand || s.readsSinceMove < 1) return false;
    if (s.lastMovedAt === null || s.stillWindowMs === null) return false;
    const capped = Math.min(STALL_WINDOW_MS, Math.max(POLL_INTERVAL_MS, s.stillWindowMs));
    return now - s.lastMovedAt >= capped;
  }

  private evaluateProgress(s: AxisState): void {
    const present = s.presentRaw;
    if (present === null) return;
    this.trackMovement(s, present);
    const ref = s.progressRefRaw;
    if (ref === null || Math.abs(present - ref) >= STALL_THRESHOLD_RAW) {
      s.progressRefRaw = present;
      s.progressSince = this.now();
    }
    const stalled = this.isStalled(s);
    const goal = s.intentGoalRaw;
    const landed = goal !== null && s.committedGoalRaw === goal;
    if (s.kind === 'move') {
      const converged = landed && Math.abs(present - goal) <= CONVERGE_TOLERANCE_RAW;
      // 指令が device に届いていない間は観測で idle にしない。
      if (converged || (stalled && landed)) {
        s.atRest = true;
        s.kind = 'idle';
          s.syncRaw = null;
        this.resolveSettled(s.axis);
      }
    } else if (s.kind === 'drive' && s.observeDrive) {
      const converged = landed && Math.abs(present - goal) <= CONVERGE_TOLERANCE_RAW;
      if (landed && (converged || stalled)) {
        const dest = s.driveDestinationRaw ?? goal;
        s.intentGoalRaw = present; // 目標を止まった位置に
        this.endDrive(s);
        if (s.present) this.driveHaltEmitter.emit({ axis: s.axis, destination: clampTo(rawToDeg(dest), s.range), present: s.present });
      }
    }
  }

  /** 軸が静止した。その軸を含む待ちのうち、全軸が静止したものを解決する。 */
  private resolveSettled(axis: Axis): void {
    for (const w of this.moveWaiters) {
      if (w.done || !w.axes.has(axis)) continue;
      const allRest = Array.from(w.axes).every((a) => {
        const s = this.axis(a);
        return s.kind === 'idle' && s.atRest && w.seq[a] === s.seq;
      });
      if (!allRest) continue;
      w.done = true;
      const goal: AxisValues = {};
      const present: { pan?: Observed; tilt?: Observed } = {};
      for (const a of w.axes) {
        const s = this.axis(a);
        if (s.intentGoalRaw !== null) goal[a] = clampTo(rawToDeg(s.intentGoalRaw), s.range);
        if (s.present) present[a] = s.present;
      }
      w.resolve({ type: 'settled', goal, present, clamped: w.clamped });
    }
    this.moveWaiters.splice(0, this.moveWaiters.length, ...this.moveWaiters.filter((w) => !w.done));
  }

  /**
   * 停止の最初の到達点 = 首が減速しきる位置（raw）。本体は一定の加減速でしか速度を変えられないので、
   * 手前に置くと行き過ぎてから戻る。向かっている先が無い・位置が未知なら `null`（到達点は書かず、静止の確認だけ行う）。
   */
  private stayGoalRaw(s: AxisState, now: number): number | null {
    const present = s.presentRaw;
    const target = s.committedGoalRaw;
    if (present === null || s.present === null || target === null) return null;
    const degPerRaw = 300 / RAW_POSITION_MAX;
    const toTarget = Math.sign(target - present);
    const measured = (s.velocityRawPerMs ?? 0) * 1000 * degPerRaw; // 度毎秒・符号付き
    const dir = Math.abs(measured) >= 1 ? Math.sign(measured) : toTarget;
    if (dir === 0) return null;
    // 測定の古さ + 書き込み 1 本ぶんは、今の速さ（加速中なら増える）で進む。
    const latencyS = (now - s.present.observedAt.getTime() + POLL_INTERVAL_MS) / 1000;
    const limit = rawToDegPerSec(s.committedSpeedRaw ?? s.settingRaw);
    const v = Math.min(limit, Math.abs(measured) + DECEL_DEG_PER_SEC2 * latencyS);
    const aheadDeg = v * latencyS + (v * v) / (2 * DECEL_DEG_PER_SEC2);
    let goal = present + dir * Math.round(aheadDeg / degPerRaw);
    if (dir === toTarget) goal = dir > 0 ? Math.min(goal, target) : Math.max(goal, target); // 元の到達点は越えない
    return Math.min(degToRaw(s.range.max), Math.max(degToRaw(s.range.min), goal));
  }

  private finishStop(s: AxisState): void {
    s.kind = 'idle';
    s.atRest = true;
    s.holdReadyAt = null;
    for (const w of s.stopWaiters.splice(0)) w('stayed');
    this.emitSnapshot();
  }

  // --- status / device-info --------------------------------------------------------------------------

  get batteryStatus(): BatteryStatus | null {
    this.assertAlive();
    return this.battery;
  }

  get buttonPressed(): boolean | null {
    this.assertAlive();
    return this.button;
  }

  onBatteryStatusChange(cb: (s: BatteryStatus) => void): () => void {
    this.assertAlive();
    return this.batteryEmitter.on(cb);
  }

  onButtonChange(cb: (pressed: boolean) => void): () => void {
    this.assertAlive();
    return this.buttonEmitter.on(cb);
  }

  onServoFault(cb: (e: ServoFault) => void): () => void {
    this.assertAlive();
    return this.servoErrorEmitter.on(cb);
  }

  private onBatteryStatusBytes(bytes: Uint8Array): void {
    this.diag({ type: 'frame', characteristic: String(CHARACTERISTIC_UUID.batteryStatus), bytes, at: new Date(this.now()) });
    const v = decodeBatteryStatus(bytes);
    if (v === null) return;
    if (this.battery && this.battery.charging === v.charging && this.battery.low === v.low) return;
    this.battery = v;
    this.batteryEmitter.emit(v);
  }

  private onButtonBytes(bytes: Uint8Array): void {
    this.diag({ type: 'frame', characteristic: String(CHARACTERISTIC_UUID.button), bytes, at: new Date(this.now()) });
    const v = decodeButton(bytes);
    if (v === null || v === this.button) return;
    this.button = v;
    this.buttonEmitter.emit(v);
  }

  private onServoErrorBytes(bytes: Uint8Array): void {
    this.diag({ type: 'frame', characteristic: String(CHARACTERISTIC_UUID.servoError), bytes, at: new Date(this.now()) });
    const flags = decodeServoErrorFlags(bytes);
    if (flags === null) return;
    const at = new Date(this.now());
    const link = this.link;
    if (link === null || !link.has('servoErrorAxis')) {
      this.servoErrorEmitter.emit({ axis: null, ...flags, at });
      return;
    }
    // 軸は e103 を読んで補う。読み出しは末尾に並ぶ（首への指令を遅らせない）。
    this.tail.push(async () => {
      let axis: Axis | null = null;
      this.ioCount++;
      try {
        const b = await link.read('servoErrorAxis');
        this.diag({ type: 'read', characteristic: String(CHARACTERISTIC_UUID.servoErrorAxis), bytes: b, at: new Date(this.now()) });
        axis = decodeServoErrorAxis(b);
      } catch {
        this.diag({ type: 'read', characteristic: String(CHARACTERISTIC_UUID.servoErrorAxis), bytes: null, at: new Date(this.now()) });
      }
      this.servoErrorEmitter.emit({ axis, ...flags, at });
    });
    this.schedulePump();
  }

  /** 末尾に並べて特性を読む。 */
  private enqueueRead(c: Characteristic): Promise<Uint8Array | null> {
    this.assertAlive();
    const link = this.requireLink();
    if (!link.has(c)) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      this.tail.push(async () => {
        this.ioCount++;
        try {
          const b = await link.read(c);
          this.diag({ type: 'read', characteristic: String(CHARACTERISTIC_UUID[c]), bytes: b, at: new Date(this.now()) });
          resolve(b);
        } catch (e) {
          this.diag({ type: 'read', characteristic: String(CHARACTERISTIC_UUID[c]), bytes: null, at: new Date(this.now()) });
          reject(new KubiError(link.isClosed ? 'linkLost' : 'readFailed', `${c} を読めなかった`, { cause: e }));
        }
      });
      this.schedulePump();
    });
  }

  /** バッテリー電圧（mV）。往復を伴う。 */
  async readBatteryVoltage(): Promise<number> {
    const b = await this.enqueueRead('batteryVoltage');
    const v = b === null ? null : decodeBatteryVoltage(b);
    if (v === null) throw new KubiError('readFailed', 'この Kubi はバッテリー電圧を持っていない、または読めなかった');
    return v;
  }

  /** Device Information。持たない項目は `null`。 */
  async readDeviceInfo(): Promise<DeviceInfo> {
    this.assertAlive();
    this.requireLink();
    const read = async (c: Characteristic): Promise<string | null> => {
      const b = await this.enqueueRead(c).catch(() => null);
      return b === null ? null : decodeUtf8String(b);
    };
    return {
      serialNumber: await read('serialNumber'),
      modelNumber: await read('modelNumber'),
      manufacturer: await read('manufacturer'),
      hardwareRevision: await read('hardwareRevision'),
      firmwareRevision: await read('firmwareRevision'),
    };
  }

  // --- diagnostics ----------------------------------------------------------------------------------

  onDiagnostic(cb: (e: DiagnosticEvent) => void): () => void {
    this.assertAlive();
    return this.diagnosticEmitter.on(cb);
  }

  private diag(e: DiagnosticEvent): void {
    if (!this.diagnosticEmitter.hasSubscribers) return;
    this.diagnosticEmitter.emit(e);
  }

  private note(message: string): void {
    this.diag({ type: 'note', message, at: new Date(this.now()) });
  }
}
