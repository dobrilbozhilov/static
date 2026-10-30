import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, 'md');
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));

const fileToSlug = new Map(manifest.pages.map((p) => [p.file, p.slug]));

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const known = {
  java: 'java', kotlin: 'kotlin', xml: 'xml', properties: 'properties', sql: 'sql', groovy: 'groovy', gradle: 'groovy',
  js: 'javascript', ts: 'typescript',
  c: 'c', cpp: 'cpp', bash: 'bash', sh: 'bash', json: 'json', yaml: 'yaml', yml: 'yaml', http: 'http', dockerfile: 'dockerfile',
  text: 'plaintext',
};

function makeMarked(page, headings) {
  let n = 0;
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      code({ text, lang: info }) {
        // The fence info line is "<lang> [path]"; the path is rendered as a label above the code.
        const [lang, ...rest] = (info || '').trim().split(/\s+/);
        const path = rest.join(' ');
        if (lang === 'mermaid') {
          // The source lives in a script tag so the HTML parser leaves it alone.
          return (
            `<figure class="diagram">` +
            `<div class="mmd" data-state="pending"></div>` +
            `<script type="text/x-mermaid">${text.replace(/<\/script/gi, '<\\/script')}</script>` +
            `<figcaption><button type="button" class="zoom-btn">Увеличи</button></figcaption>` +
            `</figure>`
          );
        }
        const cls = lang && known[lang] ? ` class="language-${known[lang]}"` : ` class="nohighlight"`;
        const label = path ? `<div class="code-path" title="Път в проекта">${esc(path)}</div>` : '';
        return `<div class="code-block${path ? ' has-path' : ''}">${label}<pre class="code"><code${cls}>${esc(text)}</code></pre></div>`;
      },
      heading({ tokens, depth }) {
        // parseInline already escapes entities, so the plain text is unescaped before being escaped again.
        const html = this.parser.parseInline(tokens);
        const plain = unesc(html.replace(/<[^>]+>/g, ''));
        if (depth === 1) {
          page.title = plain.trim();
          const eyebrow = `${page.group} · Java`;
          return `<header class="page-head"><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(page.title)}</h1></header>`;
        }
        const id = `${page.slug}-s${++n}`;
        if (depth === 2) headings.push({ id, text: plain });
        return `<h${depth} id="${id}">${html}</h${depth}>`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        let target = href;
        let external = false;
        try {
          const decoded = decodeURIComponent(href);
          const m = decoded.match(/^([^#]+\.md)(#.*)?$/);
          if (m && fileToSlug.has(m[1])) target = `#${fileToSlug.get(m[1])}`;
          else if (/^https?:/i.test(href)) external = true;
        } catch {
          /* leave href as is */
        }
        const t = title ? ` title="${esc(title)}"` : '';
        const ext = external ? ` target="_blank" rel="noopener"` : '';
        return `<a href="${esc(target)}"${t}${ext}>${text}</a>`;
      },
    },
  });
  return marked;
}

const wrapTables = (html) => html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');

const pages = manifest.pages.map((p) => {
  const md = readFileSync(join(root, p.file), 'utf8');
  const headings = [];
  const page = { ...p, title: p.short };
  let html = wrapTables(makeMarked(page, headings).parse(md));
  html = html.replace('</header>\n<p>', '</header>\n<p class="lead">');
  const diagrams = (html.match(/class="diagram"/g) || []).length;
  const code = (html.match(/<pre class="code">/g) || []).length;
  const paths = (html.match(/class="code-path"/g) || []).length;
  return { ...page, html, headings, diagrams, code, paths };
});

const groups = [...new Set(pages.map((p) => p.group))];
const countBy = (g) => pages.filter((p) => p.group === g).length;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const homeCards = groups
  .map(
    (g, i) =>
      `<h2 id="home-${i}">${esc(g)} <span class="count">${countBy(g)}</span></h2><div class="cards">` +
      pages
        .filter((p) => p.group === g)
        .map(
          (p) =>
            `<a class="card" href="#${p.slug}"><strong>${esc(p.short)}</strong><span>${esc(p.blurb)}</span>` +
            `<span class="card-meta">${plural(p.diagrams, 'диаграма', 'диаграми')} · ${plural(p.code, 'пример', 'примера')} · ${plural(p.headings.length, 'секция', 'секции')}</span></a>`,
        )
        .join('') +
      `</div>`,
  )
  .join('');

