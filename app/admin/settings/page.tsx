import { query } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import Flash from '@/components/Flash';
import ConfirmButton from '@/components/ConfirmButton';
import { addBrand, renameBrand, deleteBrand, addRoom, updateRoom, deleteRoom, addAdmin, deleteAdmin } from '../actions';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; bad?: string }> }) {
  const sp = await searchParams;
  const me = await requireAdmin();
  const [brands, rooms, admins] = await Promise.all([
    query('SELECT * FROM brands ORDER BY sort_order, name'),
    query('SELECT * FROM rooms ORDER BY sort_order, id'),
    query("SELECT id, email, name FROM users WHERE role = 'admin' ORDER BY email"),
  ]);
  return (
    <>
      <h1>Brands, rooms &amp; team</h1>
      <Flash sp={sp} />
      <div className="grid2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Rooms</h2>
          <p className="small muted">
            The order is the scheduler&rsquo;s room preference. &ldquo;Last resort&rdquo; rooms are used only when others are full; &ldquo;unavailable&rdquo; rooms are never used.
          </p>
          <table>
            <thead><tr><th>Room</th><th>Status &middot; order</th><th /></tr></thead>
            <tbody>
              {rooms.map(r => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>
                    <form action={updateRoom} className="inline">
                      <input type="hidden" name="id" value={r.id} />
                      <select name="status" defaultValue={r.status} aria-label="Status">
                        <option value="available">Available</option>
                        <option value="last resort">Last resort</option>
                        <option value="unavailable">Unavailable</option>
                      </select>
                      <input name="sort_order" type="number" defaultValue={r.sort_order} style={{ width: 60 }} aria-label="Order" />
                      <button type="submit">Save</button>
                    </form>
                  </td>
                  <td>
                    <form action={deleteRoom}>
                      <input type="hidden" name="id" value={r.id} />
                      <ConfirmButton className="link danger" message={`Delete ${r.name}?`}>Delete</ConfirmButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form action={addRoom} className="inline" style={{ marginTop: 12 }}>
            <input name="name" placeholder="New room" required /><button type="submit">Add room</button>
          </form>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Brands</h2>
          <p className="small muted">After adding a brand, set which hosts can stream it on each host&rsquo;s page (new brands start as Excluded).</p>
          <table>
            <tbody>
              {brands.map(b => (
                <tr key={b.id}>
                  <td>
                    <form action={renameBrand} className="inline">
                      <input type="hidden" name="id" value={b.id} />
                      <input name="name" defaultValue={b.name} aria-label="Brand name" />
                      <button type="submit">Rename</button>
                    </form>
                  </td>
                  <td>
                    <form action={deleteBrand}>
                      <input type="hidden" name="id" value={b.id} />
                      <ConfirmButton className="link danger" message={`Delete ${b.name}? This removes its commitments and pre-planned streams in every month.`}>Delete</ConfirmButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form action={addBrand} className="inline" style={{ marginTop: 12 }}>
            <input name="name" placeholder="New brand" required /><button type="submit">Add brand</button>
          </form>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Ops team</h2>
          <p className="small muted">Ops accounts can manage everything. Host logins are set on each host&rsquo;s page.</p>
          <table>
            <tbody>
              {admins.map(a => (
                <tr key={a.id}>
                  <td>{a.name || a.email}<div className="small muted">{a.email}</div></td>
                  <td>
                    {a.id !== me.id && (
                      <form action={deleteAdmin}>
                        <input type="hidden" name="id" value={a.id} />
                        <ConfirmButton className="link danger" message={`Remove ${a.email}?`}>Remove</ConfirmButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form action={addAdmin} className="form-row" style={{ marginTop: 12 }}>
            <label className="field">Name<input name="name" /></label>
            <label className="field">Email<input name="email" type="email" required /></label>
            <label className="field">Password<input name="password" type="text" minLength={8} required autoComplete="off" /></label>
            <div><button type="submit">Add</button></div>
          </form>
        </div>
      </div>
    </>
  );
}
