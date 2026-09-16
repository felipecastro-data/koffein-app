// koffein — time tracker interactivity

const STORAGE_KEY = "koffein-data";
const ROWS_PER_EMPLOYEE = 31;

function createDefaultState() {
  return {
    employees: [
      { id: 1, name: "Empleado 1", collapsed: true, rows: makeEmptyRows() },
      { id: 2, name: "Empleado 2", collapsed: true, rows: makeEmptyRows() },
    ],
  };
}

function makeEmptyRows() {
  return Array.from({ length: ROWS_PER_EMPLOYEE }, () => ({ horas: null, costo: null }));
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      parsed.employees.forEach((employee) => {
        if (typeof employee.collapsed !== "boolean") employee.collapsed = false;
        while (employee.rows.length < ROWS_PER_EMPLOYEE) {
          employee.rows.push({ horas: null, costo: null });
        }
      });
      return parsed;
    } catch (e) {
      // fall through to default below
    }
  }
  const fresh = createDefaultState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function formatPesos(n) {
  return Math.round(n || 0).toLocaleString("es-CO");
}

function formatHoras(n) {
  return String(n).replace(".", ",");
}

function parseHoras(raw) {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = parseFloat(trimmed.replace(",", "."));
  if (Number.isNaN(value) || value < 0) return null;
  return value;
}

const state = loadState();

function render() {
  const cards = document.querySelectorAll(".employee-card");
  let grandTotalCosto = 0;

  state.employees.forEach((employee, empIndex) => {
    const card = cards[empIndex];
    if (!card) return;

    const nameEl = card.querySelector(".employee-name");
    const avatarEl = card.querySelector(".avatar");

    if (document.activeElement !== nameEl) {
      nameEl.textContent = employee.name;
    }
    avatarEl.textContent = (employee.name.trim().charAt(0) || "?").toUpperCase();

    const trs = card.querySelectorAll("tbody tr");
    let hoursSum = 0;
    let costoSum = 0;

    employee.rows.forEach((row, rowIndex) => {
      hoursSum += row.horas || 0;
      costoSum += row.costo || 0;

      const tr = trs[rowIndex];
      if (!tr || tr.classList.contains("editing")) return;

      const horasTd = tr.querySelector(".col-hours");
      const costoTd = tr.querySelector(".col-cost");
      horasTd.textContent = row.horas != null ? formatHoras(row.horas) : "";
      costoTd.textContent = row.costo != null ? formatPesos(row.costo) : "";
    });

    grandTotalCosto += costoSum;

    card.querySelector(".hours-total").textContent = formatHoras(hoursSum);
    card.querySelector(".cost-total").textContent = "$" + formatPesos(costoSum);
  });

  document.querySelector(".summary-total").textContent = "$" + formatPesos(grandTotalCosto);
}

function activateRowEdit(empIndex, rowIndex, tr, focusField) {
  tr.classList.add("editing");

  const row = state.employees[empIndex].rows[rowIndex];
  const horasTd = tr.querySelector(".col-hours");
  const costoTd = tr.querySelector(".col-cost");

  horasTd.innerHTML = "";
  const horasInput = document.createElement("input");
  horasInput.type = "text";
  horasInput.inputMode = "decimal";
  horasInput.placeholder = "—";
  horasInput.className = "cell-input";
  if (row.horas != null) horasInput.value = formatHoras(row.horas);
  horasTd.appendChild(horasInput);

  costoTd.innerHTML = "";
  const costoInput = document.createElement("input");
  costoInput.type = "number";
  costoInput.step = "1";
  costoInput.inputMode = "numeric";
  costoInput.placeholder = "—";
  costoInput.className = "cell-input";
  if (row.costo != null) costoInput.value = row.costo;
  costoTd.appendChild(costoInput);

  let done = false;

  function commit() {
    if (done) return;
    done = true;

    const newCosto = costoInput.value === "" ? null : parseFloat(costoInput.value);
    row.horas = parseHoras(horasInput.value);
    row.costo = Number.isNaN(newCosto) ? null : newCosto;

    saveState();
    tr.classList.remove("editing");
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

function initRowEditing() {
  document.querySelectorAll(".employee-card").forEach((card, empIndex) => {
    card.querySelectorAll("tbody tr").forEach((tr, rowIndex) => {
      tr.addEventListener("click", (e) => {
        if (tr.classList.contains("editing")) return;
        const focusField = e.target.closest(".col-cost") ? "costo" : "horas";
        activateRowEdit(empIndex, rowIndex, tr, focusField);
      });
    });
  });
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

function initAccordion() {
  document.querySelectorAll(".employee-card").forEach((card, empIndex) => {
    const header = card.querySelector(".employee-header");
    const wrap = card.querySelector(".table-wrap");
    const employee = state.employees[empIndex];

    wrap.style.transition = "none";
    setCardExpanded(card, !employee.collapsed);
    void wrap.offsetHeight;
    wrap.style.transition = "";

    header.addEventListener("click", (e) => {
      if (e.target.closest(".employee-name")) return;
      const expanded = !wrap.classList.contains("expanded");
      employee.collapsed = !expanded;
      saveState();
      setCardExpanded(card, expanded);
    });
  });
}

function initNameEditing() {
  document.querySelectorAll(".employee-name").forEach((nameEl, empIndex) => {
    nameEl.addEventListener("blur", () => {
      const newName = nameEl.textContent.trim() || `Empleado ${empIndex + 1}`;
      state.employees[empIndex].name = newName;
      saveState();
      render();
    });

    nameEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        nameEl.blur();
      }
    });
  });
}

function initResetModal() {
  const resetBtn = document.getElementById("reset-btn");
  const modal = document.getElementById("reset-modal");
  const cancelBtn = document.getElementById("reset-cancel");
  const confirmBtn = document.getElementById("reset-confirm");

  function openModal() {
    modal.hidden = false;
  }

  function closeModal() {
    modal.hidden = true;
  }

  resetBtn.addEventListener("click", openModal);
  cancelBtn.addEventListener("click", closeModal);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) closeModal();
  });

  confirmBtn.addEventListener("click", () => {
    state.employees.forEach((employee) => {
      employee.rows = makeEmptyRows();
      employee.collapsed = true;
    });
    saveState();

    document.querySelectorAll(".employee-card").forEach((card, empIndex) => {
      setCardExpanded(card, !state.employees[empIndex].collapsed);
    });

    closeModal();
    render();
  });
}

initRowEditing();
initNameEditing();
initAccordion();
initResetModal();
render();
