// koffein — time tracker interactivity
//
// D1 (via the Worker API) is the source of truth. localStorage keeps an offline
// copy of the data plus a queue of edits the server hasn't confirmed yet, so
// nothing typed offline is lost: the queue is retried until it lands.

const CACHE_KEY = "koffein-cache";     // last known data, including local edits
const PENDING_KEY = "koffein-pending"; // edits not yet confirmed by the server
const UI_KEY = "koffein-ui";           // per-device view prefs (tab, accordion)
const FIRST_MONTH = "2026-11";
const MAX_HORAS = 24;
const MAX_COSTO = 100000000;

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // storage full or blocked; the server copy is still the safe one
  }
}

// entries: { "<employeeId>|<YYYY-MM-DD>": { horas, costo, updated_at } }
const data = readJSON(CACHE_KEY, null) || {
  employees: [
    { id: 1, name: "Empleado 1" },
    { id: 2, name: "Empleado 2" },
  ],
  entries: {},
};
let pending = readJSON(PENDING_KEY, []);
const ui = Object.assign({ tab: "dias", collapsed: { 1: true, 2: true } }, readJSON(UI_KEY, {}));

function saveData() {
  writeJSON(CACHE_KEY, data);
  writeJSON(PENDING_KEY, pending);
}

function saveUi() {
  writeJSON(UI_KEY, ui);
}

// ---- dates ----

function pad(n) {
  return String(n).padStart(2, "0");
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function maxMonth() {
  const m = currentMonth();
  return m < FIRST_MONTH ? FIRST_MONTH : m;
}

function clampMonth(m) {
  if (m < FIRST_MONTH) return FIRST_MONTH;
  const max = maxMonth();
  return m > max ? max : m;
}

function shiftMonth(m, delta) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function daysInMonth(m) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo, 0).getDate();
}

function monthLabel(m) {
  const [y, mo] = m.split("-").map(Number);
  return `${MONTH_NAMES[mo - 1]} ${y}`;
}

// ---- formatting ----

function formatPesos(n) {
  return Math.round(n || 0).toLocaleString("es-CO");
}

function formatHoras(n) {
  return String(Math.round(n * 100) / 100).replace(".", ",");
}

function parseHoras(raw) {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = parseFloat(trimmed.replace(",", "."));
  if (Number.isNaN(value) || value < 0 || value > MAX_HORAS) return null;
  return value;
}

function parseCosto(raw) {
  if (raw.trim() === "") return null;
  const value = Math.round(parseFloat(raw));
  if (Number.isNaN(value) || value < 0 || value > MAX_COSTO) return null;
  return value;
}

// ---- data access ----

function entryKey(employeeId, date) {
  return `${employeeId}|${date}`;
}

function getEntry(employeeId, date) {
  return data.entries[entryKey(employeeId, date)] || null;
}

function costoBetween(employeeId, fromDate, toDate) {
  let sum = 0;
  Object.keys(data.entries).forEach((key) => {
    const [id, date] = key.split("|");
    if (Number(id) === employeeId && date >= fromDate && date <= toDate) {
      sum += data.entries[key].costo || 0;
    }
  });
  return sum;
}

function setEntry(employeeId, date, horas, costo) {
  const ts = Date.now();
  data.entries[entryKey(employeeId, date)] = { horas, costo, updated_at: ts };
  pending.push({ type: "entry", employee_id: employeeId, date, horas, costo, ts });
  saveData();
  sync();
}

function setEmployeeName(employeeId, name) {
  const employee = data.employees.find((e) => e.id === employeeId);
  if (!employee || employee.name === name) return;
  employee.name = name;
  pending.push({ type: "name", employee_id: employeeId, name, ts: Date.now() });
  saveData();
  sync();
}

// ---- sync with the server ----

let syncPromise = null;
let resyncRequested = false;
let hasLoaded = false;
let lastError = null;

async function apiFetch(path, options) {
  const res = await fetch(path, Object.assign({ cache: "no-store" }, options));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function flush() {
  while (pending.length) {
    const batch = pending.slice(0, 200);
    await apiFetch("api/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ops: batch }),
    });
    // Edits made while the request was in flight were appended after the batch.
    pending = pending.slice(batch.length);
    writeJSON(PENDING_KEY, pending);
  }
}

