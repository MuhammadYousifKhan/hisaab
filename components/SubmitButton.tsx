'use client';
import { useFormStatus } from 'react-dom';

/** A submit button that shows progress. With name and value, a form can offer several decisions in one place. */
export default function SubmitButton({ children, ghost, small = true, name, value }: { children: React.ReactNode; ghost?: boolean; small?: boolean; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} className={'btn' + (small ? ' sm' : '') + (ghost ? ' ghost' : '')} disabled={pending}>
      {pending ? 'Posting…' : children}
    </button>
  );
}
