'use client';
import { useActionState } from 'react';
import { uploadAgentFile, uploadBankFile, type UploadState } from '@/app/console/intake-actions';

function Upload({ action: act, id, sample, label }: { action: (s: UploadState, fd: FormData) => Promise<UploadState>; id: string; sample: string; label: string }) {
  const [state, action, pending] = useActionState<UploadState, FormData>(act, {});
  return (
    <form action={action} className="form">
      <div className="field">
        <label htmlFor={id + '-file'}>CSV file</label>
        <input id={id + '-file'} name="file" type="file" accept=".csv,text/csv,text/plain" />
      </div>
      <div className="field">
        <label htmlFor={id + '-text'}>or paste the rows</label>
        <textarea id={id + '-text'} name="text" rows={5} spellCheck={false} placeholder={sample} />
      </div>
      {!pending && state.error && <p className="err" role="alert">{state.error}</p>}
      {!pending && state.ok && <p className="msg good" role="status">{state.ok}</p>}
      {!pending && state.problems && state.problems.length > 0 && (
        <ul className="plain problems">{state.problems.slice(0, 20).map((p, i) => <li key={i}><span className="mono">line {p.line}</span> {p.text}</li>)}{state.problems.length > 20 && <li className="muted">and {state.problems.length - 20} more</li>}</ul>
      )}
      <button type="submit" className="btn" disabled={pending}>{pending ? 'Uploading…' : label}</button>
    </form>
  );
}

export function AgentUpload({ sample }: { sample: string }) {
  return <Upload action={uploadAgentFile} id="ag" sample={sample} label="Upload collections" />;
}
export function BankUpload({ sample }: { sample: string }) {
  return <Upload action={uploadBankFile} id="bk" sample={sample} label="Upload statement" />;
}
