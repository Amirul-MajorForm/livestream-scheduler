'use client';

import { useState } from 'react';
import { parseDoc, inlineSpans } from '@/lib/planningDoc';

function Inline({ text }: { text: string }) {
  return <>{inlineSpans(text).map((s, i) => s.b ? <strong key={i}>{s.t}</strong> : s.i ? <em key={i}>{s.t}</em> : <span key={i}>{s.t}</span>)}</>;
}

/** "How the scheduler plans a month": read view with an Edit button that turns it into a text editor. */
export default function PlanningDoc({ text, custom, editedNote, action }: {
  text: string;
  custom: boolean;
  editedNote: string | null;
  action: (f: FormData) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const blocks = parseDoc(text);
  return (
    <div className="card rules-doc" id="planning-doc">
      <div className="doc-head">
        <div>
          <h2 style={{ margin: 0 }}>How the scheduler plans a month</h2>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            {custom
              ? <>Edited text{editedNote ? ', last saved ' + editedNote : ''}. Rule changes above don&rsquo;t rewrite this text; use <em>Reset</em> to regenerate it from the current settings.</>
              : <>Written from the current settings and updates itself when you change the rules. The logic comes from the original Apps Script (V7).</>}
          </p>
        </div>
        {!editing && <button type="button" onClick={() => setEditing(true)}>Edit text</button>}
      </div>

      {editing ? (
        <form action={action} style={{ marginTop: 12 }}>
          <p className="small muted" style={{ marginTop: 0 }}>
            <strong>## Heading</strong>, <strong>- bullet</strong>, <strong>**bold**</strong>, <strong>*italic*</strong>; leave a blank line between paragraphs.
            This text is the team&rsquo;s written description of the logic. Changing it doesn&rsquo;t change how the scheduler behaves: use the adjustable rules above for that, and add anything that needs building to the planner notes.
          </p>
          <textarea name="doc" className="doc-editor" defaultValue={text} autoFocus />
          <div className="row-actions" style={{ marginTop: 8 }}>
            <button type="submit" className="primary" name="op" value="save">Save text</button>
            <button type="button" onClick={() => setEditing(false)}>Cancel</button>
            {custom && <button type="submit" name="op" value="reset" className="danger"
              onClick={e => { if (!confirm('Replace your edited text with the version generated from the current settings?')) e.preventDefault(); }}>
              Reset to generated description</button>}
          </div>
        </form>
      ) : (
        <div style={{ marginTop: 10 }}>
          {blocks.map((b, i) => b.kind === 'h' ? <h3 key={i}><Inline text={b.text} /></h3>
            : b.kind === 'ul' ? <ul key={i}>{b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</ul>
            : <p key={i}><Inline text={b.text} /></p>)}
        </div>
      )}
    </div>
  );
}
