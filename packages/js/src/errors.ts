/**
 * How failures are reported.
 *
 * - Failures that can happen in normal operation (no link, link lost, a write or read failed) are
 *   one class, `KubiError`. `code` tells them apart, but the handling at the call site is the same.
 * - Mistakes that only a bug in the calling code can cause are separate: bad arguments throw
 *   `RangeError` / `TypeError`, calls after disposal throw `KubiDisposedError`, and operations the
 *   transport does not support throw `KubiUnsupportedError`.
 */

/** A failure that can happen in normal operation. */
export class KubiError extends Error {
  constructor(
    readonly code: 'noLink' | 'linkLost' | 'writeFailed' | 'readFailed',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'KubiError';
  }
}

/** Thrown when a method is called after `dispose()` (a bug in the calling code). */
export class KubiDisposedError extends Error {
  constructor() {
    super('This Kubi instance has been disposed. Create a new instance.');
    this.name = 'KubiDisposedError';
  }
}

/** Thrown when an operation the transport does not support is called (a bug in the calling code; check `capabilities` first). */
export class KubiUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KubiUnsupportedError';
  }
}