async function pull() {
  const server = await apiFetch("api/data");

  // Anything still queued locally is newer than the server's copy; keep it.
  const pendingEntryKeys = new Set();
  const pendingNameIds = new Set();
  pending.forEach((op) => {
    if (op.type === "entry") pendingEntryKeys.add(entryKey(op.employee_id, op.date));
    if (op.type === "name") pendingNameIds.add(op.employee_id);
  });

  const entries = {};
  server.entries.forEach((e) => {
    entries[entryKey(e.employee_id, e.date)] = { horas: e.horas, costo: e.costo, updated_at: e.updated_at };
  });
  pendingEntryKeys.forEach((key) => {
    if (data.entries[key]) entries[key] = data.entries[key];
  });
  data.entries = entries;

  data.employees = server.employees.map((emp) => {
    const local = data.employees.find((e) => e.id === emp.id);
    return pendingNameIds.has(emp.id) && local ? local : { id: emp.id, name: emp.name };
  });

  saveData();
}

function sync() {
  if (syncPromise) {
    resyncRequested = true;
    return syncPromise;
  }
  syncPromise = (async () => {
    renderSyncStatus(true);
    try {
      await flush();
      await pull();
      hasLoaded = true;
      lastError = null;
    } catch (e) {
      lastError = e;
    } finally {
      syncPromise = null;
      render();
      renderSyncStatus(false);
      if (resyncRequested) {
        resyncRequested = false;
        sync();
      }
    }
  })();
  return syncPromise;
}

function renderSyncStatus(busy) {
  const el = document.getElementById("sync-status");
  const text = el.querySelector(".sync-text");
  let state;
  let label;

  if (busy) {
    state = "saving";
    label = pending.length ? "Guardando…" : "Actualizando…";
  } else if (lastError) {
    state = "error";
    const where = navigator.onLine ? "No se pudo guardar" : "Sin conexión";
    label = pending.length
      ? `${where} · ${pending.length} ${pending.length === 1 ? "cambio pendiente" : "cambios pendientes"}`
      : `${where} · mostrando copia local`;
  } else if (hasLoaded) {
    state = "ok";
    label = "Guardado en la nube";
  } else {
    state = "saving";
    label = "Cargando…";
  }

  el.dataset.state = state;
  text.textContent = label;
}

// ---- days tab ----

let viewMonth = clampMonth(currentMonth());
let openedMonth = currentMonth();
const cardsById = {};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function initCards() {
  const container = document.getElementById("employee-cards");
  const template = document.getElementById("employee-card-template");

  data.employees.forEach((employee) => {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.employeeId = employee.id;
    container.appendChild(card);
    cardsById[employee.id] = card;
    initNameEditing(card, employee.id);
    initAccordion(card, employee.id);
  });
}

function buildRows() {
  const [y, mo] = viewMonth.split("-").map(Number);
  const days = daysInMonth(viewMonth);
  const today = todayISO();

  Object.keys(cardsById).forEach((id) => {
    const employeeId = Number(id);
    const tbody = cardsById[id].querySelector("tbody");
    tbody.innerHTML = "";

    for (let d = 1; d <= days; d++) {
      const date = `${viewMonth}-${pad(d)}`;
      const tr = document.createElement("tr");
      tr.dataset.date = date;
      if (date === today) tr.classList.add("today");

      const dayTd = el("td", "col-day", String(d) + " ");
      dayTd.appendChild(el("span", "weekday", WEEKDAYS[new Date(y, mo - 1, d).getDay()]));
      tr.append(dayTd, el("td", "col-hours"), el("td", "col-cost"));

      tr.addEventListener("click", (e) => {
        if (tr.classList.contains("editing")) return;
        const focusField = e.target.closest(".col-cost") ? "costo" : "horas";
        activateRowEdit(employeeId, date, tr, focusField);
      });
      tbody.appendChild(tr);

      if (d === 15 || d === days) {
        const sub = el("tr", "subtotal-row");
        sub.dataset.half = d === 15 ? "1" : "2";
        const label = el("td", "subtotal-label", d === 15 ? "1ª quincena" : "2ª quincena");
        label.colSpan = 2;
        sub.append(label, el("td", "subtotal-value"));
        tbody.appendChild(sub);
      }
    }
  });
}

