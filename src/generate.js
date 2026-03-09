// src/generate.js
import { mkdir, writeFile } from 'node:fs/promises';
import { fetchHN } from './fetch-hn.js';
import { fetchNitter } from './fetch-nitter.js';
import { rank, deduplicate, prune, cph } from './process.js';
import { renderHTML } from './render.js';

async function withRetry(fn, label, retries = 1, delayMs = 5_000) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < retries) {
        console.warn(`  ${label}: attempt ${attempt + 1} failed (${err.message}), retrying in ${delayMs / 1000}s...`);
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        throw err;
      }
    }
  }
}

function unwrap(result, label, expectedCount = 150) {
  if (result.status !== 'fulfilled') {
    console.warn(`  ${label}: FAILED - ${result.reason?.message ?? result.reason}`);
    return [];
  }

  const records = result.value;
  console.log(`  ${label}: ${records.length} records`);

  if (records.length === 0) {
    console.warn(`  ${label}: returned 0 records. Partial-source success is allowed, but this run is degraded.`);
  } else if (records.length < expectedCount) {
    console.warn(`  ${label}: returned fewer than expected (${records.length}/${expectedCount}).`);
  }

  return records;
}

async function generate() {
  const generatedAt = Date.now();
  console.log('Fetching sources...');

  const [hnResult, nitterResult] = await Promise.allSettled([
    fetchHN(),
    withRetry(fetchNitter, 'Nitter'),
  ]);

  const records = [
    ...unwrap(hnResult, 'HN', 400),
    ...unwrap(nitterResult, 'Nitter', 250),
  ];

  console.log(`Total fetched: ${records.length}`);

  const ranked  = rank(records, generatedAt);
  const deduped = deduplicate(ranked);
  const prunedAll = prune(deduped);
  const pruned  = prunedAll.slice(0, 50);

  console.log(`After processing: ${pruned.length} records`);

  // Build filter log
  const oneLine = s => s.replace(/[\r\n]+/g, ' ').slice(0, 100);
  function fmtRecord(r) {
    const ageH = ((generatedAt - r.posted_at) / 3_600_000).toFixed(1);
    const cphVal = cph(r, generatedAt).toFixed(1);
    const sigma = r.commentsDeviation != null ? (r.commentsDeviation >= 0 ? '+' : '') + r.commentsDeviation.toFixed(1) + '\u03c3' : 'n/a';
    return `${r.source}  ${ageH}h  ${cphVal}/hr  ${sigma}  ${r.url}  ${oneLine(r.title)}`;
  }
  const filtered = [];
  const cutoff = generatedAt - 8 * 3_600_000 - 1_000; // match rank()'s BOUNDARY_GRACE_MS
  const rankedSet = new Set(ranked);
  for (const r of records) {
    if (!rankedSet.has(r)) {
      const reason = r.posted_at < cutoff ? '[age>8h]' : '[0 comments]';
      filtered.push(`${reason}  ${fmtRecord(r)}`);
    }
  }
  const dedupedSet = new Set(deduped);
  for (const r of ranked) {
    if (!dedupedSet.has(r)) {
      filtered.push(`[duplicate]  ${fmtRecord(r)}`);
    }
  }
  const prunedSet = new Set(prunedAll);
  for (const r of deduped) {
    if (!prunedSet.has(r)) {
      filtered.push(`[pruned]  ${fmtRecord(r)}`);
    }
  }
  const finalSet = new Set(pruned);
  for (const r of prunedAll) {
    if (!finalSet.has(r)) {
      filtered.push(`[cap>50]  ${fmtRecord(r)}`);
    }
  }

  const logLines = [
    `Filter log — ${new Date(generatedAt).toISOString()}`,
    `Fetched: ${records.length}  Ranked: ${ranked.length}  Deduped: ${deduped.length}  Pruned: ${prunedAll.length}  Final: ${pruned.length}`,
    `Filtered out: ${filtered.length}`,
    '',
    ...filtered,
    '',
  ];
  const logText = logLines.join('\n');
  console.log('\n' + logText);
  await writeFile('filter.log', logText, 'utf8');
  console.log('Written: filter.log');

  if (pruned.length === 0) {
    console.error('No records survived processing — aborting deploy to avoid empty page.');
    process.exit(1);
  }

  // Rewrite nitter instance URLs to x.com for the rendered page
  let rewriteCount = 0;
  for (const r of pruned) {
    if (r.source === 'nitter' && r.url) {
      try {
        const u = new URL(r.url);
        u.hostname = 'x.com';
        u.hash = '';
        r.url = u.toString();
        rewriteCount++;
      } catch { /* leave malformed URLs as-is */ }
    }
  }
  if (rewriteCount > 0) {
    console.log(`Rewrote ${rewriteCount} nitter URL(s) to x.com for display`);
  }

  await mkdir('dist', { recursive: true });
  await writeFile('dist/index.html', renderHTML(pruned, generatedAt, generatedAt), 'utf8');
  console.log('Written: dist/index.html');
}

generate().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
