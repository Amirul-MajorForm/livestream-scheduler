/** Explains every tag shown on a schedule version. */
export const FLAG_HELP: Record<string, string> = {
  'Pre-planned': 'A confirmed booking from the Pre-planned streams tab. It is locked in as entered, even if it breaks a rule; the tags next to it tell you which rule.',
  'Auto host': 'A pre-planned booking that was entered without a host. The scheduler picked an eligible, available host for it.',
  'Edited': 'Changed or added by hand after the scheduler ran.',
  'No host': 'Nobody is assigned. For a pre-planned booking this means no host was eligible for the brand and platform, available at that time and under their caps. Assign one with Edit.',
  'Host not marked available': 'The host did not tick this time slot in their availability. Usually a pre-planned booking or a manual edit. Check with the host.',
  'Host double-booked': 'The same host has another stream that overlaps this one. One of them needs a different host.',
  'Room clash': 'Another stream is in the same room at an overlapping time. Move one to another room.',
  'Same brand at the same time': 'The same brand has two streams overlapping. The scheduler never does this itself; it comes from pre-planned bookings or edits.',
  'No room': 'No free room the host is allowed to use was left at that time. Pick a room with Edit.',
};

export default function FlagLegend() {
  return (
    <details className="card legend">
      <summary>What do the tags mean?</summary>
      <div style={{ marginTop: 10 }}>
        <p className="small muted" style={{ marginBottom: 8 }}>
          Grey and blue tags are information. <span className="badge warn">Amber</span> and <span className="badge bad">red</span> tags are problems
          to check before publishing; they are only warnings and never block publishing.
        </p>
        <table className="compact">
          <tbody>
            <tr><td><span className="badge">Pre-planned</span></td><td>{FLAG_HELP['Pre-planned']}</td></tr>
            <tr><td><span className="badge accent">Auto host</span></td><td>{FLAG_HELP['Auto host']}</td></tr>
            <tr><td><span className="badge">Edited</span></td><td>{FLAG_HELP['Edited']}</td></tr>
            <tr><td><span className="badge bad">No host</span></td><td>{FLAG_HELP['No host']}</td></tr>
            <tr><td><span className="badge bad">No room</span></td><td>{FLAG_HELP['No room']}</td></tr>
            <tr><td><span className="badge warn">Host not marked available</span></td><td>{FLAG_HELP['Host not marked available']}</td></tr>
            <tr><td><span className="badge warn">Host double-booked</span></td><td>{FLAG_HELP['Host double-booked']}</td></tr>
            <tr><td><span className="badge warn">Room clash</span></td><td>{FLAG_HELP['Room clash']}</td></tr>
            <tr><td><span className="badge warn">Same brand at the same time</span></td><td>{FLAG_HELP['Same brand at the same time']}</td></tr>
            <tr><td><span className="badge">BAU</span> <span className="badge mega">MEGA</span></td><td>Normal day or a Mega sale day (with the sale name), from the month&rsquo;s sale days.</td></tr>
            <tr><td className="small" style={{ whiteSpace: 'nowrap' }}>TT / SP / TT+SP</td><td>On the calendar: TikTok, Shopee, or one simultaneous stream on both.</td></tr>
          </tbody>
        </table>
      </div>
    </details>
  );
}
