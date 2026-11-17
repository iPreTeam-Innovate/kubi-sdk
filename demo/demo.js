// kubi-sdk の動くサンプル。
// 「入力」は本体へ書く値（write）、「出力」は本体から読んだ値（read）。それぞれの下に、結果と本体とやり取りしたバイト列を出す。
import { Kubi } from '../packages/js/dist/index.js';

const $ = (id) => document.getElementById(id);
/** 時刻の表示（この端末の時刻・ミリ秒まで）。ログと出力の段で同じ形にする。 */
const clock = (d) => d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
const log = (msg) => {
  const el = $('log');
  el.textContent = `${clock(new Date())} ${msg}\n` + el.textContent;
};
const hex = (b) => Array.from(b, (x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');
const num = (id) => Number($(id).value);

const kubi = Kubi.forBrowser();
window.kubi = kubi; // DevTools から触れるように

// --- 診断 ---
// 結果の欄に載せるため、常に購読する。`capture` は実行中の操作が、解決までに届いた診断を溜める配列。
let capture = null;
kubi.onDiagnostic((d) => {
  capture?.push(d);
  if (d.type === 'note') log(`  N ${d.message}`);
  if (!$('diag').checked) return;
  if (d.type === 'write') log(`  W ${d.purpose} ${d.axis ?? ''} ${hex(d.bytes)} ${d.ok ? '' : '✗'}`);
  else if (d.type === 'frame') log(`  F ${hex(d.bytes)}`);
  else if (d.type === 'read') log(`  R ${d.bytes ? hex(d.bytes) : '✗'}`);
  else if (d.type === 'clamped') log(`  C ${d.what} ${d.axis} ${d.requested} → ${d.applied}`);
});

/** 特性の UUID を 4 桁の名前にする（`00009145-…` → `9145`。Device Information は数値で届くので 16 進にする: `10789` → `2a25`）。 */
const shortUuid = (uuid) => (/^\d+$/.test(uuid) ? Number(uuid).toString(16) : (/^0000([0-9a-f]{4})-/.exec(uuid)?.[1] ?? uuid));
/** 操作のあいだに本体とやり取りしたバイト列。`←` は本体へ書いたもの、`→` は本体から届いたもの。 */
const bytesLines = (events) =>
  events
    .filter((d) => (d.type === 'write' || d.type === 'frame' || d.type === 'read') && d.bytes)
    .map((d) => `${shortUuid(d.characteristic)} ${d.type === 'write' ? '←' : '→'} ${hex(d.bytes)}`);
/** 目標の書き込みのバイト列（上位が先）から、本体へ実際に書いた角度を得る。 */
const writtenDeg = (events) => {
  const w = events.find((d) => d.type === 'write' && d.purpose === 'goal');
  return w ? (((w.bytes[0] << 8) | w.bytes[1]) * 300) / 1023 - 150 : null;
};
const clampNote = (events) => {
  const c = events.find((d) => d.type === 'clamped');
  return c ? `（${c.requested} を丸めた）` : '';
};

/**
 * 1 つの操作を実行し、そのボタンの下の結果の欄を埋める。
 * 1 行目は「呼び出し → `describe(result, events)`（かかった時間）」。2 行目以降は本体とやり取りしたバイト列（`showBytes` が偽なら出さない）。
 */
async function run(id, call, fn, describe, showBytes = true) {
  const el = $(`${id}-res`);
  el.textContent = `${call} → …`;
  el.classList.remove('err');
  const events = [];
  capture = events;
  const t0 = performance.now();
  try {
    const result = await fn();
    const ms = Math.round(performance.now() - t0);
    el.textContent = [`${call} → ${describe(result, events)}  (${ms} ms)`, ...(showBytes ? bytesLines(events) : [])].join('\n');
  } catch (e) {
    el.textContent = `${call} → ✗ ${e.name}${e.code ? ` (${e.code})` : ''}: ${e.message}`;
    el.classList.add('err');
  } finally {
    if (capture === events) capture = null;
  }
  log(el.textContent.replace(/\n/g, ' | '));
}

// 操作は 1 つずつ実行する（結果の欄に、その操作のバイト列だけを載せるため）。
let queue = Promise.resolve();
const enqueue = (id, call, fn, describe) => (queue = queue.then(() => run(id, call, fn, describe)));

/** 通信しない読み出し（getter）と、本体からの通知。結果の欄を埋めるだけ。 */
function show(id, what, value, note = '（通信なし）') {
  const el = $(`${id}-res`);
  el.classList.remove('err');
  el.textContent = `${what} → ${JSON.stringify(value)}  ${note}`;
}

// --- 1. connect ---
$('avail').textContent = `bluetooth: ${kubi.bluetoothAvailability}`;
kubi.onBluetoothAvailabilityChange((a) => ($('avail').textContent = `bluetooth: ${a}`));
kubi.onConnectionChange((c) => {
  $('conn').textContent = c.state + (c.state === 'disconnected' ? ` (${c.cause})` : '');
  $('device').textContent = kubi.device ? `${kubi.device.name ?? '(名前なし)'}  id=${kubi.device.id}` : '';
  log(`connection: ${JSON.stringify(c)}`);
});
// ⚠️ connect() はクリックのハンドラ内で、他の await より先に呼ぶ（ダイアログはジェスチャーの中でしか開けない）。
// だから列に並べず、その場で呼ぶ。接続中のやり取りは多いので結果の欄には出さない（ログの診断で見る）。
$('connect').onclick = () => run('connect', 'connect()', () => kubi.connect(), (r) => JSON.stringify(r), false);
$('disconnect').onclick = () => enqueue('connect', 'disconnect()', () => kubi.disconnect(), () => 'ok');

// --- 2. 基本 info ---
$('readDeviceInfo').onclick = () => enqueue('readDeviceInfo', 'readDeviceInfo()', () => kubi.readDeviceInfo(), (info) => JSON.stringify(info, null, 2));

// --- 3. 基本 API: 1 回の呼び出し = 本体への操作 1 つ。入力 = write、出力 = read ---
const goalOut = (_r, events) => {
  const deg = writtenDeg(events);
  return `ok  書いた値 ${deg === null ? '?' : deg.toFixed(1)}°${clampNote(events)}`;
};
const speedOut = (axis) => (_r, events) => `ok  書いた値 ${kubi.speed[axis].toFixed(2)}°/s${clampNote(events)}`;
const readOut = (o) => `{ value: ${o.value.toFixed(1)}, observedAt: ${clock(o.observedAt)} }`;

$('writePanGoal').onclick = () => enqueue('writePanGoal', `writePanGoal(${num('pan')})`, () => kubi.writePanGoal(num('pan')), goalOut);
$('writeTiltGoal').onclick = () => enqueue('writeTiltGoal', `writeTiltGoal(${num('tilt')})`, () => kubi.writeTiltGoal(num('tilt')), goalOut);
$('writePanSpeed').onclick = () => enqueue('writePanSpeed', `writePanSpeed(${num('panSpeed')})`, () => kubi.writePanSpeed(num('panSpeed')), speedOut('pan'));
$('writeTiltSpeed').onclick = () => enqueue('writeTiltSpeed', `writeTiltSpeed(${num('tiltSpeed')})`, () => kubi.writeTiltSpeed(num('tiltSpeed')), speedOut('tilt'));
$('readPan').onclick = () => enqueue('readPan', 'readPan()', () => kubi.readPan(), readOut);
$('readTilt').onclick = () => enqueue('readTilt', 'readTilt()', () => kubi.readTilt(), readOut);
$('speedPan').onclick = () => show('speedPan', 'kubi.speed.pan', Number(kubi.speed.pan.toFixed(2)), '°/s（通信なし）');
$('speedTilt').onclick = () => show('speedTilt', 'kubi.speed.tilt', Number(kubi.speed.tilt.toFixed(2)), '°/s（通信なし）');

// --- 4. バッテリ情報 ---
$('readBatteryVoltage').onclick = () => enqueue('readBatteryVoltage', 'readBatteryVoltage()', () => kubi.readBatteryVoltage(), (mv) => `${mv}（mV）`);
$('batteryStatus').onclick = () => show('batteryStatus', 'kubi.batteryStatus', kubi.batteryStatus);
kubi.onBatteryStatusChange((b) => {
  show('batteryStatus', 'onBatteryStatusChange', b, '（本体からの通知）');
  log(`battery: ${JSON.stringify(b)}`);
});

// --- ログ ---
// 欄は持たないが、実機の確認中に見落とさないようログへ出す。
kubi.onServoFault((e) => log(`servoFault: ${JSON.stringify(e)}`));
kubi.onButtonChange((p) => log(`button: ${p}`));

$('clear').onclick = () => ($('log').textContent = '');
// 実機検証の記録用。画面は新しい行が上なので、保存は時系列（古い行が上）に並べ直す
$('save').onclick = () => {
  const lines = $('log').textContent.split('\n').filter((l) => l.length > 0).reverse();
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kubi-demo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
};
log('ready. 1. connect を押す。');