function render() {
  document.getElementById("month-label").textContent = monthLabel(viewMonth);
  document.getElementById("month-prev").disabled = viewMonth <= FIRST_MONTH;
  document.getElementById("month-next").disabled = viewMonth >= maxMonth();

  let grandTotalCosto = 0;

  data.employees.forEach((employee) => {
    const card = cardsById[employee.id];
    if (!card) return;

    const nameEl = card.querySelector(".employee-name");
    const avatarEl = card.querySelector(".avatar");
    if (document.activeElement !== nameEl) {
      nameEl.textContent = employee.name;
    }
    avatarEl.textContent = (employee.name.trim().charAt(0) || "?").toUpperCase();

    let hoursSum = 0;
    let costoSum = 0;
    const halves = { 1: 0, 2: 0 };

    card.querySelectorAll("tbody tr[data-date]").forEach((tr) => {
      const date = tr.dataset.date;
      const entry = getEntry(employee.id, date);
      const horas = entry ? entry.horas : null;
      const costo = entry ? entry.costo : null;

      hoursSum += horas || 0;
      costoSum += costo || 0;
      halves[Number(date.slice(8)) <= 15 ? 1 : 2] += costo || 0;

      if (tr.classList.contains("editing")) return;
      tr.querySelector(".col-hours").textContent = horas != null ? formatHoras(horas) : "";
      tr.querySelector(".col-cost").textContent = costo != null ? formatPesos(costo) : "";
    });

    card.querySelectorAll(".subtotal-row").forEach((sub) => {
      sub.querySelector(".subtotal-value").textContent = "$" + formatPesos(halves[sub.dataset.half]);
    });

    grandTotalCosto += costoSum;
    card.querySelector(".hours-total").textContent = formatHoras(hoursSum);
    card.querySelector(".cost-total").textContent = "$" + formatPesos(costoSum);
  });

  document.querySelector(".summary-total").textContent = "$" + formatPesos(grandTotalCosto);
  renderQuincenas();
}

function activateRowEdit(employeeId, date, tr, focusField) {
  tr.classList.add("editing");

  const entry = getEntry(employeeId, date) || { horas: null, costo: null };
  const horasTd = tr.querySelector(".col-hours");
  const costoTd = tr.querySelector(".col-cost");

  horasTd.innerHTML = "";
  const horasInput = document.createElement("input");
  horasInput.type = "text";
  horasInput.inputMode = "decimal";
  horasInput.placeholder = "—";
  horasInput.className = "cell-input";
  if (entry.horas != null) horasInput.value = formatHoras(entry.horas);
  horasTd.appendChild(horasInput);

  costoTd.innerHTML = "";
  const costoInput = document.createElement("input");
  costoInput.type = "number";
  costoInput.step = "1";
  costoInput.inputMode = "numeric";
  costoInput.placeholder = "—";
  costoInput.className = "cell-input";
  if (entry.costo != null) costoInput.value = entry.costo;
  costoTd.appendChild(costoInput);

  let done = false;

  function commit() {
    if (done) return;
    done = true;

    const horas = parseHoras(horasInput.value);
    const costo = parseCosto(costoInput.value);
    tr.classList.remove("editing");
    if (horas !== entry.horas || costo !== entry.costo) {
      setEntry(employeeId, date, horas, costo);
    }
    render();
  }

  function cancel() {
    done = true;
    tr.classList.remove("editing");
    render();
  }

  function handleBlur() {
    setTimeout(() => {
      if (document.activeElement !== horasInput && document.activeElement !== costoInput) {
        commit();
      }
    }, 0);
  }

  function handleKeydown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (document.activeElement === horasInput) {
        costoInput.focus();
        costoInput.select();
      } else {
        costoInput.blur();
      }
    } else if (e.key === "Escape") {
      cancel();
    }
  }

  horasInput.addEventListener("blur", handleBlur);
  costoInput.addEventListener("blur", handleBlur);
  horasInput.addEventListener("keydown", handleKeydown);
  costoInput.addEventListener("keydown", handleKeydown);

  const toFocus = focusField === "costo" ? costoInput : horasInput;
  toFocus.focus();
  toFocus.select();
}

function setCardExpanded(card, expanded) {
  const wrap = card.querySelector(".table-wrap");
  const toggleIcon = card.querySelector(".toggle-icon");
  const header = card.querySelector(".employee-header");

  wrap.classList.toggle("expanded", expanded);
  toggleIcon.classList.toggle("collapsed", !expanded);
  toggleIcon.setAttribute("aria-label", expanded ? "Colapsar" : "Expandir");
  header.setAttribute("aria-expanded", String(expanded));
}

