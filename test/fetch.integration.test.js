// Integration tests — require network access and Playwright Firefox.
// Run separately: npm run test:integration

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchHN } from '../src/fetch-hn.js';
import { fetchNitter } from '../src/fetch-nitter.js';

test('fetchHN: returns 400+ records from top+new, deduped by ID', async () => {
  const records = await fetchHN();
  assert.ok(records.length >= 400, `Expected >=400 HN records, got ${records.length}`);
  assert.ok(records.length <= 650, `Expected <=650 HN records, got ${records.length}`);

  // Verify no duplicate comments_urls (which contain the HN item ID)
  const commentUrls = records.map(r => r.comments_url);
  assert.equal(commentUrls.length, new Set(commentUrls).size, 'HN records contain duplicates');

  for (const r of records) {
    assert.equal(r.source, 'hn');
    assert.equal(typeof r.title, 'string');
    assert.ok(r.title.length > 0);
    assert.equal(typeof r.url, 'string');
    assert.ok(r.url.startsWith('http'));
    assert.equal(typeof r.comments, 'number');
    assert.equal(typeof r.posted_at, 'number');
    assert.ok(r.posted_at > 0);
    assert.equal(typeof r.comments_url, 'string');
  }
});

test('fetchNitter: returns 200+ records via pagination with required fields', async () => {
  const records = await fetchNitter();
  assert.ok(records.length >= 200, `Expected >=200 Nitter records, got ${records.length}`);
  assert.ok(records.length <= 250, `Expected <=250 Nitter records, got ${records.length}`);

  // Verify no duplicate URLs
  const urls = records.filter(r => r.url).map(r => r.url);
  assert.equal(urls.length, new Set(urls).size, 'Nitter records contain duplicate URLs');

  for (const r of records) {
    assert.equal(r.source, 'nitter');
    assert.equal(typeof r.title, 'string');
    assert.ok(r.title.length > 0);
    assert.equal(typeof r.url, 'string');
    assert.equal(typeof r.comments, 'number');
    assert.equal(typeof r.posted_at, 'number');
    assert.ok(r.posted_at > 0);
  }
});
