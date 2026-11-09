'use server';
// File uploads into the live book: an agent network's daily collections CSV, and the bank statement.
// A file can be chosen or pasted. Uploading the same file twice adds nothing.
import { revalidatePath } from 'next/cache';
import { requireOps } from '@/lib/auth/viewer';
import { agentRows, bankLinesFrom, bankRowsFromCsv } from '@/lib/ingest/files';
import { ingestBank, ingestPayments } from '@/lib/ingest/ingest';

export type UploadState = { ok?: string; error?: string; problems?: { line: number; text: string }[] };

const MAX = 2 * 1024 * 1024;
async function readUpload(fd: FormData): Promise<string | { error: string }> {
  const f = fd.get('file');
  if (f && typeof f === 'object' && 'size' in f && f.size > 0) {
    if (f.size > MAX) return { error: 'The file is larger than 2 MB. Split it and upload the parts.' };
    return await f.text();
  }
  const pasted = String(fd.get('text') ?? '');
  if (pasted.trim()) return pasted.length > MAX ? { error: 'The pasted text is larger than 2 MB.' } : pasted;
  return { error: 'Choose a CSV file or paste its contents.' };
}
const plural = (n: number, w: string) => n + ' ' + w + (n === 1 ? '' : 's');

export async function uploadAgentFile(_prev: UploadState, fd: FormData): Promise<UploadState> {
  await requireOps('/console?tab=intake');
  const text = await readUpload(fd);
  if (typeof text !== 'string') return text;
  const { payloads, errors } = agentRows(text);
  if (errors.length) return { error: errors[0].error, problems: errors.map(e => ({ line: e.line, text: e.error })) };
  if (!payloads.length) return { error: 'The file has a header but no rows.' };
  if (payloads.length > 5000) return { error: 'At most 5,000 rows per file.' };
  const { results } = await ingestPayments(payloads.map(payload => ({ ch: 'CA' as const, payload })));
  const by = (s: string) => results.filter(r => r.status === s);
  revalidatePath('/', 'layout');
  return {
    ok: plural(by('accepted').length, 'new collection') + ' stored, ' + plural(by('duplicate').length, 'repeat') + ' ignored, ' + plural(by('quarantined').length, 'row') + ' quarantined.',
    problems: results.map((r, i) => ({ r, line: i + 2 })).filter(x => x.r.status !== 'accepted')
      .map(x => ({ line: x.line, text: x.r.status === 'duplicate' ? 'receipt ' + x.r.tid + ' was already received' : 'quarantined: ' + x.r.error })),
  };
}

export async function uploadBankFile(_prev: UploadState, fd: FormData): Promise<UploadState> {
  await requireOps('/console?tab=intake');
  const text = await readUpload(fd);
  if (typeof text !== 'string') return text;
  const parsed = bankRowsFromCsv(text);
  if (parsed.errors.length) return { error: parsed.errors[0].error };
  if (!parsed.rows.length) return { error: 'The file has a header but no rows.' };
  if (parsed.rows.length > 5000) return { error: 'At most 5,000 lines per file.' };
  const { lines, errors } = bankLinesFrom(parsed.rows, 'Bank statement CSV');
  const { results } = lines.length ? await ingestBank(lines) : { results: [] };
  const added = results.filter(r => !r.duplicate).length;
  revalidatePath('/', 'layout');
  return {
    ok: plural(added, 'new bank line') + ' stored, ' + plural(results.length - added, 'line') + ' already on file, ' + plural(errors.length, 'line') + ' skipped.',
    problems: errors.map(e => ({ line: e.line, text: e.error })),
  };
}
