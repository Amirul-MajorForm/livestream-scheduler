'use client';

/** A submit button that asks for confirmation first. `form` / `formAction` let it submit a form elsewhere on the page. */
export default function ConfirmButton({ message, children, className, form, formAction }: {
  message: string;
  children: React.ReactNode;
  className?: string;
  form?: string;
  formAction?: (f: FormData) => void | Promise<void>;
}) {
  return (
    <button type="submit" className={className} form={form} formAction={formAction} formNoValidate={!!formAction}
      onClick={e => { if (!confirm(message)) e.preventDefault(); }}>
      {children}
    </button>
  );
}
