#!/usr/bin/env node
/*
 * Builds the website's guide pages from docs/guides/*.md, so the guides live
 * in one place: readable on GitHub, and published at <site>/guides/.
 *
 *   node scripts/build-guides.mjs [outDir]     (default: _site/guides)
 *
 * Links between guides (`kometa.md#step-1`) become links between pages
 * (`kometa.html#step-1`), and links to other repository files point at
 * GitHub. Headings get GitHub-style ids, so the same anchors work in both.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'docs/guides');
const out = path.resolve(process.argv[2] ?? path.join(root, '_site/guides'));
const REPO = 'https://github.com/ashveebee/streamforge';

// Index first, then the guides in the order the index lists them.
const index = readFileSync(path.join(src, 'README.md'), 'utf8');
const order = [...index.matchAll(/\]\(([a-z0-9-]+)\.md\)/g)].map((m) => m[1]);
const files = readdirSync(src).filter((f) => f.endsWith('.md'));
const pages = [
  { file: 'README.md', slug: 'index' },
  ...order.filter((s) => files.includes(`${s}.md`)).map((s) => ({ file: `${s}.md`, slug: s })),
  ...files.filter((f) => f !== 'README.md' && !order.includes(f.slice(0, -3))).map((f) => ({ file: f, slug: f.slice(0, -3) })),
];

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens. */
const slugify = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;|&#\d+;/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');

function link(href) {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  const [file, hash] = href.split('#');
  const frag = hash ? `#${hash}` : '';
  if (file === 'README.md') return `index.html${frag}`;
  if (/^[a-z0-9-]+\.md$/.test(file)) return `${file.slice(0, -3)}.html${frag}`;
  // Anything else in the repository: show it on GitHub.
  const target = path.relative(root, path.resolve(src, file)).split(path.sep).join('/');
  return `${REPO}/blob/main/${target}${frag}`;
}

function render(md) {
  const seen = new Map();
  let title = 'Guides';
  const toc = [];
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const base = slugify(html);
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const id = n ? `${base}-${n}` : base;
        if (depth === 1) title = html.replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
        // Already HTML-escaped by marked, so it goes into the page as is.
        if (depth === 2) toc.push({ id, text: html.replace(/<[^>]+>/g, '') });
        return `<h${depth} id="${id}">${depth > 1 ? `<a class="anchor" href="#${id}" aria-label="Link to this section">#</a>` : ''}${html}</h${depth}>\n`;
      },
      link({ href, title: t, tokens }) {
        const to = link(href);
        const external = /^https?:/.test(to);
        return `<a href="${esc(to)}"${t ? ` title="${esc(t)}"` : ''}${external ? ' rel="noopener"' : ''}>${this.parser.parseInline(tokens)}</a>`;
      },
      code({ text, lang }) {
        return `<div class="code"><header><span>${esc(lang || 'text')}</span><button class="copy" type="button">Copy</button></header><pre><code>${esc(text)}</code></pre></div>\n`;
      },
      table(token) {
        // Wide tables scroll inside their box instead of widening the page.
        const head = token.header.map((c) => `<th${c.align ? ` style="text-align:${c.align}"` : ''}>${this.parser.parseInline(c.tokens)}</th>`).join('');
        const rows = token.rows.map((r) => `<tr>${r.map((c) => `<td${c.align ? ` style="text-align:${c.align}"` : ''}>${this.parser.parseInline(c.tokens)}</td>`).join('')}</tr>`).join('\n');
        return `<div class="table"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>\n`;
      },
    },
  });
  return { html: marked.parse(md), title, toc };
}

