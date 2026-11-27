import Flash from '@/components/Flash';
import SubmitButton from '@/components/SubmitButton';
import { importWorkbook } from '../actions';
import StreamImport from '@/components/StreamImport';

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ ok?: string; bad?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1>Import from Google Sheets</h1>
      <p className="muted">Bring in data from your Google Sheets.</p>
      <Flash sp={sp} />
      <StreamImport />
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Scheduling sheet (hosts, brands, commitments, availability)</h2>
        <ol>
          <li>Open the Google Sheet and choose <strong>File &rarr; Download &rarr; Microsoft Excel (.xlsx)</strong>.</li>
          <li>Upload the file below.</li>
        </ol>
        <p className="small muted">
          This reads the Rules, Capacity, Commitment, Host_Availability, Host_Preferences and Pre_Planned_Streams tabs. Rooms, brands and hosts are matched by
          name and updated. For the month in Rules &rarr; month, sale days, commitments and pre-planned streams are replaced. Availability is replaced for every
          date in the sheet. Host logins are not created; set them up on each host&rsquo;s page afterwards. Running the import again is safe.
        </p>
        <form action={importWorkbook} className="inline" style={{ marginTop: 12 }}>
          <input type="file" name="file" accept=".xlsx" required />
          <SubmitButton className="primary" pending="Importing…">Import</SubmitButton>
        </form>
      </div>
    </>
  );
}
