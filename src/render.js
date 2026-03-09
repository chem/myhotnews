// src/render.js
import { cph } from './process.js';

const SOURCE_LABELS = { hn: 'HN', nitter: 'X' };
const SOURCE_COLORS = { hn: '#ff6600', nitter: '#1da1f2' };

function sanitizeUrl(url) {
  if (!url) return '#';
  const s = String(url).trim().toLowerCase();
  return (s.startsWith('https://') || s.startsWith('http://')) ? url : '#';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatAge(postedAt, now = Date.now()) {
  const minutes = Math.floor((now - postedAt) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatCph(record, now) {
  const val = cph(record, now);
  return val >= 10 ? val.toFixed(0) : val.toFixed(1);
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch { return ''; }
}

function formatDeviation(record) {
  const d = record.commentsDeviation ?? 0;
  const formatted = Math.abs(d) >= 10 ? Math.abs(d).toFixed(0) : Math.abs(d).toFixed(1);
  return d >= 0 ? `+${formatted}\u03c3` : `\u2212${formatted}\u03c3`;
}

export function renderHTML(records, generatedAt, now = Date.now()) {
  const pageAge = formatAge(generatedAt, now);

  const rows = records.map((r, i) => `
    <li>
      <span class="rank">${i + 1}</span>
      <div class="content">
        <a href="${escapeHtml(sanitizeUrl(r.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.title)}</a>${r.comments_url ? ` <span class="divider">||</span> <a class="comments-link" href="${escapeHtml(sanitizeUrl(r.comments_url))}" target="_blank" rel="noopener noreferrer">${r.comments} Comments</a>` : ''}${r.embedded_url ? ` <span class="divider">||</span> <a class="comments-link" href="${escapeHtml(sanitizeUrl(r.embedded_url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(extractDomain(r.embedded_url))}</a>` : ''}
        <div class="meta">
          <span class="source source-${r.source}">${SOURCE_LABELS[r.source]}</span>
          <span>${formatAge(r.posted_at, now)} ago</span>
          <span>${formatCph(r, now)}/hr</span>
          <span>${formatDeviation(r)}</span>
        </div>
      </div>
    </li>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>myhotnews</title>
  <meta property="og:title" content="myhotnews">
  <meta property="og:description" content="Top posts from Hacker News and Twitter, ranked by relative engagement velocity. Updated every 90 minutes.">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="myhotnews">
  <meta name="twitter:description" content="Top posts from Hacker News and Twitter, ranked by relative engagement velocity. Updated every 90 minutes.">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔥</text></svg>">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif;
      background: #f6f6ef;
      color: #333;
      max-width: 700px;
      margin: 0 auto;
      padding: 16px;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 12px 0;
      border-bottom: 2px solid #ff6600;
      margin-bottom: 16px;
    }
    h1 { font-size: 1.3rem; font-weight: 700; color: #ff6600; letter-spacing: -0.5px; }
    .updated { font-size: 0.75rem; color: #999; }
    ol { list-style: none; }
    li {
      display: flex;
      gap: 10px;
      padding: 10px 0;
      border-bottom: 1px solid #e8e8e8;
      align-items: flex-start;
    }
    .rank { font-size: 0.8rem; color: #bbb; min-width: 18px; padding-top: 3px; text-align: right; }
    .content { flex: 1; min-width: 0; }
    a {
      color: #333;
      text-decoration: none;
      font-size: 0.92rem;
      line-height: 1.35;
      word-break: break-word;
    }
    a:hover { text-decoration: underline; }
    a:visited { color: #888; }
    .meta {
      display: flex;
      gap: 8px;
      margin-top: 4px;
      font-size: 0.72rem;
      color: #999;
      flex-wrap: wrap;
    }
    .source { font-weight: 600; }
    .source-hn { color: ${SOURCE_COLORS.hn}; }
    .source-nitter { color: ${SOURCE_COLORS.nitter}; }
    .divider { color: #ccc; font-size: 0.8rem; }
    .comments-link { font-size: 0.78rem; color: #999; }
    .tagline { font-size: 0.72rem; color: #999; margin-bottom: 16px; }
    @media (prefers-color-scheme: dark) {
      body { background: #1a1a1a; color: #ddd; }
      li { border-bottom-color: #2a2a2a; }
      a { color: #ddd; }
      a:visited { color: #777; }
    }
  </style>
</head>
<body>
  <header>
    <h1>myhotnews</h1>
    <span class="updated" data-generated-at="${generatedAt}">updated ${pageAge} ago</span>
  </header>
  <p class="tagline">top links from the past 8h &middot; ranked by relative velocity</p>
  <main>
    <ol>${rows}</ol>
  </main>
  <script>
    (function() {
      var el = document.querySelector('.updated[data-generated-at]');
      if (!el) return;
      var ts = Number(el.getAttribute('data-generated-at'));
      var STALE_MS = 3 * 3600000; // 3 hours
      function update() {
        var mins = Math.floor((Date.now() - ts) / 60000);
        var text;
        if (mins < 60) text = mins + 'm';
        else if (mins < 1440) text = Math.floor(mins / 60) + 'h';
        else text = Math.floor(mins / 1440) + 'd';
        el.textContent = 'updated ' + text + ' ago';
        if (Date.now() - ts > STALE_MS) {
          el.style.color = '#c33';
          el.title = 'Page may be stale — reload for fresh results';
        }
      }
      update();
      setInterval(update, 60000);
    })();
  </script>
</body>
</html>`;
}
