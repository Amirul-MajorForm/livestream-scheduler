'use client';

/** Starts the guided tour (handled by the Tour component in the sidebar). */
export default function StartTourButton({ children = 'Start the guided tour', className = 'primary' }: { children?: React.ReactNode; className?: string }) {
  return <button type="button" className={className} onClick={() => window.dispatchEvent(new Event('start-tour'))}>{children}</button>;
}
