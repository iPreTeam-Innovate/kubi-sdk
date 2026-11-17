/**
 * 検査の入口。`pnpm -r check` から呼ばれる（packages/js を cwd として実行される）。
 *
 * 順に回し、最初に落ちたところで非 0 で終わる。パイプに通さず exit code で判定する。
 *
 *   1. 型検査        tsc --noEmit
 *   2. テスト        vitest run
 *   3. 層の分離      engine / protocol / kubi.ts / types.ts が DOM・Web Bluetooth に触れていない
 *   4. JSDoc         公開面（src/kubi.ts）の public メンバーに説明がある
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const cwd = process.cwd();

function step(name: string, fn: () => boolean): void {
  process.stdout.write(`\n== ${name}\n`);
  const ok = fn();
  if (!ok) {
    process.stdout.write(`\n!! ${name} failed\n`);
    process.exit(1);
  }
}

function run(cmd: string, args: string[]): boolean {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  return r.status === 0;
}

/** DOM / 経路に触れてよいのは transport だけ。 */
function checkIsolation(): boolean {
  const roots = ['src/engine', 'src/protocol', 'src/status', 'src/kubi.ts', 'src/types.ts', 'src/index.ts'];
  // 経路の API そのもの。型名 `BluetoothAvailability` や transport の import 名は公開面の語なので対象にしない。
  const forbidden = [/\bnavigator\b/, /\bwindow\b/, /\bdocument\b/, /\bBluetoothDevice\b/, /\bBluetoothRemoteGATT\w*/, /requestDevice/, /getPrimaryService/];
  const files: string[] = [];
  const walk = (p: string): void => {
    let st;
    try {
      st = statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const e of readdirSync(p)) walk(join(p, e));
    } else if (p.endsWith('.ts')) {
      files.push(p);
    }
  };
  for (const r of roots) walk(join(cwd, r));
  let ok = true;
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const re of forbidden) {
      const m = re.exec(text);
      if (m) {
        process.stdout.write(`  ${relative(cwd, f)}: "${m[0]}" は transport 以外で使えない\n`);
        ok = false;
      }
    }
  }
  if (ok) process.stdout.write(`  ${files.length} files ok\n`);
  return ok;
}

/** 公開面の public メンバーは JSDoc を持つ（エディタの hover が API 仕様）。 */
function checkJsDoc(): boolean {
  const text = readFileSync(join(cwd, 'src/kubi.ts'), 'utf8');
  // class Kubi の中だけを見る（ファイル先頭のヘルパ関数の本体は対象外）
  const start = text.indexOf('export class Kubi {');
  const end = text.indexOf('\n}\n', start);
  const lines = text.slice(start, end).split('\n');
  const member = /^  (?:static |get |async )*[a-zA-Z_]\w*\s*[(<:]/;
  let ok = true;
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!member.test(line) || line.trim().startsWith('private') || line.trim().startsWith('constructor')) continue;
    // 直前の非空行が `*/` か、オーバーロードの続き（同名の宣言）なら可
    let j = i - 1;
    while (j >= 0 && lines[j]!.trim() === '') j--;
    const prev = lines[j]?.trim() ?? '';
    const name = /^\s*(?:static |get |async )*([a-zA-Z_]\w*)/.exec(line)?.[1];
    const prevName = /^\s*(?:static |get |async )*([a-zA-Z_]\w*)/.exec(prev)?.[1];
    if (prev.endsWith('*/') || (name !== undefined && prevName === name)) {
      count++;
      continue;
    }
    process.stdout.write(`  src/kubi.ts: JSDoc が無い: ${line.trim()}\n`);
    ok = false;
  }
  if (ok) process.stdout.write(`  ${count} members documented\n`);
  return ok;
}

step('typecheck', () => run('pnpm', ['exec', 'tsc', '--noEmit']));
step('test', () => run('pnpm', ['exec', 'vitest', 'run']));
step('isolation', checkIsolation);
step('jsdoc', checkJsDoc);

process.stdout.write('\nall checks passed\n');
