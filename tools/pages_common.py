SITE = 'https://visionary-llm24-bots-projects.vercel.app'
BRAND_SVG = '<svg class="brand-mark" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M8 32a16 16 0 0 1 32 0"/><path d="M4 32h40"/><circle cx="24" cy="32" r="5" fill="currentColor" stroke="none"/></svg>'

def head(title, description, path, robots='index, follow', extra='', page=''):
    canon = SITE + path
    return f'''<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>{title}</title>
  <meta name="description" content="{description}">
  <meta name="robots" content="{robots}">
  <link rel="canonical" href="{canon}">
  <meta name="color-scheme" content="dark light">
  <meta name="theme-color" content="#0c0d10" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#f3f0e8" media="(prefers-color-scheme: light)">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Visionary">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{description}">
  <meta property="og:url" content="{canon}">
  <meta property="og:image" content="{SITE}/assets/og-image.jpg">
  <meta property="og:image:alt" content="Visionary logo and the words Show up, on purpose, above a glowing horizon arc">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <link rel="icon" href="/assets/icons/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/icons/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">
  <script src="/js/theme-init.js"></script>
  <link rel="preload" href="/assets/fonts/satoshi-400.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/assets/fonts/instrument-serif-400-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/css/fonts.css">
  <link rel="stylesheet" href="/css/style.css">{extra}
</head>
<body class="doc-body" data-page="{page}">
  <div class="grain" aria-hidden="true"></div>
  <div class="horizon-glow" aria-hidden="true"></div>
  <a class="skip-link" href="#main">Skip to content</a>
'''

def topbar(current=''):
    def link(href, label, key, cls=''):
        cur = ' aria-current="page"' if key == current else ''
        c = f' class="{cls}"' if cls else ''
        return f'<a href="{href}"{cur}{c}>{label}</a>'
    return f'''  <header class="doc-top">
    <a class="brand" href="/" aria-label="Visionary home">{BRAND_SVG}<span>Visionary</span></a>
    <nav aria-label="Site">
      {link('/privacy', 'Privacy', 'privacy', 'hide-sm')}
      {link('/terms', 'Terms', 'terms', 'hide-sm')}
      <a class="btn btn-primary btn-sm" href="/">Open Visionary</a>
    </nav>
  </header>
'''

def footer():
    return '''  <footer class="doc-foot">
    <span>© 2026 Visionary. Made in Rolla, Missouri.</span>
    <nav aria-label="Legal"><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a><button type="button" class="link-inline" data-cookie-settings>Cookie settings</button><a href="mailto:louisl4764@gmail.com">Contact</a></nav>
  </footer>
  <div class="consent" id="consent-banner" role="region" aria-label="Cookie preferences" hidden>
    <div class="consent-text">
      <strong>Your privacy, your call.</strong>
      <p>We use essential browser storage to keep you signed in and remember your settings. With your permission we'd also like to measure anonymous, cookie-free page performance and usage so we can improve Visionary. <a href="/privacy#cookies">How we use cookies</a></p>
    </div>
    <div class="consent-actions">
      <button class="btn btn-ghost btn-sm" type="button" id="consent-decline">Essential only</button>
      <button class="btn btn-primary btn-sm" type="button" id="consent-accept">Allow analytics</button>
    </div>
  </div>
  <script src="/js/consent.js"></script>
  <script src="/js/env.js"></script>
  <script src="/js/site-content.js"></script>
</body>
</html>
'''

def doc(title, description, path, current, h1, meta, intro, summary, sections):
    toc = '\n'.join(f'      <a href="#{sid}">{t}</a>' for sid, t, _ in sections)
    body = '\n'.join(
        f'''      <section id="{sid}" aria-labelledby="{sid}-h">
        <h2 id="{sid}-h"><span class="num">{i+1:02d}</span>{t}</h2>
{html}
      </section>''' for i, (sid, t, html) in enumerate(sections))
    return head(title, description, path, page=current) + topbar(current) + f'''  <main class="doc" id="main">
    <header class="doc-head" data-edit-region="head" data-edit-label="Page heading">
      <p class="eyebrow">Legal</p>
      <h1>{h1}</h1>
      <div class="doc-meta">{meta}</div>
      <p class="lede">{intro}</p>
    </header>
    <nav class="doc-toc" aria-label="On this page">
      <p>On this page</p>
{toc}
    </nav>
    <article class="doc-content" data-edit-region="body" data-edit-label="Page content">
      <div class="doc-summary">
        <h2>The short version</h2>
{summary}
      </div>
{body}
    </article>
  </main>
''' + footer()
