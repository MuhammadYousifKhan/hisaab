// A small RFC 4180 CSV reader: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF or LF,
// a byte-order mark, and blank lines. Headers are lower-cased with spaces turned into underscores.

export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [], field = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"' && field === '') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f.trim() !== '')) rows.push(row);
  return rows;
}

export interface CsvRow { line: number; values: Record<string, string> }

/** Rows as objects keyed by header. `line` is the 1-based line number in the file, counting the header. */
export function csvRecords(text: string): { header: string[]; rows: CsvRow[] } {
  const all = parseCsv(text);
  if (!all.length) return { header: [], rows: [] };
  const header = all[0].map(h => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const rows = all.slice(1).map((r, i) => ({
    line: i + 2,
    values: Object.fromEntries(header.map((h, k) => [h, (r[k] ?? '').trim()])),
  }));
  return { header, rows };
}
