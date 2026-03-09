// src/fetch-nitter.js
import { mkdir } from 'node:fs/promises';
import { firefox } from 'playwright';
import { parseCount } from './config.js';

const NITTER_INSTANCES = [
  'nitter.net',
  'nitter.privacyredirect.com',
  'nitter.tiekoetter.com',
  'nitter.catsarch.com',
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const LIST_PATH = '/i/lists/1494481887208910870';
const DEBUG = process.env.DEBUG === '1';
const MAX_PAGES = 5; // safety cap on pagination

function scrapePage(maxCount) {
  const items = document.querySelectorAll('.timeline-item');
  const results = [];

  for (const item of items) {
    if (results.length >= maxCount) break;

    // Skip non-tweet items (e.g. "show more" dividers)
    const contentEl = item.querySelector('.tweet-content');
    if (!contentEl) continue;

    const text = contentEl.innerText.trim();
    if (!text) continue;

    // Tweet permalink
    const dateLink = item.querySelector('.tweet-date a');
    const linkUrl = dateLink ? dateLink.href : '';

    // Absolute timestamp — Nitter puts it in the title attribute of the date link
    // e.g. title="Mar 7, 2026 · 7:55 PM UTC"
    const datetimeTitle = dateLink ? dateLink.getAttribute('title') : '';

    // Reply count — first stat's icon-container holds text node directly
    const replyContainer = item.querySelector('.tweet-stat:first-child .icon-container');
    const replyText = replyContainer ? replyContainer.textContent.trim() : '0';

    // First external link in tweet body (not nitter-internal profile/search links)
    const anchors = contentEl.querySelectorAll('a');
    let embeddedUrl = '';
    for (const a of anchors) {
      try {
        const h = new URL(a.href);
        if (h.hostname !== location.hostname && !h.pathname.startsWith('/search')) {
          embeddedUrl = a.href;
          break;
        }
      } catch { /* skip malformed URLs */ }
    }

    results.push({ text, linkUrl, datetimeTitle, replyText, embeddedUrl });
  }

  return results;
}

function parseNitterTime(datetimeTitle) {
  if (!datetimeTitle) return null;
  const ts = Date.parse(datetimeTitle.replace(' · ', ' '));
  if (Number.isNaN(ts)) {
    console.warn(`Nitter: unparseable datetime "${datetimeTitle}", dropping record`);
    return null;
  }
  return ts;
}

function toRecords(posts) {
  const records = [];
  for (const p of posts) {
    const posted_at = parseNitterTime(p.datetimeTitle);
    if (posted_at === null) continue; // no trustworthy timestamp — skip
    records.push({
      title: p.text.slice(0, 280),
      url: p.linkUrl,
      embedded_url: p.embeddedUrl || undefined,
      comments: parseCount(p.replyText),
      posted_at,
      source: 'nitter',
    });
  }
  return records;
}

async function snapshotTimeline(page) {
  const loadMore = page.locator('.show-more a[href*="cursor="]').first();
  const firstTweetLink = page.locator('.timeline-item .tweet-date a').first();

  const [loadMoreCount, firstTweetCount] = await Promise.all([
    loadMore.count(),
    firstTweetLink.count(),
  ]);

  return {
    pageUrl: page.url(),
    loadMoreHref: loadMoreCount > 0 ? await loadMore.getAttribute('href') : null,
    firstTweetHref: firstTweetCount > 0 ? await firstTweetLink.getAttribute('href') : null,
  };
}

export async function waitForTimelineAdvance(page, previousState, timeout = 15_000) {
  try {
    await Promise.any([
      page.waitForURL(url => url.toString() !== previousState.pageUrl, { timeout }),
      page.waitForFunction(
        prev => {
          const firstTweetHref = document.querySelector('.timeline-item .tweet-date a')?.getAttribute('href') ?? null;
          const loadMoreHref = document.querySelector('.show-more a[href*="cursor="]')?.getAttribute('href') ?? null;
          return firstTweetHref !== prev.firstTweetHref || loadMoreHref !== prev.loadMoreHref;
        },
        previousState,
        { timeout }
      ),
    ]);
  } catch {
    throw new Error('pagination click did not advance the timeline');
  }

  await page.waitForSelector('.timeline-item', { timeout });
}

async function tryInstance(page, host, count) {
  const url = `https://${host}${LIST_PATH}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('.timeline-item', { timeout: 15_000 });

  const allPosts = [];
  const seenUrls = new Set();

  for (let pageNum = 0; pageNum < MAX_PAGES; pageNum++) {
    const posts = await page.evaluate(scrapePage, count);
    let dupes = 0;

    for (const p of posts) {
      if (p.linkUrl && seenUrls.has(p.linkUrl)) { dupes++; continue; }
      if (p.linkUrl) seenUrls.add(p.linkUrl);
      allPosts.push(p);
    }

    console.log(`  Nitter: page ${pageNum + 1}: ${posts.length} scraped, ${dupes} cross-page dupes, ${allPosts.length} total`);

    if (allPosts.length >= count) break;

    const loadMore = page.locator('.show-more a[href*="cursor="]');
    if (await loadMore.count() === 0) {
      console.log(`  Nitter: no "Load more" button on page ${pageNum + 1} — pagination ended`);
      break;
    }

    const previousState = await snapshotTimeline(page);
    await Promise.all([
      loadMore.click(),
      waitForTimelineAdvance(page, previousState),
    ]);
  }

  if (allPosts.length >= MAX_PAGES * 20 && allPosts.length < count) {
    console.warn(`  Nitter: hit MAX_PAGES (${MAX_PAGES}) with only ${allPosts.length}/${count} posts`);
  }

  const sliced = allPosts.slice(0, count);
  const records = toRecords(sliced);
  if (records.length < sliced.length) {
    console.warn(`  Nitter: ${sliced.length - records.length} posts dropped (bad/missing timestamps)`);
  }

  return records;
}

export async function fetchNitter(count = 250) {
  const browser = await firefox.launch();
  const page = await browser.newPage();
  const instances = shuffle(NITTER_INSTANCES);
  console.log(`  Nitter: trying instances in order: ${instances.join(', ')}`);

  try {
    for (const host of instances) {
      try {
        const records = await tryInstance(page, host, count);
        console.log(`  Nitter: ${host} succeeded (${records.length} records)`);
        return records;
      } catch (err) {
        console.warn(`  Nitter: ${host} failed (${err.message})`);
        if (DEBUG) {
          try {
            await mkdir('debug', { recursive: true });
            const filename = `debug/nitter-failure-${host}.png`;
            await page.screenshot({ path: filename, fullPage: true });
            console.error(`  Nitter: debug screenshot saved to ${filename}`);
          } catch (screenshotErr) {
            console.error(`  Nitter: failed to save debug screenshot for ${host}:`, screenshotErr.message);
          }
        }
      }
    }

    throw new Error(`All Nitter instances failed: ${NITTER_INSTANCES.join(', ')}`);
  } finally {
    await browser.close();
  }
}
