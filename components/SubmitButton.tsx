'use client';

import { useFormStatus } from 'react-dom';

/** Submit button that disables itself and shows a pending label while the form action runs. */
export default function SubmitButton({ children, pending, className }: { children: React.ReactNode; pending?: string; className?: string }) {
  const { pending: isPending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={isPending}>
      {isPending ? pending || 'Working…' : children}
    </button>
  );
}
