import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHTML } from '../src/render.js';

const baseRecord = {
  title: 'Test Article',
  url: 'https://example.com/article',
  comments: 60,
  posted_at: Date.now() - 3_600_000, // 1 hour ago
  source: 'hn',
};

test('renderHTML: includes title text', () => {
  const html = renderHTML([baseRecord], Date.now());
  assert.ok(html.includes('Test Article'));
});

test('renderHTML: title is a link to the URL', () => {
  const html = renderHTML([baseRecord], Date.now());
  assert.ok(html.includes('href="https://example.com/article"'));
});

test('renderHTML: shows comments per hour with /hr label', () => {
  // 60 comments / 1 hour = 60
  const html = renderHTML([baseRecord], Date.now());
  assert.ok(html.includes('60/hr'));
});

test('renderHTML: shows source label', () => {
  const html = renderHTML([baseRecord], Date.now());
  assert.ok(html.includes('HN'));
});

test('renderHTML: uses source CSS classes instead of inline color styles', () => {
  const html = renderHTML([baseRecord], Date.now());
  assert.ok(html.includes('class="source source-hn"'));
  assert.ok(!html.includes('style="color:'));
});

test('renderHTML: escapes HTML special chars in title', () => {
  const r = { ...baseRecord, title: '<script>alert("xss")</script>' };
  const html = renderHTML([r], Date.now());
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('renderHTML: escapes HTML special chars in URL', () => {
  const r = { ...baseRecord, url: 'https://example.com/?a=1&b=2' };
  const html = renderHTML([r], Date.now());
  assert.ok(html.includes('href="https://example.com/?a=1&amp;b=2"'));
});

test('renderHTML: shows age in minutes for recent posts', () => {
  const r = { ...baseRecord, posted_at: Date.now() - 5 * 60_000 }; // 5 min ago
  const html = renderHTML([r], Date.now());
  assert.ok(html.includes('5m'));
});

test('renderHTML: shows age in hours for older posts', () => {
  const r = { ...baseRecord, posted_at: Date.now() - 3 * 3_600_000 }; // 3h ago
  const html = renderHTML([r], Date.now());
  assert.ok(html.includes('3h'));
});

test('renderHTML: produces valid HTML5 structure', () => {
  const html = renderHTML([baseRecord], Date.now());
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('<html'));
  assert.ok(html.includes('</html>'));
});

test('renderHTML: strips javascript: URL to # to prevent XSS', () => {
  const r = { ...baseRecord, url: 'javascript:alert(1)' };
  const html = renderHTML([r], Date.now());
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('href="#"'));
});

test('renderHTML: shows comments link with divider when comments_url is present', () => {
  const r = { ...baseRecord, comments: 88, comments_url: 'https://news.ycombinator.com/item?id=123' };
  const html = renderHTML([r], Date.now());
  assert.ok(html.includes('||'));
  assert.ok(html.includes('href="https://news.ycombinator.com/item?id=123"'));
  assert.ok(html.includes('88 Comments'));
});

test('renderHTML: does not show divider or comments link when comments_url is absent', () => {
  const r = { ...baseRecord, source: 'nitter' };
  const html = renderHTML([r], Date.now());
  assert.ok(!html.includes('class="divider"'));
  assert.ok(!html.includes('Comments</a>'));
});

test('renderHTML: includes live-update script with data-generated-at', () => {
  const now = Date.now();
  const html = renderHTML([baseRecord], now);
  assert.ok(html.includes(`data-generated-at="${now}"`));
  assert.ok(html.includes('setInterval'));
});

test('renderHTML: shows commentsDeviation with sigma symbol', () => {
  const r = { ...baseRecord, commentsDeviation: 2.13 };
  const html = renderHTML([r], Date.now());
  assert.ok(html.includes('+2.1\u03c3'));
});

test('renderHTML: shows negative deviation without plus sign', () => {
  const r = { ...baseRecord, commentsDeviation: -0.5 };
  const html = renderHTML([r], Date.now());
  assert.ok(html.includes('\u22120.5\u03c3'));
});

test('renderHTML: shows embedded_url with divider and domain label', () => {
  const r = { ...baseRecord, source: 'nitter', embedded_url: 'https://www.forbes.com/sites/article/123' };
  const html = renderHTML([r], Date.now());
  assert.ok(html.includes('||'));
  assert.ok(html.includes('href="https://www.forbes.com/sites/article/123"'));
  assert.ok(html.includes('forbes.com'));
});

test('renderHTML: does not show embedded link when embedded_url is absent', () => {
  const r = { ...baseRecord, source: 'nitter' };
  const html = renderHTML([r], Date.now());
  assert.ok(!html.includes('forbes.com'));
});

test('renderHTML: strips www. from embedded_url domain label', () => {
  const r = { ...baseRecord, source: 'nitter', embedded_url: 'https://www.reuters.com/article/xyz' };
  const html = renderHTML([r], Date.now());
  assert.ok(html.includes('>reuters.com<'));
});

test('renderHTML: sanitizes embedded_url with javascript: scheme', () => {
  const r = { ...baseRecord, source: 'nitter', embedded_url: 'javascript:alert(1)' };
  const html = renderHTML([r], Date.now());
  assert.ok(!html.includes('javascript:'));
});

test('renderHTML: renders valid page with empty records array', () => {
  const html = renderHTML([], Date.now());
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('</html>'));
});
