"""Renders docs/ENGINEERING_NOTES.md to studio-notes.html (noindex, Studio look).

Tiny Markdown subset on purpose (headings, paragraphs, lists, tables, fenced
code, inline code/bold/links, rules) so no third-party package is needed.
"""
import html as H
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pages_common import head, topbar, footer  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'docs', 'ENGINEERING_NOTES.md')
OUT = os.path.join(ROOT, 'studio-notes.html')


def inline(text):
    text = H.escape(text, quote=False)
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    text = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', text)
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', text)
    return text


def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')


def render(md):
    out, toc = [], []
    lines = md.split('\n')
    i = 0
    para = []

    def flush():
        if para:
            out.append(f'<p>{inline(" ".join(para))}</p>')
            para.clear()

    while i < len(lines):
        line = lines[i]
        if line.startswith('```'):
            flush()
            j = i + 1
            buf = []
            while j < len(lines) and not lines[j].startswith('```'):
                buf.append(lines[j]); j += 1
            out.append(f'<pre><code>{H.escape(chr(10).join(buf))}</code></pre>')
            i = j + 1
            continue
        m = re.match(r'^(#{1,4})\s+(.*)$', line)
        if m:
            flush()
            level = len(m.group(1))
            text = m.group(2).strip()
            sid = slug(text)
            if level == 2:
                toc.append((sid, text))
            if level == 1:
                i += 1
                continue  # the page header carries the H1
            if level == 2:
                # Sections carry the ids so the shared TOC script (site-content.js) can rebuild the nav.
                if any(o.startswith('<section') for o in out):
                    out.append('</section>')
                out.append(f'<section id="{sid}" aria-labelledby="{sid}-h"><h2 id="{sid}-h">{inline(text)}</h2>')
            else:
                out.append(f'<h{level} id="{sid}">{inline(text)}</h{level}>')
            i += 1
            continue
        if line.strip() == '---':
            flush(); out.append('<hr>'); i += 1; continue
        if line.startswith('|'):
            flush()
            rows = []
            while i < len(lines) and lines[i].startswith('|'):
                rows.append([c.strip() for c in lines[i].strip().strip('|').split('|')]); i += 1
            rows = [r for r in rows if not all(re.fullmatch(r':?-+:?', c) for c in r)]
            thead = ''.join(f'<th>{inline(c)}</th>' for c in rows[0])
            tbody = ''.join('<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in r) + '</tr>' for r in rows[1:])
            out.append(f'<div class="table-wrap"><table><thead><tr>{thead}</tr></thead><tbody>{tbody}</tbody></table></div>')
            continue
        m = re.match(r'^(\s*)([-*]|\d+\.)\s+(.*)$', line)
        if m:
            flush()
            ordered = m.group(2)[0].isdigit()
            tag = 'ol' if ordered else 'ul'
            items = []
            while i < len(lines):
                mm = re.match(r'^(\s*)([-*]|\d+\.)\s+(.*)$', lines[i])
                if not mm:
                    break
                items.append(mm.group(3)); i += 1
                # continuation lines
                while i < len(lines) and lines[i].startswith('  ') and not re.match(r'^\s*([-*]|\d+\.)\s+', lines[i]):
                    items[-1] += ' ' + lines[i].strip(); i += 1
            out.append(f'<{tag}>' + ''.join(f'<li>{inline(it)}</li>' for it in items) + f'</{tag}>')
            continue
        if not line.strip():
            flush(); i += 1; continue
        para.append(line.strip()); i += 1
    flush()
    if any(o.startswith('<section') for o in out):
        out.append('</section>')
    return '\n'.join(out), toc


md = open(SRC, encoding='utf-8').read()
body, toc = render(md)
toc_html = '\n'.join(f'      <a href="#{sid}">{H.escape(t)}</a>' for sid, t in toc)
generated = re.search(r'### 5\.0 .*? (\d{4}-\d{2}-\d{2})', md)
stamp = generated.group(1) if generated else ''

html = head('Engineering notes — Visionary Studio', 'Everything built, changed and decided in Visionary, for site admins.', '/studio-notes', robots='noindex, nofollow', page='notes') + topbar() + f'''  <main class="doc notes" id="main">
    <header class="doc-head">
      <p class="eyebrow">Studio</p>
      <h1>Engineering notes</h1>
      <div class="doc-meta">Last release {stamp} · generated from <code>docs/ENGINEERING_NOTES.md</code> · <a href="/studio">Back to Studio</a></div>
      <p class="lede">Everything that has been built, changed, decided and left to do — releases, schema, AI modes, operations and lessons.</p>
    </header>
    <nav class="doc-toc" aria-label="On this page">
      <p>On this page</p>
{toc_html}
    </nav>
    <article class="doc-content notes-content">
{body}
    </article>
  </main>
''' + footer()

open(OUT, 'w', encoding='utf-8').write(html)
print('studio-notes.html written')
