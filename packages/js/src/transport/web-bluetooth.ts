/**
 * Web Bluetooth の transport。`navigator.bluetooth` に触れるのはこのファイルだけ。
 *
 * - picker（`requestDevice`）はユーザーのジェスチャーの中で、最初の非同期処理より前に開く
 * - 必須の特性（`9142` `9144` `9145` `9146` `9147`）が無ければ繋がない（旧 kubi は `9147` が無い）
 * - Status / Device Information は無くてもよい
 */
import {
  CHARACTERISTIC_UUID,
  CONTROL_SERVICE_UUID,
  DEVICE_INFORMATION_SERVICE_UUID,
  DEVICE_NAME_PREFIX,
  REQUIRED_CHARACTERISTICS,
  STATUS_SERVICE_UUID,
  type Characteristic,
} from '../protocol/index.js';
import { TransportError, type BluetoothAvailability, type KubiLink, type KubiTransport, type PickResult, type TransportCapabilities } from './types.js';

const SERVICE_OF: Record<Characteristic, string | number> = {
  registerWrite2: CONTROL_SERVICE_UUID,
  registerRead2: CONTROL_SERVICE_UUID,
  panGoal: CONTROL_SERVICE_UUID,
  tiltGoal: CONTROL_SERVICE_UUID,
  readResponse: CONTROL_SERVICE_UUID,
  batteryVoltage: STATUS_SERVICE_UUID,
  servoError: STATUS_SERVICE_UUID,
  servoErrorAxis: STATUS_SERVICE_UUID,
  batteryStatus: STATUS_SERVICE_UUID,
  button: STATUS_SERVICE_UUID,
  serialNumber: DEVICE_INFORMATION_SERVICE_UUID,
  modelNumber: DEVICE_INFORMATION_SERVICE_UUID,
  manufacturer: DEVICE_INFORMATION_SERVICE_UUID,
  hardwareRevision: DEVICE_INFORMATION_SERVICE_UUID,
  firmwareRevision: DEVICE_INFORMATION_SERVICE_UUID,
};

export class WebBluetoothTransport implements KubiTransport {
  readonly capabilities: TransportCapabilities = { providesDevicePicker: true, canScan: false };
  private avail: BluetoothAvailability = 'unknown';
  private readonly availSubs = new Set<(a: BluetoothAvailability) => void>();

  constructor() {
    const bt = navigator.bluetooth;
    if (!bt) {
      this.avail = 'unavailable';
      return;
    }
    void bt
      .getAvailability?.()
      .then((ok) => this.setAvail(ok ? 'available' : 'unavailable'))
      .catch(() => {});
    bt.addEventListener?.('availabilitychanged', (ev: Event) => {
      const v = (ev as Event & { value?: boolean }).value;
      if (typeof v === 'boolean') this.setAvail(v ? 'available' : 'unavailable');
    });
  }

  private setAvail(a: BluetoothAvailability): void {
    if (a === this.avail) return;
    this.avail = a;
    for (const cb of Array.from(this.availSubs)) cb(a);
  }

  get availability(): BluetoothAvailability {
    return this.avail;
  }

  onAvailabilityChange(cb: (a: BluetoothAvailability) => void): () => void {
    this.availSubs.add(cb);
    return () => {
      this.availSubs.delete(cb);
    };
  }

  pick(): Promise<PickResult> {
    const bt = navigator.bluetooth;
    if (!bt) return Promise.resolve({ ok: false, reason: 'couldNotConnect', detail: 'この環境には Web Bluetooth が無い' });
    // ⚠️ ここより前に await を挟まない（ジェスチャーの文脈を失う）。
    const requesting = bt.requestDevice({
      filters: [{ namePrefix: DEVICE_NAME_PREFIX }],
      optionalServices: [CONTROL_SERVICE_UUID, STATUS_SERVICE_UUID, DEVICE_INFORMATION_SERVICE_UUID],
    });
    return this.finishPick(requesting);
  }

  private async finishPick(requesting: Promise<BluetoothDevice>): Promise<PickResult> {
    let device: BluetoothDevice;
    try {
      device = await requesting;
    } catch (e) {
      // picker を閉じた（NotFoundError）は「選ばなかった」。それ以外は「繋げなかった」。
      const name = (e as { name?: string } | null)?.name;
      if (name === 'NotFoundError') return { ok: false, reason: 'notSelected' };
      return { ok: false, reason: 'couldNotConnect', detail: String(e instanceof Error ? e.message : e) };
    }
    try {
      const link = await WebBluetoothLink.open(device);
      return { ok: true, link };
    } catch (e) {
      return { ok: false, reason: 'couldNotConnect', detail: String(e instanceof Error ? e.message : e) };
    }
  }
}

