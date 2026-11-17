'use client';

/** A <select> that submits its form as soon as the value changes (used for the stream status dropdown). */
export default function AutoSubmitSelect({ name, defaultValue, options, className, label }: {
  name: string;
  defaultValue: string;
  options: { value: string; label: string }[];
  className?: string;
  label: string;
}) {
  return (
    <select name={name} defaultValue={defaultValue} className={className} aria-label={label}
      onChange={e => e.currentTarget.form?.requestSubmit()}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
