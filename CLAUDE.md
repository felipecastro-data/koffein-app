# koffein-app

Spanish-language time tracking PWA for 2 employees at a café. Tracks daily
hours (HORAS) and pay (COSTO) per employee over a 31-day month, with a
running total. Built for a phone home screen, used for quick daily entry.

## File structure

```
index.html    All markup: header, summary bar, two employee cards
              (each with a table.hours-table), reset button + modal
style.css     All styling, dark/gold theme, CSS custom properties
app.js        All behavior — state, rendering, editing, accordion, reset
manifest.json PWA manifest (name, icons, theme colors, standalone display)
sw.js         Service worker: cache-first fetch, offline fallback
icons/        icon-32.png, icon-180.png, icon-192.png, icon-512.png
```

No build step. No dependencies, frameworks, or package.json — plain
HTML/CSS/vanilla JS only. Edit the files directly; there is nothing to
compile or bundle.

## Data model

State lives in `localStorage` under the key `"koffein-data"`:

```js
{
  employees: [
    {
      id: 1,
      name: "Empleado 1",
      collapsed: true,           // accordion state, persisted per employee
      rows: [                    // exactly ROWS_PER_EMPLOYEE (31) entries
        { horas: number|null, costo: number|null },
        // ...31 total, index 0 = día 1
      ]
    },
    { id: 2, name: "Empleado 2", collapsed: true, rows: [ ...31 ] }
  ]
}
```

- `ROWS_PER_EMPLOYEE` is defined once in `app.js` (currently `31`, one row
  per day of a full month). `makeEmptyRows()` and `createDefaultState()`
  both derive from it — don't hardcode row counts elsewhere.
- `loadState()` pads any employee's `rows` array with `{horas: null, costo:
  null}` up to `ROWS_PER_EMPLOYEE` on load, so old saved data (e.g. from
  when this was 15 rows) doesn't break. Keep this padding logic if
  `ROWS_PER_EMPLOYEE` changes again.
- `loadState()` also defaults a missing `collapsed` field to `false` for
  backward compatibility with data saved before the accordion existed.
  New default state (`createDefaultState()`) sets `collapsed: true`.

## Key conventions

- **Horas** input is `type="text" inputmode="decimal"` (not `type="number"`)
  because Spanish keyboards use `,` as the decimal separator, which
  `<input type="number">` rejects. `parseHoras()` accepts both `"8,5"` and
  `"8.5"`, rejects negative/invalid values (clears to `null`), and
  `formatHoras()` displays the stored number back with a comma (`"8,5 h"`).
- **Costo** is stored as a raw JS number (whole pesos) and only formatted
  for display via `formatPesos()`, which uses `toLocaleString("es-CO")` to
  get COP thousands-separator formatting (e.g. `56000` → `"56.000"`). Never
  store the formatted string — always the raw number.
- Row editing is tap-to-edit: tapping a row swaps its Horas/Costo cells for
  inputs (`activateRowEdit`), commits on blur/Enter, discards on Escape.
- The accordion header toggle excludes clicks on `.employee-name` (so
  inline name editing isn't blocked) and persists `collapsed` per employee
  immediately via `saveState()`.
- Both employee cards default to **collapsed** — both on first load
  (`createDefaultState()`) and after using "Borrar todo" (reset also
  preserves employee names, only clears rows and re-collapses).

## Constraints

- **No build step, no dependencies.** Plain HTML/CSS/vanilla JS, loaded
  directly by the browser. Don't introduce a bundler, package.json, or
  npm dependency.
- **GitHub Pages hosted**, likely served from a subpath (e.g.
  `username.github.io/koffein-app/`), not the domain root. Keep all
  asset paths relative (as they are now) — never absolute (`/app.js`).
- **PWA with a service worker cache named `"koffein-v1"`** (`sw.js`). The
  cache name is also how old caches get evicted on `activate`. **Whenever
  any cached file's content changes (`index.html`, `style.css`, `app.js`,
  `manifest.json`, or any icon), bump `CACHE_NAME` in `sw.js`** (e.g. to
  `"koffein-v2"`) — otherwise returning visitors keep getting served stale
  cached assets indefinitely, since the fetch handler is cache-first.
- Service workers require HTTPS (or `localhost`) — this won't register
  over a plain `file://` preview, only once deployed (or served locally).

## Cloudflare version (`cloudflare/`) — the new app

A second copy of the app, live at `https://koffein.colombia-energy.workers.dev/<APP_KEY>/`
(full link in the gitignored `cloudflare/.prod-link`). The root files above are
the old GitHub Pages version, kept live until this one is confirmed; then they
can be deleted.

- **One Worker** (`src/worker.js`) serves `public/` and the API. Every URL is
  under `/<APP_KEY>/`; anything else is a 404. `APP_KEY` is a Worker secret
  (`wrangler secret put APP_KEY`); locally it's in `.dev.vars`. No login.
- **D1 database `koffein`** is the source of truth: `employees` (2 fixed
  slots, editable names), `entries` (one row per employee per day,
  last-write-wins on `updated_at`), and `edit_log` (append-only record of every
  write, for recovery beyond D1's 30-day Time Travel). Schema in `migrations/`.
- **API**: `GET api/data` returns everything; `POST api/ops` applies a batch
  of `{type: "entry"|"name", ..., ts}` ops. Dates before `2026-11-01` are rejected.
- **Frontend** keeps an offline copy (`koffein-cache`) and a queue of unsaved
  edits (`koffein-pending`) in localStorage, retried until the server accepts
  them. The header shows the save status. Month bar starts at Noviembre 2026
  and can't go past the current month; rows = real days in the month.
  "Quincenas" tab: Costo per employee for 1–15 and 16–end, newest first.
  No "Borrar todo" in this version.
- `sw.js` cache is `"koffein-cf-v1"` — same bump rule as above. It never
  caches `api/` requests.
- No package.json; wrangler runs via npx. From `cloudflare/`:
  `npx wrangler@4.156.0 dev --port 8788` (or the `koffein-cloudflare` launch
  config), `npx wrangler@4.156.0 d1 migrations apply koffein --remote`,
  `npx wrangler@4.156.0 deploy`. Backup: `npx wrangler@4.156.0 d1 export koffein --remote --output backup.sql`.