class WebBluetoothLink implements KubiLink {
  private constructor(
    private readonly bleDevice: BluetoothDevice,
    private readonly chars: Map<Characteristic, BluetoothRemoteGATTCharacteristic>,
  ) {
    this.device = { id: bleDevice.id, name: bleDevice.name ?? null };
    bleDevice.addEventListener('gattserverdisconnected', this.onGattDisconnected);
  }

  static async open(device: BluetoothDevice): Promise<WebBluetoothLink> {
    const gatt = device.gatt;
    if (!gatt) throw new TransportError('この端末は GATT を持たない');
    const server = await gatt.connect();
    const chars = new Map<Characteristic, BluetoothRemoteGATTCharacteristic>();
    const services = new Map<string | number, BluetoothRemoteGATTService | null>();
    const serviceOf = async (uuid: string | number): Promise<BluetoothRemoteGATTService | null> => {
      if (services.has(uuid)) return services.get(uuid)!;
      let svc: BluetoothRemoteGATTService | null = null;
      try {
        svc = await server.getPrimaryService(uuid);
      } catch {
        svc = null; // その service が無い機体
      }
      services.set(uuid, svc);
      return svc;
    };
    for (const name of Object.keys(CHARACTERISTIC_UUID) as Characteristic[]) {
      const svc = await serviceOf(SERVICE_OF[name]);
      if (svc === null) continue;
      try {
        chars.set(name, await svc.getCharacteristic(CHARACTERISTIC_UUID[name]));
      } catch {
        // 無い特性は無いまま
      }
    }
    const missing = REQUIRED_CHARACTERISTICS.filter((c) => !chars.has(c));
    if (missing.length > 0) {
      server.disconnect();
      throw new TransportError(
        `首の操作に必須の特性が無い: ${missing.join(', ')}。kubi 2.0 ではない機体（旧 kubi など）の可能性がある`,
      );
    }
    return new WebBluetoothLink(device, chars);
  }

  readonly device: { id: string; name: string | null };
  private closed = false;
  private readonly disconnectSubs = new Set<() => void>();

  private readonly onGattDisconnected = (): void => {
    if (this.closed) return;
    this.closed = true;
    for (const cb of Array.from(this.disconnectSubs)) {
      try {
        cb();
      } catch {
        // 購読者の例外は無視
      }
    }
  };

  get isClosed(): boolean {
    return this.closed || !(this.bleDevice.gatt?.connected ?? false);
  }

  has(c: Characteristic): boolean {
    return this.chars.has(c);
  }

  private char(c: Characteristic): BluetoothRemoteGATTCharacteristic {
    const ch = this.chars.get(c);
    if (!ch) throw new TransportError(`特性 ${c} はこの端末に無い`);
    if (this.closed) throw new TransportError('リンクが失われている');
    return ch;
  }

  async write(c: Characteristic, bytes: Uint8Array): Promise<void> {
    const ch = this.char(c);
    // 型定義が ArrayBuffer を要求するので、共有でないバッファへ写す。
    const buf = new Uint8Array(bytes.byteLength);
    buf.set(bytes);
    try {
      // with response。`writeValueWithResponse` が無い古い実装では `writeValue`（これも response を待つ）。
      if (typeof ch.writeValueWithResponse === 'function') await ch.writeValueWithResponse(buf);
      else await ch.writeValue(buf);
    } catch (e) {
      throw new TransportError(`書き込みに失敗（${c}）`, { cause: e });
    }
  }

  async read(c: Characteristic): Promise<Uint8Array> {
    const ch = this.char(c);
    try {
      const dv = await ch.readValue();
      return new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    } catch (e) {
      throw new TransportError(`読み出しに失敗（${c}）`, { cause: e });
    }
  }

  async subscribe(c: Characteristic, cb: (bytes: Uint8Array) => void): Promise<() => void> {
    const ch = this.char(c);
    const handler = (ev: Event): void => {
      const dv = (ev.target as BluetoothRemoteGATTCharacteristic).value;
      if (!dv) return;
      cb(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
    };
    ch.addEventListener('characteristicvaluechanged', handler);
    try {
      await ch.startNotifications();
    } catch (e) {
      ch.removeEventListener('characteristicvaluechanged', handler);
      throw new TransportError(`Notify を有効にできない（${c}）`, { cause: e });
    }
    return () => {
      ch.removeEventListener('characteristicvaluechanged', handler);
      if (!this.closed) ch.stopNotifications().catch(() => {});
    };
  }

  onDisconnected(cb: () => void): () => void {
    this.disconnectSubs.add(cb);
    return () => {
      this.disconnectSubs.delete(cb);
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.bleDevice.removeEventListener('gattserverdisconnected', this.onGattDisconnected);
    try {
      this.bleDevice.gatt?.disconnect();
    } finally {
      for (const cb of Array.from(this.disconnectSubs)) {
        try {
          cb();
        } catch {
          // 無視
        }
      }
    }
  }
}