function page({ slug, title, html, toc, all }) {
  const nav = all
    .map((p) => `<a href="${p.slug}.html"${p.slug === slug ? ' aria-current="page"' : ''}>${esc(p.slug === 'index' ? 'All guides' : p.title)}</a>`)
    .join('\n          ');
  const onThisPage = toc.length > 2 && slug !== 'index'
    ? `<div class="toc"><div class="toc-h">On this page</div>${toc.map((t) => `<a href="#${t.id}">${t.text}</a>`).join('')}</div>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(slug === 'index' ? 'StreamForge guides' : `${title} · StreamForge guides`)}</title>
  <meta name="description" content="${esc(slug === 'index' ? 'Step-by-step guides for installing and configuring StreamForge.' : `StreamForge guide: ${title}.`)}">
  <meta name="theme-color" content="#0b0c12">
  <link rel="icon" href="../favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="guides.css">
</head>
<body>
  <div class="ambient" aria-hidden="true"></div>
  <header class="nav">
    <div class="wrap">
      <a class="brand" href="../index.html"><img src="../favicon.svg" width="28" height="28" alt="">StreamForge</a>
      <nav aria-label="Site">
        <a href="../index.html#features">Features</a>
        <a href="index.html" aria-current="${slug === 'index' ? 'page' : 'true'}">Guides</a>
        <a href="../index.html#install">Install</a>
      </nav>
      <a class="btn" href="${REPO}">GitHub</a>
    </div>
  </header>
  <div class="wrap layout">
    <aside class="side">
      <details open>
        <summary>Guides</summary>
        <nav aria-label="Guides">
          ${nav}
        </nav>
      </details>
    </aside>
    <main>
      <article class="prose">
${html}
      </article>
      <p class="edit"><a href="${REPO}/edit/main/docs/guides/${slug === 'index' ? 'README' : slug}.md">Suggest a change to this page</a></p>
    </main>
    ${onThisPage}
  </div>
  <footer>
    <div class="wrap">
      <span>StreamForge · Not affiliated with Jellyfin, Emby, Plex, Kometa, the *arr projects, Seerr or Infinidisk.</span>
      <nav aria-label="Footer"><a href="${REPO}">GitHub</a><a href="${REPO}/releases">Releases</a><a href="${REPO}/issues">Issues</a></nav>
    </div>
  </footer>
  <script>
    // On phones the guide list starts folded, so the page itself comes first.
    if (matchMedia('(max-width: 899px)').matches) document.querySelector('.side details').open = false;
    document.querySelectorAll('.code .copy').forEach((b) => b.addEventListener('click', async () => {
      const text = b.closest('.code').querySelector('code').innerText;
      try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; } catch { b.textContent = 'Select and copy'; }
      setTimeout(() => (b.textContent = 'Copy'), 2000);
    }));
  </script>
</body>
</html>
`;
}

