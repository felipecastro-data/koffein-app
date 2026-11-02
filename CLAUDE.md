# koffein-app

Spanish-language time tracking PWA for 2 employees at a café. Tracks daily
hours (HORAS) and pay (COSTO) per employee, by month, with totals per
quincena. Built for a phone home screen, used for quick daily entry.

The app lives in `cloudflare/` and runs at
`https://koffein.colombia-energy.workers.dev/<APP_KEY>/` (full link in the
gitignored `cloudflare/.prod-link`). The old GitHub Pages version that used to
sit at the repo root was removed; it's still in git history before the
`remove-old-app` merge.

## File structure

```
cloudflare/
  wrangler.jsonc        Worker config: assets from public/, D1 binding DB
  src/worker.js         Key check, asset serving, API
  migrations/           D1 schema (employees, entries, edit_log)
  public/index.html     Markup: header + save status, tabs, month bar,
                        two employee cards, quincenas list
  public/style.css      All styling, dark/gold theme, CSS custom properties
  public/app.js         All behavior: local cache, sync, rendering, editing
  public/manifest.json  PWA manifest (start_url/scope "./")
  public/sw.js          Service worker, cache "koffein-cf-v1"
  public/icons/         icon-32.png, icon-180.png, icon-192.png, icon-512.png
```

No build step. No dependencies, frameworks, or package.json — plain
HTML/CSS/vanilla JS only. Edit the files directly; there is nothing to
compile or bundle.

## Server

- **One Worker** (`src/worker.js`) serves `public/` and the API. Every URL is
  under `/<APP_KEY>/`; anything else is a 404. `APP_KEY` is a Worker secret
  (`wrangler secret put APP_KEY`); locally it's in `.dev.vars`. No login —
  the link is the only protection. If it leaks, rotate `APP_KEY` (the phone
  then needs the new link re-added to the home screen).
- **D1 database `koffein`** is the source of truth: `employees` (2 fixed
  slots, editable names, global across months), `entries` (one row per
  employee per day, last-write-wins on `updated_at`), and `edit_log`
  (append-only record of every write, for recovery beyond D1's 30-day Time
  Travel). Schema in `migrations/`.
- **API**: `GET api/data` returns everything; `POST api/ops` applies a batch
  of `{type: "entry"|"name", ..., ts}` ops. Dates before `2026-11-01` are
  rejected. The client validates the same rules, so a 400 shouldn't happen —
  keep the two in sync (`MAX_HORAS`, `MAX_COSTO`, `FIRST_MONTH` in `app.js`).

## Frontend

- localStorage keys: `koffein-cache` (offline copy of the data),
  `koffein-pending` (queue of edits not yet confirmed, retried until the
  server accepts them), `koffein-ui` (tab and accordion state, per device).
- The header shows the save status ("Guardado en la nube", "Guardando…",
  "Sin conexión · N cambios pendientes", …).
- **Días** tab: month bar starts at Noviembre 2026 and can't go past the
  current month; rows = real days in the month, with subtotals per quincena.
- **Quincenas** tab: Costo per employee for 1–15 and 16–end, newest first.
- No "Borrar todo" in this version.

## Key conventions

- **Horas** input is `type="text"` with `inputMode = "decimal"` (not
  `type="number"`) because Spanish keyboards use `,` as the decimal
  separator. `parseHoras()` accepts both `"8,5"` and `"8.5"`, rejects
  negative/invalid values (clears to `null`), and `formatHoras()` displays
  the stored number back with a comma.
- **Costo** is stored as a raw whole-peso number and only formatted for
  display via `formatPesos()` (`toLocaleString("es-CO")`, e.g. `56000` →
  `"56.000"`). Never store the formatted string.
- Row editing is tap-to-edit: tapping a row swaps its Horas/Costo cells for
  inputs (`activateRowEdit`), commits on blur/Enter, discards on Escape.
- Employee cards default to **collapsed**.

## Constraints

- **No build step, no dependencies.** Don't introduce a bundler,
  package.json, or npm dependency.
- Keep all asset paths relative — every URL sits under `/<APP_KEY>/`.
- **Whenever any file in `public/` changes, bump `CACHE_NAME` in
  `public/sw.js`** (e.g. to `"koffein-cf-v2"`) — otherwise returning
  visitors keep getting stale cached assets. The service worker never caches
  `api/` requests.
- Service workers require HTTPS (or `localhost`).

## Commands

No package.json; wrangler runs via npx. From `cloudflare/`:

- Local dev: `npx --yes wrangler@4.156.0 dev --port 8788` (or the
  `koffein-cloudflare` launch config)
- Migrations: `npx --yes wrangler@4.156.0 d1 migrations apply koffein --remote`
- Deploy: `npx --yes wrangler@4.156.0 deploy`
- Backup: `npx --yes wrangler@4.156.0 d1 export koffein --remote --output backup.sql`
