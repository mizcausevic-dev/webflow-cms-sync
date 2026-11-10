// RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF/LF, embedded newlines. No dependencies.
export function parseCsv(text, { maxRows = 10000 } = {}) {
  const rows = [];
  let row = [], field = '', i = 0, quoted = false;
  const s = String(text).replace(/^﻿/, '');
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { quoted = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      if (rows.length > maxRows + 1) throw new RangeError(`more than ${maxRows} rows`);
      row = [];
      i += ch === '\r' && s[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch; i++;
  }
  if (quoted) throw new SyntaxError('unterminated quoted field');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, j) => [h, r[j] ?? ''])));
}