const CSS = `:root{--bg:#0b0c12;--surface:#12141d;--surface-2:#181b26;--line:rgb(255 255 255 / .08);--line-strong:rgb(255 255 255 / .14);--ink:#f4f5fb;--ink-2:#c6c9d8;--ink-3:#8b90a6;--violet:#a78bfa;--fuchsia:#e879f9;--cyan:#22d3ee;--grad:linear-gradient(100deg,#8b5cf6,#d946ef 45%,#22d3ee)}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-padding-top:84px}html,body{overflow-x:clip}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.7 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}:focus-visible{outline:2px solid var(--violet);outline-offset:3px;border-radius:6px}
.wrap{max-width:1240px;margin:0 auto;padding:0 16px}@media(min-width:720px){.wrap{padding:0 32px}}
.ambient{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden}.ambient::before{content:"";position:absolute;width:900px;height:900px;border-radius:50%;filter:blur(140px);opacity:.18;background:#7c3aed;top:-480px;left:-300px}
header.nav{position:sticky;top:0;z-index:20;backdrop-filter:saturate(160%) blur(14px);-webkit-backdrop-filter:saturate(160%) blur(14px);background:rgb(11 12 18 / .75);border-bottom:1px solid var(--line)}
.nav .wrap{display:flex;align-items:center;gap:16px;height:60px}.brand{display:flex;align-items:center;gap:10px;font-weight:700;text-decoration:none;font-size:16px}
.nav nav{display:flex;gap:2px;margin-left:auto}.nav nav a{color:var(--ink-3);text-decoration:none;font-size:14px;font-weight:500;padding:7px 10px;border-radius:9px}.nav nav a:hover,.nav nav a[aria-current]{color:var(--ink);background:rgb(255 255 255 / .05)}
@media(max-width:560px){.nav nav a:not([aria-current]){display:none}}
.btn{display:inline-flex;align-items:center;height:34px;padding:0 12px;border-radius:10px;border:1px solid var(--line-strong);background:rgb(255 255 255 / .03);font-size:14px;font-weight:600;text-decoration:none}.btn:hover{background:rgb(255 255 255 / .07)}
.layout{display:grid;gap:24px;padding-top:28px;padding-bottom:64px}
@media(min-width:900px){.layout{grid-template-columns:220px minmax(0,1fr)}}@media(min-width:1240px){.layout{grid-template-columns:220px minmax(0,1fr) 220px}}
.side details{border:1px solid var(--line);border-radius:16px;background:var(--surface);padding:10px}.side summary{cursor:pointer;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--violet);padding:4px 8px;list-style:none}.side summary::-webkit-details-marker{display:none}
@media(min-width:900px){.side{position:sticky;top:84px;align-self:start}.side summary{pointer-events:none}}
.side nav{display:flex;flex-direction:column;gap:2px;margin-top:6px}.side nav a{text-decoration:none;color:var(--ink-3);font-size:14px;padding:6px 8px;border-radius:9px;line-height:1.35}.side nav a:hover{color:var(--ink);background:rgb(255 255 255 / .04)}.side nav a[aria-current]{color:var(--ink);background:rgb(139 92 246 / .14)}
.toc{display:none}@media(min-width:1240px){.toc{display:flex;flex-direction:column;gap:2px;position:sticky;top:84px;align-self:start;max-height:calc(100vh - 110px);overflow:auto}}
.toc-h{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);margin-bottom:6px}.toc a{color:var(--ink-3);text-decoration:none;font-size:13px;padding:4px 0;line-height:1.35}.toc a:hover{color:var(--ink)}
main{min-width:0}.prose{max-width:780px}
.prose h1{font-size:clamp(30px,5vw,44px);line-height:1.1;letter-spacing:-.03em;font-weight:800;margin:6px 0 18px;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.prose h2{font-size:24px;letter-spacing:-.02em;margin:48px 0 12px;padding-top:20px;border-top:1px solid var(--line);line-height:1.25}
.prose h3{font-size:18px;margin:32px 0 8px}.prose h4{font-size:16px;margin:24px 0 6px}
.prose h2,.prose h3,.prose h4{position:relative}.anchor{position:absolute;left:-1.1em;color:var(--ink-3);text-decoration:none;opacity:0;font-weight:500}h2:hover .anchor,h3:hover .anchor,h4:hover .anchor{opacity:1}
.prose p,.prose li{color:var(--ink-2)}.prose strong{color:var(--ink)}.prose a{color:var(--violet);text-decoration-color:rgb(167 139 250 / .4);text-underline-offset:3px}.prose a:hover{text-decoration-color:var(--violet)}
.prose ul,.prose ol{padding-left:1.4em}.prose li{margin:4px 0}.prose li>ul,.prose li>ol{margin:4px 0}
.prose code{font:.86em "JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;background:rgb(255 255 255 / .06);border:1px solid var(--line);padding:1px 5px;border-radius:6px;color:var(--ink);overflow-wrap:anywhere}
.prose blockquote{margin:20px 0;padding:12px 16px;border-left:3px solid var(--violet);background:rgb(139 92 246 / .07);border-radius:0 12px 12px 0}.prose blockquote p{margin:4px 0}
.code{margin:18px 0;border-radius:14px;border:1px solid var(--line-strong);background:#07080c;overflow:hidden}.code header{display:flex;align-items:center;justify-content:space-between;padding:7px 12px;border-bottom:1px solid var(--line);color:var(--ink-3);font-size:12px}
.code pre{margin:0;padding:14px 16px;overflow-x:auto;font:13.5px/1.65 "JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ink-2)}.code pre code{background:none;border:0;padding:0;font:inherit;color:inherit;overflow-wrap:normal}
.copy{height:26px;padding:0 10px;border-radius:7px;border:1px solid var(--line-strong);background:rgb(255 255 255 / .04);color:var(--ink-2);font:500 12px Inter,sans-serif;cursor:pointer}.copy:hover{color:var(--ink);background:rgb(255 255 255 / .08)}
.table{margin:18px 0;overflow-x:auto;border:1px solid var(--line);border-radius:14px;background:var(--surface)}.prose table{border-collapse:collapse;width:100%;font-size:14.5px}
.prose th,.prose td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--line);vertical-align:top}.prose th{color:var(--ink);font-weight:600;background:rgb(255 255 255 / .03)}.prose tr:last-child td{border-bottom:0}.prose td{color:var(--ink-2)}
.edit{max-width:780px;margin-top:48px;padding-top:16px;border-top:1px solid var(--line);font-size:14px}.edit a{color:var(--ink-3)}.edit a:hover{color:var(--ink)}
footer{border-top:1px solid var(--line);padding:32px 0 44px;color:var(--ink-3);font-size:14px}footer .wrap{display:flex;flex-wrap:wrap;gap:16px;justify-content:space-between}footer nav{display:flex;gap:18px}footer a{text-decoration:none}footer a:hover{color:var(--ink)}
`;

mkdirSync(out, { recursive: true });
const built = pages.map((p) => ({ ...p, ...render(readFileSync(path.join(src, p.file), 'utf8')) }));
for (const p of built) writeFileSync(path.join(out, `${p.slug}.html`), page({ ...p, all: built }));
writeFileSync(path.join(out, 'guides.css'), CSS);
console.log(`Built ${built.length} guide pages in ${path.relative(process.cwd(), out) || out}`);
