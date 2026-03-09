// src/fetch-hn.js

const TOP_STORIES_URL = 'https://hacker-news.firebaseio.com/v0/topstories.json';
const NEW_STORIES_URL = 'https://hacker-news.firebaseio.com/v0/newstories.json';
const ITEM_URL = id => `https://hacker-news.firebaseio.com/v0/item/${id}.json`;

const TOP_COUNT = 150;

async function fetchIds(url, limit) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HN ${url} failed: ${resp.status}`);
  const ids = await resp.json();
  return limit ? ids.slice(0, limit) : ids;
}

const BATCH_SIZE = 50;

async function fetchItems(ids) {
  const results = [];
  let failures = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(id =>
        fetch(ITEM_URL(id)).then(r => {
          if (!r.ok) throw new Error(`HN item ${id} failed: ${r.status}`);
          return r.json();
        })
      )
    );
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        failures++;
      }
    }
  }
  if (failures > 0) {
    console.warn(`  HN: ${failures}/${ids.length} item fetches failed`);
  }
  return results;
}

export async function fetchHN() {
  // Fetch top 150 + all 500 new, deduplicate by ID
  const [topIds, newIds] = await Promise.all([
    fetchIds(TOP_STORIES_URL, TOP_COUNT),
    fetchIds(NEW_STORIES_URL),
  ]);

  const seen = new Set();
  const uniqueIds = [];
  for (const id of [...topIds, ...newIds]) {
    if (!seen.has(id)) {
      seen.add(id);
      uniqueIds.push(id);
    }
  }

  console.log(`  HN: ${topIds.length} top + ${newIds.length} new = ${uniqueIds.length} unique IDs`);

  const items = await fetchItems(uniqueIds);

  return items
    .filter(item => item && item.title)
    .map(item => ({
      title: item.title,
      url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
      comments_url: `https://news.ycombinator.com/item?id=${item.id}`,
      comments: item.descendants ?? 0,
      posted_at: item.time * 1000,
      source: 'hn',
    }));
}
