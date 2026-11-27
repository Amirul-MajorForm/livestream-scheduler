'use client';

import { useEffect, useState } from 'react';

/**
 * Bulk selection for a server-rendered table. Row checkboxes are plain inputs with name="ids" and
 * form={formId}; these two components read them from that form.
 */
function boxes(formId: string) {
  const form = document.getElementById(formId) as HTMLFormElement | null;
  return form ? (Array.from(form.elements).filter(e => (e as HTMLInputElement).name === 'ids') as HTMLInputElement[]) : [];
}

function useCount(formId: string) {
  const [count, setCount] = useState({ checked: 0, total: 0 });
  useEffect(() => {
    const update = () => { const b = boxes(formId); setCount({ checked: b.filter(x => x.checked).length, total: b.length }); };
    update();
    document.addEventListener('change', update);
    document.addEventListener('bulk-select', update);
    return () => { document.removeEventListener('change', update); document.removeEventListener('bulk-select', update); };
  }, [formId]);
  return count;
}

/** Header checkbox: ticks or unticks every row. Shows a dash when only some are ticked. */
export function SelectAllBox({ formId }: { formId: string }) {
  const { checked, total } = useCount(formId);
  return (
    <input type="checkbox" aria-label="Select all rows" checked={total > 0 && checked === total}
      ref={el => { if (el) el.indeterminate = checked > 0 && checked < total; }}
      onChange={e => { const on = e.target.checked; boxes(formId).forEach(b => { b.checked = on; }); document.dispatchEvent(new Event('bulk-select')); }} />
  );
}

/** The action button; disabled until something is ticked, asks to confirm. */
export function BulkButton({ formId, label, confirmText }: { formId: string; label: string; confirmText: string }) {
  const { checked } = useCount(formId);
  return (
    <button type="submit" form={formId} className="danger" disabled={!checked}
      onClick={e => { if (!confirm(confirmText.replace('{n}', String(checked)))) e.preventDefault(); }}>
      {label} {checked ? `(${checked})` : ''}
    </button>
  );
}
