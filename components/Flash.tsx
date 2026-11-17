export default function Flash({ sp }: { sp: { ok?: string; bad?: string } }) {
  if (sp.bad) return <div className="notice bad">{sp.bad}</div>;
  if (sp.ok) return <div className="notice ok">{sp.ok}</div>;
  return null;
}
