// koffein Worker: key check, static app, and the D1-backed API.
//
// Every URL is /<APP_KEY>/...; the key is the only protection (no login), so a
// wrong or missing key gets the same 404 as a path that doesn't exist.

const FIRST_DATE = "2026-11-01";
const MAX_OPS = 500;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const [, key = "", ...rest] = url.pathname.split("/");

    if (!(await keyMatches(key, env.APP_KEY))) {
      return new Response("Not found", { status: 404 });
    }

    // /<key> → /<key>/ so relative asset paths resolve under the key.
    if (rest.length === 0) {
      return Response.redirect(`${url.origin}/${key}/`, 301);
    }

    const path = "/" + rest.join("/");
    let response;
    if (path.startsWith("/api/")) {
      response = await handleApi(request, env, path);
    } else {
      const assetUrl = new URL(path === "/" ? "/index.html" : path, url.origin);
      const asset = await env.ASSETS.fetch(assetUrl);
      response = new Response(asset.body, asset); // copy so headers are mutable
      // Always revalidate; the service worker does the offline caching.
      response.headers.set("Cache-Control", "no-cache");
    }

    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  },
};

async function keyMatches(given, expected) {
  if (!expected || !given) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

async function handleApi(request, env, path) {
  try {
    if (path === "/api/data" && request.method === "GET") {
      return json(await readAll(env.DB));
    }
    if (path === "/api/ops" && request.method === "POST") {
      const body = await request.json().catch(() => null);
      const ops = body && Array.isArray(body.ops) ? body.ops : null;
      if (!ops || ops.length > MAX_OPS) return json({ error: "bad request" }, 400);
      const statements = [];
      for (const op of ops) {
        const built = buildOp(env.DB, op);
        if (!built) return json({ error: "invalid op", op }, 400);
        statements.push(...built);
      }
      if (statements.length) await env.DB.batch(statements);
      return json({ ok: true, applied: ops.length });
    }
    return json({ error: "not found" }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: "server error" }, 500);
  }
}

async function readAll(db) {
  const [employees, entries] = await db.batch([
    db.prepare("SELECT id, name, updated_at FROM employees ORDER BY id"),
    db.prepare("SELECT employee_id, date, horas, costo, updated_at FROM entries ORDER BY date"),
  ]);
  return { employees: employees.results, entries: entries.results };
}

// Validates one client op and returns the statements that apply it, or null.
// Writes only land when they're newer than what's stored (last write wins),
// so a stale offline edit can't overwrite a later one.
function buildOp(db, op) {
  if (!op || typeof op !== "object") return null;
  const now = Date.now();
  const ts = op.ts;
  if (!Number.isInteger(ts) || ts <= 0 || ts > now + 86_400_000) return null;
  if (op.employee_id !== 1 && op.employee_id !== 2) return null;

  if (op.type === "entry") {
    if (!isValidDate(op.date)) return null;
    const horas = op.horas;
    const costo = op.costo;
    if (horas !== null && !(typeof horas === "number" && horas >= 0 && horas <= 24)) return null;
    if (costo !== null && !(Number.isInteger(costo) && costo >= 0 && costo <= 100_000_000)) return null;
    return [
      db.prepare(
        `INSERT INTO entries (employee_id, date, horas, costo, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (employee_id, date) DO UPDATE
           SET horas = excluded.horas, costo = excluded.costo, updated_at = excluded.updated_at
           WHERE excluded.updated_at >= entries.updated_at`
      ).bind(op.employee_id, op.date, horas, costo, ts),
      db.prepare(
        `INSERT INTO edit_log (received_at, kind, employee_id, date, horas, costo, client_ts)
         VALUES (?1, 'entry', ?2, ?3, ?4, ?5, ?6)`
      ).bind(now, op.employee_id, op.date, horas, costo, ts),
    ];
  }

  if (op.type === "name") {
    const name = typeof op.name === "string" ? op.name.trim() : "";
    if (!name || name.length > 40) return null;
    return [
      db.prepare(
        "UPDATE employees SET name = ?1, updated_at = ?2 WHERE id = ?3 AND updated_at <= ?2"
      ).bind(name, ts, op.employee_id),
      db.prepare(
        `INSERT INTO edit_log (received_at, kind, employee_id, name, client_ts)
         VALUES (?1, 'name', ?2, ?3, ?4)`
      ).bind(now, op.employee_id, name, ts),
    ];
  }

  return null;
}

function isValidDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s) || s < FIRST_DATE) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
