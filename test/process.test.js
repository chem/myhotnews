import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rank, deduplicate, prune, computeDeviation } from '../src/process.js';

const now = Date.now();
const oneHourAgo = now - 3_600_000;

function rec(overrides) {
  return { title: 'Default Title', url: 'https://example.com', comments: 10, posted_at: oneHourAgo, source: 'hn', ...overrides };
}

// --- rank ---

test('rank: sorts by comments-per-hour descending', () => {
  const records = [
    rec({ title: 'Slow', comments: 5,  posted_at: oneHourAgo }),
    rec({ title: 'Fast', comments: 20, posted_at: oneHourAgo }),
  ];
  const [first] = rank(records);
  assert.equal(first.title, 'Fast');
});

test('rank: HN beats Nitter on equal score', () => {
  const records = [
    rec({ source: 'nitter', title: 'N' }),
    rec({ source: 'hn',     title: 'H' }),
  ];
  const result = rank(records);
  assert.deepEqual(result.map(r => r.title), ['H', 'N']);
});

test('rank: floors age at 0.5h to avoid inflated scores for brand-new posts', () => {
  const justPosted = rec({ comments: 100, posted_at: now - 60_000 }); // 1 min ago
  const oneHour   = rec({ comments: 100, posted_at: oneHourAgo });
  // justPosted score = 100/0.5 = 200; oneHour score = 100/1 = 100
  const [first] = rank([oneHour, justPosted]);
  assert.equal(first, justPosted);
});

test('rank: removes records older than 8 hours', () => {
  const old   = rec({ title: 'Old',   posted_at: now - 9 * 3_600_000 });
  const fresh = rec({ title: 'Fresh', posted_at: now - 1 * 3_600_000 });
  const result = rank([old, fresh]);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Fresh');
});

test('rank: keeps records exactly at the 8-hour boundary', () => {
  const atBoundary = rec({ title: 'Boundary', posted_at: now - 8 * 3_600_000 });
  const result = rank([atBoundary]);
  assert.equal(result.length, 1);
});

test('rank: removes records with zero comments', () => {
  const noComments = rec({ title: 'Silent', comments: 0 });
  const hasComments = rec({ title: 'Active', comments: 1 });
  const result = rank([noComments, hasComments]);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Active');
});

// --- deduplicate ---

test('deduplicate: removes lower-ranked record when title overlap >= 50%', () => {
  const records = rank([
    rec({ title: 'Iran nuclear deal collapse sanctions',        source: 'hn',     comments: 20, url: 'https://example.com/a' }),
    rec({ title: 'Iran nuclear deal collapse sanctions latest', source: 'nitter', comments: 5,  url: 'https://example.com/b' }),
  ]);
  const result = deduplicate(records);
  assert.equal(result.length, 1);
  assert.equal(result[0].source, 'hn');
});

test('deduplicate: keeps records with less than 50% keyword overlap', () => {
  const records = rank([
    rec({ title: 'Iran nuclear deal', source: 'hn', url: 'https://example.com/a' }),
    rec({ title: 'Stock market crashes today morning', source: 'nitter', url: 'https://example.com/b' }),
  ]);
  assert.equal(deduplicate(records).length, 2);
});

test('deduplicate: removes duplicate when URLs match despite different titles', () => {
  const records = rank([
    rec({ title: 'OpenAI closes massive funding round',   source: 'hn', comments: 20, url: 'https://example.com/openai-deal' }),
    rec({ title: 'Wow this OpenAI news is unbelievable',  source: 'nitter', comments: 5, url: 'https://example.com/openai-deal' }),
  ]);
  const result = deduplicate(records);
  assert.equal(result.length, 1);
  assert.equal(result[0].source, 'hn');
});

test('deduplicate: removes duplicate when embedded_url matches another record url', () => {
  const records = rank([
    rec({ title: 'OpenAI closes massive funding round',     source: 'hn', comments: 20, url: 'https://example.com/openai-deal' }),
    rec({ title: 'Check out this article about tech deals', source: 'nitter', comments: 5, url: 'https://nitter.net/user/status/123', embedded_url: 'https://example.com/openai-deal' }),
  ]);
  const result = deduplicate(records);
  assert.equal(result.length, 1);
  assert.equal(result[0].source, 'hn');
});

test('deduplicate: URL normalization ignores trailing slash and query params', () => {
  const records = rank([
    rec({ title: 'Article about something',       source: 'hn', comments: 20, url: 'https://example.com/article/' }),
    rec({ title: 'Totally different commentary',   source: 'nitter', comments: 5, url: 'https://example.com/article?utm_source=twitter' }),
  ]);
  const result = deduplicate(records);
  assert.equal(result.length, 1);
});

test('deduplicate: bigrams reduce false positives from shared entity names', () => {
  // "Boeing 737" shares the word "boeing" but the bigrams are different
  const records = rank([
    rec({ title: 'Boeing 737 crash investigation update report', source: 'hn', comments: 20, url: 'https://example.com/a' }),
    rec({ title: 'Boeing stock drops after quarterly earnings', source: 'nitter', comments: 5, url: 'https://example.com/b' }),
  ]);
  // Different stories — should both survive
  assert.equal(deduplicate(records).length, 2);
});

test('deduplicate: stop words do not count as keywords', () => {
  // Titles share only stop words — should not be considered duplicates
  const records = rank([
    rec({ title: 'the in and or but for', source: 'hn', url: 'https://example.com/a' }),
    rec({ title: 'the in and or but for', source: 'nitter', url: 'https://example.com/b' }),
  ]);
  // Both tokenize to empty sets — overlap(empty, empty) = 0, not a duplicate
  assert.equal(deduplicate(records).length, 2);
});

