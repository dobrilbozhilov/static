import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, 'md');
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(join(here, 'catalog.json'), 'utf8'));

// Catalog pattern pages live under md/catalog/<slug>.md and route to #cat-<slug>.
const catSlug = (slug) => `cat-${slug}`;
const allPatterns = catalog.families.flatMap((f) => f.patterns.map((p) => ({ ...p, family: f })));
const patternBySlug = new Map(allPatterns.map((p) => [p.slug, p]));

const fileToSlug = new Map([
  ...manifest.pages.map((p) => [p.file, p.slug]),
  ...allPatterns.map((p) => [`${p.slug}.md`, catSlug(p.slug)]),
]);

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function makeMarked(page, headings) {
  let n = 0;
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      code({ text, lang }) {
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
        const known = { ts: 'typescript', js: 'javascript', sql: 'sql', bash: 'bash', sh: 'bash', json: 'json', lua: 'lua', yaml: 'yaml', http: 'http' };
        const cls = lang && known[lang] ? ` class="language-${known[lang]}"` : ` class="nohighlight"`;
        return `<pre class="code"><code${cls}>${esc(text)}</code></pre>`;
      },
      heading({ tokens, depth }) {
        // parseInline already escapes entities, so the plain text is unescaped before being escaped again.
        const html = this.parser.parseInline(tokens);
        const plain = unesc(html.replace(/<[^>]+>/g, ''));
        if (depth === 1) {
          const title = plain.replace(/\s*-\s*System Design\s*$/i, '').trim();
          page.title = title;
          const eyebrow = page.eyebrow || `${page.group} · System Design`;
          const style = page.color ? ` style="color:var(${page.color})"` : '';
          return `<header class="page-head"><p class="eyebrow"${style}>${esc(eyebrow)}</p><h1>${esc(title)}</h1></header>`;
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
  const html = wrapTables(makeMarked(page, headings).parse(md));
  const diagrams = (html.match(/class="diagram"/g) || []).length;
  return { ...page, html, headings, diagrams };
});

const famColor = (f) => `--fam-${f.id}`;
const chip = (p, extraClass = '') =>
  `<a class="chip${extraClass}" href="#${catSlug(p.slug)}" title="${esc(p.tagline)}">${esc(p.name)}</a>`;

const patternPages = allPatterns.map((p) => {
  const md = readFileSync(join(root, 'catalog', `${p.slug}.md`), 'utf8');
  const headings = [];
  const page = { slug: catSlug(p.slug), group: p.family.name, eyebrow: `Каталог · ${p.family.name}`, color: famColor(p.family), title: p.name };
  let html = wrapTables(makeMarked(page, headings).parse(md));
  html = html.replace('</header>\n<p>', '</header>\n<p class="lead">');
  const related = (p.related || []).map((s) => patternBySlug.get(s)).filter(Boolean);
  const relId = `${page.slug}-related`;
  headings.push({ id: relId, text: 'Свързани патерни' });
  html +=
    `<h2 id="${relId}">Свързани патерни</h2>` +
    `<div class="chips" style="--fam:var(${famColor(p.family)})">` +
    `<a class="chip chip-family" href="#catalog">Каталог · ${esc(p.family.name)}</a>` +
    related.map((r) => chip(r)).join('') +
    `</div>`;
  const diagrams = (html.match(/class="diagram"/g) || []).length;
  return { ...page, html, headings, diagrams };
});

const catalogHtml =
  `<header class="page-head"><p class="eyebrow">${esc(catalog.eyebrow)}</p><h1>${allPatterns.length} патерна, ${catalog.families.length} семейства</h1></header>` +
  `<p class="lead">${esc(catalog.lead)}</p>` +
  `<div class="families">` +
  catalog.families
    .map(
      (f) =>
        `<section class="family" id="fam-${f.id}" style="--fam:var(${famColor(f)})">` +
        `<h2 class="family-name">${esc(f.name)}</h2>` +
        `<p class="family-tagline">${esc(f.tagline)}</p>` +
        `<div class="chips">${f.patterns.map((p) => chip(p)).join('')}</div>` +
        `</section>`,
    )
    .join('') +
  `</div>` +
  `<p class="catalog-note">Кликни патерн, за да го отвориш. Всяка страница има една и съща структура: аналогия, проблем, как работи, кога да го ползваш, капани и свързани патерни.</p>`;

const countBy = (g) => pages.filter((p) => p.group === g).length;
const groupsHome = [...new Set(pages.map((p) => p.group))];
const homeCardsByGroup = groupsHome
  .map((g) => `<h2 id="home-${groupsHome.indexOf(g)}">${esc(g)} <span class="count">${countBy(g)}</span></h2><div class="cards">${pages
    .filter((p) => p.group === g)
    .map(
      (p) =>
        `<a class="card" href="#${p.slug}"><strong>${esc(p.short)}</strong><span>${esc(p.blurb)}</span><span class="card-meta">${p.diagrams} ${p.diagrams === 1 ? 'диаграма' : 'диаграми'} · ${p.headings.length} секции</span></a>`,
    )
    .join('')}</div>`)
  .join('');
const homeCatalog =
  `<h2 id="home-catalog">${esc(catalog.title)} <span class="count">${allPatterns.length}</span></h2>` +
  `<p>${allPatterns.length} архитектурни патерна в ${catalog.families.length} семейства, обяснени просто: аналогия от живота, проблемът, как работи, кога да го ползваш и къде се чупи. Имената са на английски, обясненията на български.</p>` +
  `<div class="cards">` +
  catalog.families
    .map(
      (f) =>
        `<a class="card" href="#catalog"><strong style="color:var(${famColor(f)})">${esc(f.name)}</strong><span>${esc(f.tagline)}</span><span class="card-meta">${f.patterns.length} патерна</span></a>`,
    )
    .join('') +
  `</div>`;
const homeHtml = `
<header class="page-head"><p class="eyebrow">Наръчник · ${pages.length} документа · ${allPatterns.length} патерна</p><h1>${esc(manifest.title)}</h1></header>
<p class="lead">${countBy('Системи')} системи, ${countBy('Градивни блокове')} градивни блока (брокери, консенсус, мрежа, Postgres, API), ${countBy('Дизайн патерни')} документа с дизайн патерни и ${countBy('Алгоритми')} с алгоритми, всички с Node.js код, плюс речник с архитектурните патерни, чеклист за изискванията и каталог с ${allPatterns.length} патерна, обяснени просто, написани за подготовка за system design интервю на senior ниво. Всяка система има архитектурна диаграма, оразмеряване, модел на данните и въпросите, които наистина се задават. Диаграмите са в единен стил: услуги в заоблени кутии, хранилища като цилиндри, брокерът като кръг, всяка стрелка с протокол или тема.</p>
${homeCardsByGroup}
${homeCatalog}
<h2 id="home-legend">Как да четеш диаграмите</h2>
<figure class="diagram"><div class="mmd" data-state="pending"></div><script type="text/x-mermaid">flowchart LR
    svc("Услуга или процес<br/>име и роля") -->|"синхронна заявка, протокол"| store[("Хранилище<br/>база, кеш, обектно хранилище")]
    svc -.->|"асинхронно събитие, тема"| bus(("Брокер<br/>Kafka, NATS, Pub/Sub"))
    ext[["Външна система<br/>Stripe, FCM, борса"]] -->|"webhook или feed"| svc</script><figcaption><button type="button" class="zoom-btn">Увеличи</button></figcaption></figure>
<p>Плътна стрелка е заявка, която някой чака. Пунктирана стрелка е работа след факта, която потребителят не чака. Етикетът на стрелката казва протокола, темата или операцията, защото стрелка без етикет означава само "свързани някак".</p>
`;

const navGroups = [];
for (const p of pages) {
  let g = navGroups.find((x) => x.name === p.group);
  if (!g) navGroups.push((g = { name: p.group, items: [] }));
  g.items.push(p);
}

const navItem = (slug, label, search) =>
  `<a class="nav-item" href="#${slug}" data-slug="${slug}" data-search="${esc(search.toLowerCase())}">${esc(label)}</a>`;
const catalogNav =
  `<div class="nav-group"><p class="nav-label">Каталог</p>` +
  navItem('catalog', catalog.title, `каталог catalog patterns патерни ${allPatterns.map((p) => `${p.name} ${p.tagline}`).join(' ')}`) +
  `</div>`;

const navHtml =
  navItem('home', 'Начало', 'начало home') +
  navGroups
    .map(
      (g, i) =>
        `<div class="nav-group"><p class="nav-label">${esc(g.name)}</p>` +
        g.items
          .map((p) => navItem(p.slug, p.short, p.short + ' ' + p.title + ' ' + p.headings.map((h) => h.text).join(' ')))
          .join('') +
        `</div>` +
        (i === 0 ? catalogNav : ''),
    )
    .join('') +
  (manifest.external && manifest.external.length
    ? `<div class="nav-group"><p class="nav-label">Връзки</p>` +
      manifest.external
        .map((e) => `<a class="nav-item ext" href="${esc(e.href)}" target="_blank" rel="noopener">${esc(e.label)}</a>`)
        .join('') +
      `</div>`
    : '');

const order = ['home', ...pages.map((p) => p.slug), 'catalog', ...patternPages.map((p) => p.slug)];
const meta = Object.fromEntries([
  [
    'home',
    {
      title: 'Начало',
      headings: [
        ...groupsHome.map((g, i) => ({ id: `home-${i}`, text: g })),
        { id: 'home-catalog', text: catalog.title },
        { id: 'home-legend', text: 'Как да четеш диаграмите' },
      ],
    },
  ],
  ...pages.map((p) => [p.slug, { title: p.short, headings: p.headings }]),
  ['catalog', { title: catalog.title, headings: catalog.families.map((f) => ({ id: `fam-${f.id}`, text: f.name })) }],
  ...patternPages.map((p) => [p.slug, { title: p.title, headings: p.headings }]),
]);

// Only the home and catalog pages ship inline; every document is its own file, fetched when first opened.
const lazyArticle = (p) =>
  `<article class="page" id="p-${p.slug}" data-slug="${p.slug}" data-src="pages/${p.slug}.html" hidden><p class="loading">Зареждам документа…</p></article>`;
const articles =
  `<article class="page" id="p-home" data-slug="home" hidden>${homeHtml}</article>` +
  `<article class="page catalog" id="p-catalog" data-slug="catalog" hidden>${catalogHtml}</article>` +
  pages.map(lazyArticle).join('') +
  patternPages.map(lazyArticle).join('');
mkdirSync(join(here, 'dist', 'pages'), { recursive: true });
for (const p of [...pages, ...patternPages]) writeFileSync(join(here, 'dist', 'pages', `${p.slug}.html`), p.html);

const template = readFileSync(join(here, 'template.html'), 'utf8');
const out = template
  .replaceAll('<!--TITLE-->', esc(manifest.title))
  .replace('<!--NAV-->', navHtml)
  .replace('<!--ARTICLES-->', articles)
  .replace('/*META*/', `const ORDER=${JSON.stringify(order)};const META=${JSON.stringify(meta)};`);

mkdirSync(join(here, 'dist'), { recursive: true });
writeFileSync(join(here, 'dist', 'index.html'), out);
const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
const totalDiagrams = [...pages, ...patternPages].reduce((a, p) => a + p.diagrams, 0) + 1;
console.log(`dist/index.html: ${kb} KB shell + ${pages.length} page files + ${patternPages.length} pattern files in dist/pages/, ${totalDiagrams} diagrams`);
for (const p of pages) console.log(`  ${p.slug.padEnd(16)} ${String(p.diagrams).padStart(2)} diagrams  ${p.headings.length} sections`);
console.log(`  catalog: ${catalog.families.map((f) => `${f.name} ${f.patterns.length}`).join(', ')}`);
