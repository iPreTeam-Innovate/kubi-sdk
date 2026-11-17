/**
 * 軸 1 本ぶんの内部状態。intent（宣言）/ committed（device に書いて ACK 済み）/ observed（測定）の 3 層。
 * 公開面には出さない。
 */
import type { Axis, Observed, Range } from '../types.js';
import { degPerSecToRaw } from '../protocol/index.js';

/** その軸に今効いている宣言の種類。`raw` = 最後の操作が基本 API の目標書き込みで、以後ライブラリは観測していない。 */
export type AxisKind = 'idle' | 'move' | 'drive' | 'stop' | 'raw';

export class AxisState {
  constructor(
    readonly axis: Axis,
    readonly range: Range,
    initialSpeed: number,
  ) {
    this.settingRaw = degPerSecToRaw(initialSpeed);
  }

  kind: AxisKind = 'idle';
  /** 宣言の世代。古い測定・古い応答を見分ける。 */
  seq = 0;

  /** 公開する目標（量子化済み raw）。宣言していなければ `null`。 */
  intentGoalRaw: number | null = null;
  /** 速度設定（量子化済み raw）。リンクを失っても残る。 */
  settingRaw: number;
  /** 同時到達の計算速度。`null` なら使わない。 */
  syncRaw: number | null = null;

  /** device に書いて ACK 済みの目標。 */
  committedGoalRaw: number | null = null;
  /** device に書いて ACK 済みの速度。 */
  committedSpeedRaw: number | null = null;

  /** 最後に測った present。未知なら `null`。 */
  present: Observed | null = null;
  presentRaw: number | null = null;

  /** 静止したと判定されたか。 */
  atRest = true;
  /** 停止の最初の到達点（減速しきる位置）をまだ書いていないか。 */
  braking = false;
  /** 停止の静止を測定で確かめている途中か（止まったら、その位置を目標にする）。 */
  holdAtPresent = false;
  /** 停止の次の測定を出してよい時刻（ms）。 */
  holdReadyAt: number | null = null;
  /** 停止の前に、古い位置・速さを測り直した回数。 */
  stayReadTries = 0;
  /** 直近 2 回の測定から出した速さ（raw 毎 ms・符号付き）。測定の間が空いていれば `null`。 */
  velocityRawPerMs: number | null = null;
  /** idle でも速度を device へ書く（同時到達の計算速度）。 */
  pendingSpeedWrite = false;

  /** drive の到達点（raw）。通知に載せる。 */
  driveDestinationRaw: number | null = null;
  /** drive の向き。正なら上限側、負なら下限側。 */
  driveDir = 0;
  /** device に書いた到達点が、どの向きの drive の宣言のものか。drive 以外は 0。 */
  committedGoalDir = 0;
  /** この drive の間 present を測るか。 */
  observeDrive = true;

  // 進捗・静止判定
  progressRefRaw: number | null = null;
  progressSince: number | null = null;
  lastPresentRaw: number | null = null;
  lastMovedAt: number | null = null;
  stillWindowMs: number | null = null;
  readsSinceMove = 0;
  movedSinceCommand = false;
  /** 最後に読んだ時刻。書くものが無いときは、いちばん古く読んだ軸から読む。 */
  lastReadAt = 0;
  /** 書き込みが失敗して、間隔のあとに書き直す時刻。 */
  retryAfter: number | null = null;

  /** この軸の停止を待っている人。 */
  readonly stopWaiters: Array<(r: 'stayed' | 'superseded') => void> = [];
  /** この軸の drive 指令の到達を待っている人。 */
  readonly driveWaiters: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];

  bump(): void {
    this.seq++;
  }

  /** 動かす宣言を出したときに呼ぶ。進捗の窓をやり直す。 */
  resetProgress(now: number): void {
    this.progressRefRaw = this.presentRaw;
    this.progressSince = now;
    this.lastPresentRaw = this.presentRaw;
    this.lastMovedAt = null;
    this.stillWindowMs = null;
    this.movedSinceCommand = false;
    this.readsSinceMove = 0;
  }

  /** リンク喪失・切断で観測を捨てる。速度設定は残す。 */
  forgetLink(): void {
    this.intentGoalRaw = null;
    this.committedGoalRaw = null;
    this.committedSpeedRaw = null;
    this.present = null;
    this.presentRaw = null;
    this.atRest = true;
    this.kind = 'idle';
    this.braking = false;
    this.holdAtPresent = false;
    this.holdReadyAt = null;
    this.stayReadTries = 0;
    this.velocityRawPerMs = null;
    this.pendingSpeedWrite = false;
    this.syncRaw = null;
    this.driveDestinationRaw = null;
    this.driveDir = 0;
    this.committedGoalDir = 0;
    this.observeDrive = true;
    this.progressRefRaw = null;
    this.progressSince = null;
    this.lastPresentRaw = null;
    this.lastMovedAt = null;
    this.stillWindowMs = null;
    this.movedSinceCommand = false;
    this.readsSinceMove = 0;
    this.retryAfter = null;
    this.bump();
  }

  /** 今 device に書くべき速度 raw。 */
  get wantedSpeedRaw(): number {
    return this.syncRaw ?? this.settingRaw;
  }
}
