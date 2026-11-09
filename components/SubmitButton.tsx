'use client';
import { useFormStatus } from 'react-dom';

export default function SubmitButton({ children, ghost, small = true }: { children: React.ReactNode; ghost?: boolean; small?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={'btn' + (small ? ' sm' : '') + (ghost ? ' ghost' : '')} disabled={pending}>
      {pending ? 'Posting…' : children}
    </button>
  );
}
