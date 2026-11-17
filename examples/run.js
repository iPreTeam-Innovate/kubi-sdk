// サンプルコードを並べて、その場で実行するページ。
// サンプルは 1 メソッド 1 ファイル。どれも `export default async function (kubi) { … }` の形で、接続済みの `kubi` を受け取る。
import { Kubi } from 'kubi-sdk';

/** 並べる順。ファイル名は `<名前>.js`。API リファレンスの節と同じ区分。 */
const EXAMPLES = [
  ['Kubi', ['forBrowser', 'constructor']],
  ['Connection', ['capabilities', 'connectionState', 'device', 'bluetoothAvailability', 'connect', 'disconnect', 'dispose', 'onConnectionChange', 'onBluetoothAvailabilityChange']],
  ['Servo (basic API)', ['writePanGoal', 'writeTiltGoal', 'writePanSpeed', 'writeTiltSpeed', 'readPan', 'readTilt']],
  ['Speed', ['speed']],
  ['Status and device info', ['readBatteryVoltage', 'batteryStatus', 'onBatteryStatusChange', 'onServoFault', 'buttonPressed', 'onButtonChange', 'readDeviceInfo']],
  ['Diagnostics', ['onDiagnostic']],
];

const $ = (id) => document.getElementById(id);
const kubi = Kubi.forBrowser();
window.kubi = kubi; // DevTools から触れるように

// --- 上の帯: 接続（ほとんどのサンプルは接続済みの kubi を使う）---
kubi.onConnectionChange((c) => {
  $('conn').textContent = c.state + (c.state === 'disconnected' ? ` (${c.cause})` : '');
  $('device').textContent = kubi.device ? (kubi.device.name ?? '(名前なし)') : '';
});
// ⚠️ connect() はクリックのハンドラ内で、他の await より先に呼ぶ。
$('connect').onclick = () => kubi.connect();
$('disconnect').onclick = () => kubi.disconnect();

/** `console.log` の引数を、サンプルのコメントと同じ見た目にする。 */
function format(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value instanceof Uint8Array) return `Uint8Array [${Array.from(value).join(', ')}]`;
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// サンプルは 1 つずつ実行する（`console.log` の行き先を、実行中のサンプルの出力欄にするため）。
const buttons = [];
async function runExample(example, out) {
  for (const b of buttons) b.disabled = true;
  out.textContent = '';
  out.classList.remove('err');
  const original = console.log;
  console.log = (...values) => {
    original(...values);
    out.textContent += values.map(format).join(' ') + '\n';
  };
  try {
    await example(kubi);
    if (out.textContent === '') out.textContent = '（出力なし）';
  } catch (e) {
    out.textContent += `✗ ${e.name}${e.code ? ` (${e.code})` : ''}: ${e.message}`;
    out.classList.add('err');
  } finally {
    console.log = original;
    for (const b of buttons) b.disabled = false;
  }
}

// 先に全部読み込んでおく（connect のサンプルを、クリックの中ですぐ呼べるように）。
const loaded = new Map();
await Promise.all(
  EXAMPLES.flatMap(([, names]) => names).map(async (name) => {
    const [source, module] = await Promise.all([fetch(`./${name}.js`).then((r) => r.text()), import(`./${name}.js`)]);
    loaded.set(name, { source, example: module.default });
  }),
);

const list = $('list');
list.textContent = '';
for (const [group, names] of EXAMPLES) {
  const h2 = document.createElement('h2');
  h2.textContent = group;
  list.append(h2);
  for (const name of names) {
    const { source, example } = loaded.get(name);
    const section = document.createElement('section');
    section.id = name;
    const h3 = document.createElement('h3');
    h3.textContent = source.split('\n')[0].replace(/^\/\/ /, ''); // 1 行目がメソッドの名前
    const file = document.createElement('a');
    file.href = `./${name}.js`;
    file.textContent = `${name}.js`;
    h3.append(file);
    const code = document.createElement('pre');
    code.textContent = source.trimEnd();
    const run = document.createElement('div');
    run.className = 'run';
    const button = document.createElement('button');
    button.textContent = '実行';
    const out = document.createElement('pre');
    button.onclick = () => runExample(example, out);
    buttons.push(button);
    run.append(button, out);
    section.append(h3, code, run);
    list.append(section);
  }
}