// --- prune ---

test('prune: keeps top 50% (ceil) from each source', () => {
  // 4 HN records, 4 Nitter records — expect 2 each kept
  const hnRecs     = [0,1,2,3].map(i => rec({ source: 'hn',     title: `HN${i}`,     comments: 40 - i }));
  const nitterRecs = [0,1,2,3].map(i => rec({ source: 'nitter', title: `Nitter${i}`, comments: 20 - i }));
  const ranked = rank([...hnRecs, ...nitterRecs]);
  const result = prune(ranked);
  assert.equal(result.filter(r => r.source === 'hn').length, 2);
  assert.equal(result.filter(r => r.source === 'nitter').length, 2);
});

test('prune: odd-count groups round up (keep more)', () => {
  // 3 Nitter records — ceil(3/2) = 2 kept
  const records = [0,1,2].map(i => rec({ source: 'nitter', title: `N${i}`, comments: 10 - i }));
  const result = prune(rank(records));
  assert.equal(result.filter(r => r.source === 'nitter').length, 2);
});

test('prune: result is sorted by deviation descending', () => {
  const records = rank([
    rec({ source: 'nitter', comments: 30, title: 'Nitter-hot' }),
    rec({ source: 'hn',     comments: 5,  title: 'HN-cold'   }),
  ]);
  const result = prune(records);
  // Each is sole record in its source => deviation=1, tiebreak: HN > Nitter
  assert.equal(result[0].title, 'HN-cold');
});

// --- computeDeviation ---

test('computeDeviation: computes z-score from source CPH stats', () => {
  // All same source, all 1h old. CPH = comments value.
  // comments: [10, 20, 30] => mean=20, stddev=~8.165
  // deviations: (10-20)/8.165 = -1.22, (20-20)/8.165 = 0, (30-20)/8.165 = 1.22
  const records = [
    rec({ source: 'hn', title: 'A', comments: 10 }),
    rec({ source: 'hn', title: 'B', comments: 20 }),
    rec({ source: 'hn', title: 'C', comments: 30 }),
  ];
  const result = computeDeviation(records);
  const devs = result.map(r => r.commentsDeviation);
  // C should have highest deviation, A lowest
  assert.ok(devs[2] > devs[1]);
  assert.ok(devs[1] > devs[0]);
  // Middle record should be ~0
  assert.ok(Math.abs(devs[1]) < 0.01);
});

test('computeDeviation: assigns 1 when stddev is 0 (single record)', () => {
  const records = [rec({ source: 'hn', title: 'Only', comments: 50 })];
  const result = computeDeviation(records);
  assert.equal(result[0].commentsDeviation, 1);
});

test('computeDeviation: assigns 1 when all records have identical CPH', () => {
  const records = [
    rec({ source: 'nitter', title: 'X', comments: 10 }),
    rec({ source: 'nitter', title: 'Y', comments: 10 }),
  ];
  const result = computeDeviation(records);
  assert.equal(result[0].commentsDeviation, 1);
  assert.equal(result[1].commentsDeviation, 1);
});

test('rank: 0-comment records do not distort z-scores of surviving records', () => {
  // Without the fix, 50 zero-comment records would drag mean CPH down,
  // inflating the z-score of the one real record.
  const zeroComments = Array.from({ length: 50 }, (_, i) =>
    rec({ source: 'hn', title: `Zero${i}`, comments: 0, posted_at: oneHourAgo })
  );
  const real = rec({ source: 'hn', title: 'Real', comments: 10, posted_at: oneHourAgo });

  const withZeros = rank([...zeroComments, real], now);
  assert.equal(withZeros.length, 1);
  // Single surviving record in its source => stddev=0 => deviation defaults to 1
  assert.equal(withZeros[0].commentsDeviation, 1);
});

test('rank: returns empty array when all records have 0 comments', () => {
  const records = [
    rec({ title: 'A', comments: 0 }),
    rec({ title: 'B', comments: 0 }),
  ];
  const result = rank(records, now);
  assert.equal(result.length, 0);
});

test('rank: filters both old and 0-comment records correctly', () => {
  const records = [
    rec({ title: 'Old',       comments: 10, posted_at: now - 9 * 3_600_000 }),
    rec({ title: 'Silent',    comments: 0,  posted_at: oneHourAgo }),
    rec({ title: 'Good',      comments: 5,  posted_at: oneHourAgo }),
  ];
  const result = rank(records, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Good');
});

test('computeDeviation: handles empty input without error', () => {
  const result = computeDeviation([], now);
  assert.deepEqual(result, []);
});

test('computeDeviation: computes independently per source', () => {
  // HN: comments [10, 30] => mean=20, stddev=10 => devs: -1, +1
  // Nitter: comments [100, 300] => mean=200, stddev=100 => devs: -1, +1
  // Despite nitter having 10x the raw CPH, deviations are equal
  const records = [
    rec({ source: 'hn',     title: 'HN-low',  comments: 10 }),
    rec({ source: 'hn',     title: 'HN-high', comments: 30 }),
    rec({ source: 'nitter', title: 'N-low',   comments: 100 }),
    rec({ source: 'nitter', title: 'N-high',  comments: 300 }),
  ];
  const result = computeDeviation(records);
  const hnHigh = result.find(r => r.title === 'HN-high');
  const nHigh  = result.find(r => r.title === 'N-high');
  // Both should have deviation of +1.0
  assert.ok(Math.abs(hnHigh.commentsDeviation - nHigh.commentsDeviation) < 0.01);
});
