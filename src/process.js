// src/process.js

const SOURCE_PRIORITY = { hn: 2, nitter: 1 };

const STOP_WORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'by','from','is','was','are','were','be','been','have','has','had','do',
  'does','did','will','would','could','should','may','might','that','this',
  'it','its','as','not','no','so','if','than','then','about','into',
  'through','after','over','up','out','says','say','said',
]);

function comparator(a, b) {
  const diff = b.commentsDeviation - a.commentsDeviation;
  if (Math.abs(diff) > 0.001) return diff;
  return SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source];
}

const MAX_AGE_MS = 8 * 3_600_000; // 8 hours
const BOUNDARY_GRACE_MS = 1_000;   // 1 s grace — prevents flaky age filtering when
                                    // test clocks or CI runners lag by sub-second amounts

export function cph(record, now = Date.now()) {
  const hoursAgo = (now - record.posted_at) / 3_600_000;
  return record.comments / Math.max(hoursAgo, 0.5);
}

export function computeDeviation(records, now = Date.now()) {
  const groups = {};
  for (const r of records) {
    (groups[r.source] ??= []).push(r);
  }

  for (const group of Object.values(groups)) {
    const cphs = group.map(r => cph(r, now));
    const mean = cphs.reduce((a, b) => a + b, 0) / cphs.length;
    const variance = cphs.reduce((a, v) => a + (v - mean) ** 2, 0) / cphs.length;
    const stddev = Math.sqrt(variance);

    // When stddev is 0 (single record or all identical CPH), default to 1 so
    // every source gets at least one entry ranked above the mean (0).
    for (let i = 0; i < group.length; i++) {
      group[i].commentsDeviation = stddev === 0 ? 1 : (cphs[i] - mean) / stddev;
    }
  }

  return records;
}

export function rank(records, now = Date.now()) {
  // Filter out 0-comment records before any calculations so they don't
  // drag down per-source mean CPH and inflate z-scores of real records.
  const withComments = records.filter(r => r.comments >= 1);
  computeDeviation(withComments, now);
  const cutoff = now - MAX_AGE_MS - BOUNDARY_GRACE_MS;
  return withComments.filter(r => r.posted_at >= cutoff).sort(comparator);
}

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function bigrams(words) {
  const set = new Set();
  for (let i = 0; i < words.length - 1; i++) {
    set.add(`${words[i]} ${words[i + 1]}`);
  }
  return set;
}

// Overlap uses min(|A|,|B|) as denominator (not union) so that a short tweet
// matching half its tokens against a long article title still counts as a duplicate.
function overlap(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  const shared = [...setA].filter(w => setB.has(w)).length;
  return shared / Math.min(setA.size, setB.size);
}

// Normalize URL for dedup: strip query params (except essential ones),
// trailing slashes, and fragments.
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    // Strip tracking params but keep the path
    u.search = '';
    // Strip trailing slash from path (but keep root /)
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch { return url; }
}

// Returns all URLs associated with a record (its primary url + embedded_url).
function recordUrls(record) {
  const urls = [];
  if (record.url) urls.push(normalizeUrl(record.url));
  if (record.embedded_url) urls.push(normalizeUrl(record.embedded_url));
  return urls;
}

export function deduplicate(rankedRecords) {
  const kept = [];
  const keptUrls = new Set();
  const keptUnigrams = [];
  const keptBigrams = [];

  for (const record of rankedRecords) {
    // A: URL-based dedup — if any URL matches a kept record's URL, it's a duplicate.
    // B: Cross-source embedded URL — a tweet's embedded_url matching an HN post's url.
    const urls = recordUrls(record);
    if (urls.some(u => keptUrls.has(u))) continue;

    // C: Bigram overlap (stronger signal than unigrams for reducing false positives).
    // Fall back to unigram overlap when either record has <2 bigrams.
    const words = tokenize(record.title);
    const uni = new Set(words);
    const bi = bigrams(words);

    const isDuplicate = keptBigrams.some((kb, i) => {
      if (bi.size >= 2 && kb.size >= 2) {
        return overlap(kb, bi) >= 0.5;
      }
      return overlap(keptUnigrams[i], uni) >= 0.5;
    });

    if (!isDuplicate) {
      kept.push(record);
      for (const u of urls) keptUrls.add(u);
      keptUnigrams.push(uni);
      keptBigrams.push(bi);
    }
  }
  return kept;
}

export function prune(dedupedRecords) {
  const sources = [...new Set(dedupedRecords.map(r => r.source))];
  const result = [];
  for (const source of sources) {
    const group = dedupedRecords.filter(r => r.source === source);
    const keepCount = Math.ceil(group.length / 2);
    result.push(...group.slice(0, keepCount));
  }
  return result.sort(comparator);
}
