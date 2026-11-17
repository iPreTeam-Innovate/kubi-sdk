/**
 * 購読の共通部品。`foundation` の 3 規約をここ 1 か所で守る:
 * 購読者の例外で制御が止まらない（非同期で配り、例外を飲む）/ `dispose` で終端する / リンクを失っても解除しない。
 */
export class Emitter<T> {
  private readonly subs = new Set<(v: T) => void>();
  private ended = false;

  /** 購読する。戻り値は解除関数。 */
  on(cb: (v: T) => void): () => void {
    if (this.ended) return () => {};
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }

  /** 購読者がいるか（診断のように、購読が無ければ作らないものの判定に使う）。 */
  get hasSubscribers(): boolean {
    return this.subs.size > 0;
  }

  /** 配る。購読者には非同期（マイクロタスク）で届く。購読者の例外は制御に戻らない。 */
  emit(v: T): void {
    if (this.ended || this.subs.size === 0) return;
    const targets = Array.from(this.subs);
    queueMicrotask(() => {
      for (const cb of targets) {
        if (!this.subs.has(cb)) continue;
        try {
          cb(v);
        } catch {
          // 購読者の例外はライブラリの制御に届かせない（foundation）。
        }
      }
    });
  }

  /** 終端。以後は配らず、購読もできない。 */
  end(): void {
    this.ended = true;
    this.subs.clear();
  }
}