function initAccordion(card, employeeId) {
  const header = card.querySelector(".employee-header");
  const wrap = card.querySelector(".table-wrap");

  wrap.style.transition = "none";
  setCardExpanded(card, ui.collapsed[employeeId] === false);
  void wrap.offsetHeight;
  wrap.style.transition = "";

  header.addEventListener("click", (e) => {
    if (e.target.closest(".employee-name")) return;
    const expanded = !wrap.classList.contains("expanded");
    ui.collapsed[employeeId] = !expanded;
    saveUi();
    setCardExpanded(card, expanded);
  });
}

function initNameEditing(card, employeeId) {
  const nameEl = card.querySelector(".employee-name");

  nameEl.addEventListener("blur", () => {
    const newName = nameEl.textContent.trim().slice(0, 40) || `Empleado ${employeeId}`;
    setEmployeeName(employeeId, newName);
    render();
  });

  nameEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      nameEl.blur();
    }
  });
}

function initMonthBar() {
  function go(delta) {
    const next = clampMonth(shiftMonth(viewMonth, delta));
    if (next === viewMonth) return;
    viewMonth = next;
    buildRows();
    render();
  }
  document.getElementById("month-prev").addEventListener("click", () => go(-1));
  document.getElementById("month-next").addEventListener("click", () => go(1));
}

// ---- quincenas tab ----

// Newest first: the current quincena, then back to 1–15 of FIRST_MONTH.
function quincenaList() {
  const list = [];
  let month = maxMonth();
  let half = currentMonth() >= FIRST_MONTH && new Date().getDate() > 15 ? 2 : 1;
  while (month >= FIRST_MONTH) {
    list.push({ month, half });
    if (half === 2) {
      half = 1;
    } else {
      half = 2;
      month = shiftMonth(month, -1);
    }
  }
  return list;
}

function renderQuincenas() {
  const container = document.getElementById("quincena-list");
  container.innerHTML = "";
  const today = todayISO();

  quincenaList().forEach(({ month, half }) => {
    const lastDay = daysInMonth(month);
    const from = `${month}-${half === 1 ? "01" : "16"}`;
    const to = `${month}-${half === 1 ? "15" : pad(lastDay)}`;

    const card = el("article", "quincena-card");
    const header = el("header", "quincena-header");
    header.appendChild(el("h3", "quincena-month", monthLabel(month)));
    header.appendChild(el("span", "quincena-range", half === 1 ? "1 – 15" : `16 – ${lastDay}`));
    if (today >= from && today <= to) header.appendChild(el("span", "quincena-badge", "En curso"));
    card.appendChild(header);

    let total = 0;
    data.employees.forEach((employee) => {
      const amount = costoBetween(employee.id, from, to);
      total += amount;
      const row = el("div", "quincena-row");
      row.append(el("span", "quincena-name", employee.name), el("span", "quincena-amount", "$" + formatPesos(amount)));
      card.appendChild(row);
    });

    const totalRow = el("div", "quincena-row quincena-total");
    totalRow.append(el("span", "quincena-name", "Total"), el("span", "quincena-amount", "$" + formatPesos(total)));
    card.appendChild(totalRow);

    container.appendChild(card);
  });
}

// ---- tabs ----

function showTab(tab) {
  ui.tab = tab;
  saveUi();
  document.querySelectorAll(".tab").forEach((btn) => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  document.getElementById("panel-dias").hidden = tab !== "dias";
  document.getElementById("panel-quincenas").hidden = tab !== "quincenas";
}

function initTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });
  showTab(ui.tab === "quincenas" ? "quincenas" : "dias");
}

// ---- start ----

initCards();
initMonthBar();
initTabs();
buildRows();
render();
renderSyncStatus(false);
sync();

// Ask the browser not to evict the offline copy under storage pressure.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

window.addEventListener("online", () => sync());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  // App left open across a month change: jump to the new month.
  if (currentMonth() !== openedMonth && !document.querySelector("tr.editing")) {
    openedMonth = currentMonth();
    viewMonth = clampMonth(openedMonth);
    buildRows();
    render();
  }
  sync();
});
setInterval(() => {
  if (pending.length) sync();
}, 30000);
