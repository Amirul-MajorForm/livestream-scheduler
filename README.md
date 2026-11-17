# Livestream Scheduler

A web app that replaces the *MajorForm Livestream Capacity & Scheduling* Google Sheet.

- **Ops team** manage brands, rooms, hosts, monthly commitments, sale days and pre-planned streams, run the scheduler, review and edit the result, and publish it.
- **Hosts** sign in, mark their availability on a monthly grid, and see their own streams once a schedule is published.

The scheduling engine (`lib/scheduler.ts`) is a direct port of the Apps Script *MAJORFORM LIVESTREAM SCHEDULER V7* (kept for reference in `docs/apps-script-v7.js`). Given the same inputs it produces the same schedule as the original script, row for row. `npm run parity` checks this against a sheet export.

## How a month works

1. **Months → Start a new month.** Copy commitments and sale days from the previous month, then adjust the sale dates (Rules & sale days tab) and session numbers (Commitments tab).
2. **Pre-planned streams.** Add confirmed bookings (The Ordinary, MOOM, Oatside, …). Leave the host blank to let the scheduler pick one.
3. **Host availability.** Hosts fill in their own grid. The tab shows who has availability, and ops can edit anyone's. Lock availability when you're ready to schedule.
4. **Schedule → Run scheduler.** Each run is saved as a version with the full summary (fulfilment, unfulfilled commitments with reasons, host and room utilisation, warnings). Edit streams if needed (conflicts are flagged), then **Publish to hosts**.
5. Hosts see their published streams under **My schedule**. Export any version to CSV.

## Scheduling rules (same as the sheet)

- Hard rules: brand eligibility (Excluded is never scheduled), platform (TikTok & Shopee needs both), marked availability, max streams per month, max % of a brand's sessions, at most 2 streams per host per day, no host/room/same-brand overlaps, room permissions, unavailable rooms.
- Pre-planned streams are locked in first, even if they break the rules above (a warning is shown), and count toward matching commitments.
- Preferences: Preferred hosts, evening slots, spreading a brand across the month, avoiding back-to-back gaps, the daytime % limits per BAU/Mega and weekday/weekend, avoiding "last resort" rooms, avoiding Friday BAU, and not leaving a female host as the only late stream.

## Deploying on Railway

1. Merge this branch into your main branch (or point Railway at this branch).
2. In Railway: **New Project → Deploy from GitHub repo** and pick this repo.
3. In the same project: **New → Database → PostgreSQL**.
4. In the app service's **Variables**, add:
   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference to the Postgres service) |
   | `SESSION_SECRET` | a long random string, e.g. output of `openssl rand -hex 32` |
   | `ADMIN_EMAIL` | email for the first ops login |
   | `ADMIN_PASSWORD` | password for the first ops login (change it after signing in) |
   | `APP_TIMEZONE` | optional, defaults to `Asia/Singapore` |
   | `ANTHROPIC_API_KEY` | optional: enables "Paste a host's message" (reads WhatsApp-style availability messages with Claude). Get a key at console.anthropic.com |
5. **Settings → Networking → Generate Domain.**
6. Deploy. On start, the app applies database migrations and creates the first admin.

Railway builds with `npm run build` and starts with `npm start` (see `railway.json`).

### Moving data over from the Google Sheet (one time)

1. In Google Sheets: **File → Download → Microsoft Excel (.xlsx)**.
2. In the app: **Import**, upload the file.
3. Give each host a login on their host page (Hosts → name → Login) and send them the details.

The import is safe to repeat: rooms, brands and hosts are matched by name, and the month's commitments, sale days and pre-planned streams are replaced.

## Local development

```bash
cp .env.example .env.local   # then fill in values
npm install
npm run migrate
npm run dev
```

You need a local Postgres. Tests:

```bash
npm test                                  # scheduler unit tests
npm run parity -- path/to/sheet-export.xlsx   # original Apps Script vs port, row-by-row
```

## Project layout

- `lib/scheduler.ts`: the scheduling engine (pure function, no I/O)
- `lib/workbook.ts`: reads the Google Sheet export (.xlsx)
- `lib/data.ts`: loads a month from Postgres, saves runs, imports
- `app/admin/*`: ops pages; `app/host`: host portal; `app/api/availability`: availability saves
- `migrations/*.sql`: database schema (applied by `scripts/migrate.mjs` on start)
