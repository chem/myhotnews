// src/config.js

export function parseCount(str) {
  if (!str) return 0;
  str = str.replace(/,/g, '').trim();
  if (/k$/i.test(str)) return Math.round(parseFloat(str) * 1000);
  if (/m$/i.test(str)) return Math.round(parseFloat(str) * 1000000);
  return parseInt(str, 10) || 0;
}
