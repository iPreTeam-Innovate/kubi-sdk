// docs/ の Markdown（API リファレンスとガイド）を読み込んで表示するページ。
// 文書の写しは持たない。`docs/api.ja.md` などを直せば、このページにも反映される。
// 対応している書き方は、その文書が使っているものだけ: 見出し・段落・箇条書き・表・コードブロック・`コード`・**強調**・リンク。

const params = new URLSearchParams(location.search);
const doc = params.get('doc') === 'guide' ? 'guide' : 'api';
const lang = params.get('lang') === 'en' ? 'en' : 'ja';
const file = `../docs/${doc}${lang === 'ja' ? '.ja' : ''}.md`;
const pageUrl = (d, l, hash = '') => `?doc=${d}&lang=${l}${hash}`;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 見出しの id。GitHub と同じ作り方（小文字にし、英数字・空白・ハイフン以外を捨て、空白をハイフンに）なので、文書の中の `#…` のリンクがそのまま効く。 */
const slug = (heading) => heading.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-');

/** 文書どうしのリンク（`./guide.ja.md#…`）は、このページの URL に読み替える。 */
function linkTo(href) {
  const m = /^\.\/(api|guide)(\.ja)?\.md(#.*)?$/.exec(href);
  if (m) return pageUrl(m[1], m[2] ? 'ja' : 'en', m[3] ?? '');
  return href;
}

/** 行の中の書き方: `コード`・[リンク](…)・**強調**。 */
function inline(text) {
  const codes = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => `<a href="${linkTo(href)}">${label}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

/** Markdown → HTML。あわせて目次（見出しの一覧）を返す。 */
function render(markdown) {
  const lines = markdown.split('\n');
  const html = [];
  const toc = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length > 0) html.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      flush();
      const code = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      html.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
    } else if (/^#{1,4} /.test(line)) {
      flush();
      const level = line.indexOf(' ');
      const title = line.slice(level + 1);
      if (level === 2 || level === 3) toc.push({ level, title, id: slug(title) });
      html.push(`<h${level} id="${slug(title)}">${inline(title)}</h${level}>`);
    } else if (line.startsWith('|')) {
      flush();
      const rows = [];
      for (; i < lines.length && lines[i].startsWith('|'); i++) rows.push(cells(lines[i]));
      i--;
      const [head, , ...body] = rows; // 2 行目は区切り（|---|---|）
      html.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` +
          `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
      );
    } else if (line.startsWith('- ')) {
      flush();
      const items = [];
      for (; i < lines.length && lines[i].startsWith('- '); i++) items.push(lines[i].slice(2));
      i--;
      html.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`);
    } else if (line.trim() === '') {
      flush();
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return { html: html.join('\n'), toc };
}

// 上の帯: デモへ戻る・文書の切り替え・言語の切り替え
const tab = (label, d, l) => `<a href="${pageUrl(d, l)}"${d === doc && l === lang ? ' class="on"' : ''}>${label}</a>`;
document.getElementById('bar').innerHTML = [
  '<a href="./">← デモへ戻る</a>',
  '<span class="sep">|</span>',
  tab(lang === 'ja' ? 'API リファレンス' : 'API reference', 'api', lang),
  tab(lang === 'ja' ? 'ガイド' : 'Guide', 'guide', lang),
  '<span class="sep">|</span>',
  tab('日本語', doc, 'ja'),
  tab('English', doc, 'en'),
].join(' ');
document.documentElement.lang = lang;

const main = document.getElementById('doc');
try {
  const response = await fetch(file);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const { html, toc } = render(await response.text());
  main.innerHTML = html;
  document.title = main.querySelector('h1')?.textContent ?? document.title;
  document.getElementById('toc').innerHTML = toc.map((h) => `<a class="h${h.level}" href="#${h.id}">${esc(h.title)}</a>`).join('');
  // 見出しは読み込んだ後にできるので、URL の # へは自分で移る
  if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
} catch (e) {
  main.innerHTML = `<p class="error">${esc(file)} を読み込めませんでした（${esc(String(e.message))}）。<code>pnpm demo</code> で開いてください。</p>`;
}
