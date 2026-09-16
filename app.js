// koffein — time tracker interactivity

const STORAGE_KEY = "koffein-data";
const ROWS_PER_EMPLOYEE = 15;

function createDefaultState() {
  return {
    employees: [
      { id: 1, name: "Empleado 1", rows: makeEmptyRows() },
      { id: 2, name: "Empleado 2", rows: makeEmptyRows() },
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
      return JSON.parse(raw);
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
  return String(n);
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
  horasInput.type = "number";
  horasInput.step = "0.5";
  horasInput.inputMode = "decimal";
  horasInput.placeholder = "—";
  horasInput.className = "cell-input";
  if (row.horas != null) horasInput.value = row.horas;
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

    const newHoras = horasInput.value === "" ? null : parseFloat(horasInput.value);
    const newCosto = costoInput.value === "" ? null : parseFloat(costoInput.value);
    row.horas = Number.isNaN(newHoras) ? null : newHoras;
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

initRowEditing();
initNameEditing();
render();