const totalCode = pages.reduce((a, p) => a + p.code, 0);
const totalDiagrams = pages.reduce((a, p) => a + p.diagrams, 0);
const homeHtml = `
<header class="page-head"><p class="eyebrow">Подготовка за интервю · ${pages.length} документа · ${totalDiagrams} диаграми · ${totalCode} примера с код</p><h1>${esc(manifest.title)}</h1></header>
<p class="lead">${esc(manifest.lead)}</p>
${homeCards}
<h2 id="home-howto">Как да ползваш наръчника</h2>
<p>Всеки документ следва една и съща структура: кратко определение в две-три изречения, защо концепцията съществува и какъв проблем решава, диаграма на потока, минимален пример с коментари на всеки важен ред и накрая въпросите, които ще чуеш на интервю, с отговорите им и честите капани. Чети модулите поред: първите три (езикът и JVM, колекциите, конкурентността) са основата на Java интервюто, а четвъртият показва как Spring Boot работи под капака: контейнерът, proxies, транзакциите и JPA. Преди самото интервю мини през <a href="#cheatsheet">Бърз преговор</a>.</p>
`;

const navGroups = groups.map((name) => ({ name, items: pages.filter((p) => p.group === name) }));
const navItem = (slug, label, search) =>
  `<a class="nav-item" href="#${slug}" data-slug="${slug}" data-search="${esc(search.toLowerCase())}">${esc(label)}</a>`;
const navHtml =
  navItem('home', 'Начало', 'начало home') +
  navGroups
    .map(
      (g) =>
        `<div class="nav-group"><p class="nav-label">${esc(g.name)}</p>` +
        g.items.map((p) => navItem(p.slug, p.short, p.short + ' ' + p.title + ' ' + p.headings.map((h) => h.text).join(' '))).join('') +
        `</div>`,
    )
    .join('') +
  (manifest.external && manifest.external.length
    ? `<div class="nav-group"><p class="nav-label">Връзки</p>` +
      manifest.external.map((e) => `<a class="nav-item ext" href="${esc(e.href)}" target="_blank" rel="noopener">${esc(e.label)}</a>`).join('') +
      `</div>`
    : '');

const order = ['home', ...pages.map((p) => p.slug)];
const meta = Object.fromEntries([
  ['home', { title: 'Начало', headings: [...groups.map((g, i) => ({ id: `home-${i}`, text: g })), { id: 'home-howto', text: 'Как да ползваш наръчника' }] }],
  ...pages.map((p) => [p.slug, { title: p.short, headings: p.headings }]),
]);

// Only the home page ships inline; every document is its own file, fetched when first opened.
const lazyArticle = (p) =>
  `<article class="page" id="p-${p.slug}" data-slug="${p.slug}" data-src="pages/${p.slug}.html" hidden><p class="loading">Зареждам документа…</p></article>`;
const articles = `<article class="page" id="p-home" data-slug="home" hidden>${homeHtml}</article>` + pages.map(lazyArticle).join('');

mkdirSync(join(here, 'dist', 'pages'), { recursive: true });
for (const p of pages) writeFileSync(join(here, 'dist', 'pages', `${p.slug}.html`), p.html);

const template = readFileSync(join(here, 'template.html'), 'utf8');
const out = template
  .replaceAll('<!--TITLE-->', esc(manifest.title))
  .replace('<!--NAV-->', navHtml)
  .replace('<!--ARTICLES-->', articles)
  .replace('/*META*/', `const ORDER=${JSON.stringify(order)};const META=${JSON.stringify(meta)};`);

writeFileSync(join(here, 'dist', 'index.html'), out);
const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log(`dist/index.html: ${kb} KB shell + ${pages.length} page files in dist/pages/, ${totalDiagrams} diagrams, ${totalCode} code blocks`);
for (const p of pages) console.log(`  ${p.slug.padEnd(18)} ${String(p.diagrams).padStart(2)} diagrams ${String(p.code).padStart(3)} code ${String(p.paths).padStart(3)} with path  ${p.headings.length} sections`);
