'use client';
import { useActionState } from 'react';
import { proofEdit, proofReplay, proofUnbalanced, type ProofResult } from '@/app/actions';

function Trial({ action, label, ghost }: { action: () => Promise<ProofResult>; label: string; ghost?: boolean }) {
  const [state, run, pending] = useActionState<ProofResult, FormData>(action, null);
  return (
    <form action={run} style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
      <button type="submit" className={'btn' + (ghost ? ' ghost' : '')} disabled={pending}>{pending ? 'Running…' : label}</button>
      {state && <p className={'msg ' + (state.ok ? 'good' : 'crit')} role="status">{state.msg}</p>}
    </form>
  );
}

export default function ProofButtons() {
  return (
    <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', width: '100%' }}>
      <Trial action={proofReplay} label="Replay every file" />
      <Trial action={proofUnbalanced} label="Try an unbalanced entry" ghost />
      <Trial action={proofEdit} label="Try to edit a posted entry" ghost />
    </div>
  );
}
