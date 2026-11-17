// Applies SQL migrations in /migrations once each, then bootstraps the first admin
// from ADMIN_EMAIL / ADMIN_PASSWORD if no admin exists yet.
import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(1); }
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('SELECT pg_advisory_lock(424242)');
  await client.query('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const done = new Set((await client.query('SELECT name FROM _migrations')).rows.map(r => r.name));
  for (const f of readdirSync(join(root, 'migrations')).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    await client.query('BEGIN');
    try {
      await client.query(readFileSync(join(root, 'migrations', f), 'utf8'));
      await client.query('INSERT INTO _migrations(name) VALUES ($1)', [f]);
      await client.query('COMMIT');
      console.log('Applied migration', f);
    } catch (e) { await client.query('ROLLBACK'); throw e; }
  }
  const admins = (await client.query("SELECT count(*)::int AS n FROM users WHERE role='admin'")).rows[0].n;
  if (!admins) {
    const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
    if (email && password) {
      await client.query("INSERT INTO users(email, name, password_hash, role) VALUES ($1, 'Admin', $2, 'admin')",
        [email.trim().toLowerCase(), await bcrypt.hash(password, 10)]);
      console.log('Created admin user', email);
    } else {
      console.warn('No admin user exists. Set ADMIN_EMAIL and ADMIN_PASSWORD and restart to create one.');
    }
  }
} finally {
  await client.query('SELECT pg_advisory_unlock(424242)').catch(() => {});
  await client.end();
}
