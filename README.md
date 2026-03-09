# myhotnews

A scheduled news aggregator that fetches top posts from Hacker News and Nitter (Twitter lists), ranks them by per-source z-score of comments-per-hour, and deploys a static HTML page to Cloudflare Pages every 90 minutes.

## How it works

1. **Fetch**: HN top 150 + newest 500 stories (~620 unique) via Firebase API; up to 250 Nitter posts via Playwright Firefox (random instance fallback)
2. **Filter**: drop posts with 0 comments, then posts older than 8 hours
3. **Rank**: per-source z-score of `comments / max(hours_old, 0.5)` -- normalizes across sources with different comment volumes
4. **Deduplicate**: remove lower-ranked posts with >=50% title keyword overlap
5. **Prune**: keep top `ceil(n/2)` per source, cap at 50
6. **Render**: self-contained HTML with dark mode, staleness indicator, HN discussion links, embedded article links for tweets

## Quick start

```bash
npm install
npx playwright install firefox --with-deps
npm test                    # 48 unit tests (no network)
npm run generate            # fetch + render dist/index.html (~2 min)
npm run test:integration    # live fetch tests (requires network + Firefox)
```

Set `DEBUG=1` to save screenshots on Nitter failures (`debug/nitter-failure-<host>.png`).

## Project structure

```
src/
  fetch-hn.js       HN Firebase API (top+new, batched, partial-failure tolerant)
  fetch-nitter.js   Playwright fetcher (multi-instance fallback, pagination)
  config.js         parseCount utility
  process.js        rank, deduplicate, prune pipeline
  render.js         HTML renderer (XSS-safe, dark mode)
  generate.js       Orchestrator
test/               48 unit tests + 2 integration tests
.github/workflows/  Cron every 90min, quiet 3-5 AM ET
```

## Deployment

### Prerequisites

- Node.js >= 18, npm
- Cloudflare account (free tier)
- GitHub repository (public recommended for unlimited Actions minutes)

### Cloudflare setup

1. **Workers & Pages -> Create -> Pages -> Direct Upload** -- name it `myhotnews`, upload a placeholder, deploy
2. Note your **Account ID** from the dashboard URL
3. **My Profile -> API Tokens -> Create Token** with **Cloudflare Pages / Edit** permission

### GitHub setup

1. Push this repo to GitHub
2. Add repository secrets: `CF_API_TOKEN` and `CF_ACCOUNT_ID`
3. **Actions -> Fetch and Deploy -> Run workflow** -- first run takes ~4 minutes

After that, the workflow runs automatically every 90 minutes (skipped 3-5 AM ET).

## Secrets

| Secret | Description |
|--------|-------------|
| `CF_API_TOKEN` | Cloudflare API token (Pages edit) |
| `CF_ACCOUNT_ID` | Cloudflare account ID |
| `DEBUG` | Optional: set to `1` for failure screenshots |

No secrets are stored in the repository. For local deploys, copy `.env.example` to `.env`.

## Maintenance

**Nitter breaks?** Instances are tried in random order. Failed instances are logged with the error. Edit `NITTER_INSTANCES` in `src/fetch-nitter.js` to add/remove instances. Check CI artifacts for `debug-screenshots`.

**Change frequency?** Edit cron in `.github/workflows/fetch.yml`. Private repos: use `0 */6 * * *` to stay under 500 min/month.

**Add a new source?** Create `src/fetch-<source>.js` returning `[{ title, url, comments, posted_at, source }]`. Add the source key to `SOURCE_PRIORITY` in `process.js` and `SOURCE_LABELS`/`SOURCE_COLORS` in `render.js`. Import in `generate.js`.

**Tune ranking?** `MAX_AGE_MS` and `BOUNDARY_GRACE_MS` in `process.js`, CPH floor (`0.5`) in `cph()`, display cap (`.slice(0, 50)`) in `generate.js`.

## Potential improvements

**Deduplication edge cases.** The current three-layer dedup (URL match → embedded URL cross-ref → bigram overlap ≥50%) handles most duplicates well. The main surviving edge case is paraphrased wire-service headlines about the same event using completely different wording (e.g., "REVOLUTIONARY GUARDS OFFICIAL SAYS IF ATTACKS ON IRANIAN ENERGY INFRASTRUCTURE DO NOT STOP..." vs. "*IRAN TO HIT REGIONAL ENERGY SITES IF ATTACKS ON INFRA CONTINUE"). Options evaluated:

- **Hybrid unigram fallback** — when bigram overlap <50% but unigram overlap is 35-49%, flag as duplicate. Doesn't help here: shared unigrams ("attacks", "energy") give only 25% overlap.
- **Named-entity + topic clustering** — extract country names and domain terms, cluster records sharing both entity and topic. Lightweight but needs a curated word list.
- **TF-IDF cosine similarity** — rare words in the feed (like "energy" among tech posts) get high weight, catching paraphrases better. Pure JS, no deps, but adds complexity.
- **Accept it (current choice)** — false negative rate is ~1 in 50 items, and both headlines convey different framing. During breaking news, similar-looking headlines are expected. Risk of increased false positives from aggressive matching outweighs the benefit.

**Other notes from dedup analysis (2026-03-08):** Reviewed 20 dedup removals in filter.log — all were correct (same story from different source, or same headline reposted). No false positives found. The bigram approach successfully prevents false dedup of stories sharing a single entity name (e.g., "Boeing 737 crash" vs. "Boeing stock drops").

## License

MIT
