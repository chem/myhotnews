import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForTimelineAdvance } from '../src/fetch-nitter.js';

function createPage({ urlChanged = false, timelineChanged = false } = {}) {
  const calls = [];

  return {
    calls,
    waitForURL: async predicate => {
      calls.push('waitForURL');
      if (!urlChanged) throw new Error('no navigation');
      assert.equal(predicate({ toString: () => 'https://nitter.net/i/lists/1494481887208910870?cursor=next' }), true);
    },
    waitForFunction: async (fn, previousState) => {
      calls.push('waitForFunction');
      if (!timelineChanged) throw new Error('timeline unchanged');
      global.document = {
        querySelector(selector) {
          if (selector === '.timeline-item .tweet-date a') {
            return { getAttribute: () => '/user/status/2' };
          }
          if (selector === '.show-more a[href*="cursor="]') {
            return { getAttribute: () => '?cursor=next' };
          }
          return null;
        },
      };
      try {
        assert.equal(fn(previousState), true);
      } finally {
        delete global.document;
      }
    },
    waitForSelector: async selector => {
      calls.push(`waitForSelector:${selector}`);
      assert.equal(selector, '.timeline-item');
    },
  };
}

test('waitForTimelineAdvance: succeeds when click causes navigation', async () => {
  const page = createPage({ urlChanged: true, timelineChanged: false });
  await waitForTimelineAdvance(page, {
    pageUrl: 'https://nitter.net/i/lists/1494481887208910870',
    loadMoreHref: '?cursor=prev',
    firstTweetHref: '/user/status/1',
  });
  assert.deepEqual(page.calls, ['waitForURL', 'waitForFunction', 'waitForSelector:.timeline-item']);
});

test('waitForTimelineAdvance: succeeds when DOM changes without navigation', async () => {
  const page = createPage({ urlChanged: false, timelineChanged: true });
  await waitForTimelineAdvance(page, {
    pageUrl: 'https://nitter.net/i/lists/1494481887208910870',
    loadMoreHref: '?cursor=prev',
    firstTweetHref: '/user/status/1',
  });
  assert.deepEqual(page.calls, ['waitForURL', 'waitForFunction', 'waitForSelector:.timeline-item']);
});

test('waitForTimelineAdvance: throws when click leaves the same timeline in place', async () => {
  const page = createPage({ urlChanged: false, timelineChanged: false });
  await assert.rejects(
    waitForTimelineAdvance(page, {
      pageUrl: 'https://nitter.net/i/lists/1494481887208910870',
      loadMoreHref: '?cursor=prev',
      firstTweetHref: '/user/status/1',
    }),
    /did not advance the timeline/
  );
  assert.deepEqual(page.calls, ['waitForURL', 'waitForFunction']);
});
