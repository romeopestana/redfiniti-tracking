// Simple in-browser leave management (data lives in localStorage).
// Baseline: all starting balances are effective from 1 Jan 2026.

const STORAGE_KEY = "leave-manager-employees-v1";
const BASELINE_YEAR = 2026;
const BASELINE_MONTH_INDEX = 0; // January (0-based)

function loadEmployees() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function saveEmployees(employees) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(employees));
}

function createEmployee(data) {
  const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  return {
    id,
    name: data.name,
    startDisplay: data.startDisplay, // MM/YY text
    annualStart: data.annualStart,
    sickStart: data.sickStart,
    familyStart: data.familyStart,
    studyStart: data.studyStart,
    religiousStart: data.religiousStart,
    annualAccrualPerMonth: data.annualAccrualPerMonth,
    // Each transaction: { type, days, dateISO }
    transactions: [],
  };
}

function addTransaction(employees, employeeId, tx) {
  const idx = employees.findIndex((e) => e.id === employeeId);
  if (idx === -1) return employees;
  const emp = employees[idx];
  const updated = {
    ...emp,
    transactions: [
      ...emp.transactions,
      {
        type: tx.type,
        days: tx.days,
        dateISO: tx.dateISO,
      },
    ],
  };
  const next = [...employees];
  next[idx] = updated;
  return next;
}

// --- Balance calculation helpers ---

function monthsSinceBaseline(date) {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-based
  return (year - BASELINE_YEAR) * 12 + (month - BASELINE_MONTH_INDEX);
}

function getBalancesForEmployee(emp, asOfDate = new Date()) {
  const txs = Array.isArray(emp.transactions) ? emp.transactions : [];

  const months = Math.max(0, monthsSinceBaseline(asOfDate));
  const accrued = emp.annualAccrualPerMonth * months;

  let annualTaken = 0;
  let sickTaken = 0;
  let familyTaken = 0;
  let studyTaken = 0;
  let religiousTaken = 0;

  const currentYear = asOfDate.getFullYear();

  for (const tx of txs) {
    const days = Number(tx.days) || 0;
    if (!days) continue;
    const d = tx.dateISO ? new Date(tx.dateISO) : asOfDate;
    const year = d.getFullYear();

    switch (tx.type) {
      case "annual":
        annualTaken += days;
        break;
      case "sick":
        if (year === currentYear) sickTaken += days;
        break;
      case "family":
        if (year === currentYear) familyTaken += days;
        break;
      case "study":
        if (year === currentYear) studyTaken += days;
        break;
      case "religious":
        if (year === currentYear) religiousTaken += days;
        break;
      default:
        break;
    }
  }

  const annual = emp.annualStart + accrued - annualTaken;
  const sick = emp.sickStart - sickTaken;
  const family = emp.familyStart - familyTaken;
  const study = emp.studyStart - studyTaken;
  const religious = emp.religiousStart - religiousTaken;

  const clamp = (v) => Math.round((v + Number.EPSILON) * 10) / 10;

  return {
    annual: clamp(Math.max(0, annual)),
    sick: clamp(Math.max(0, sick)),
    family: clamp(Math.max(0, family)),
    study: clamp(Math.max(0, study)),
    religious: clamp(Math.max(0, religious)),
  };
}

// --- Rendering ---

function renderCurrentDate() {
  const el = document.getElementById("current-date-label");
  if (!el) return;
  const now = new Date();
  const fmt = now.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  el.textContent = fmt;
}

function renderEmployeesTable(employees) {
  const tbody = document.getElementById("employees-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!employees.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.className = "muted";
    td.textContent = "No employees yet. Create one on the right.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  const now = new Date();

  for (const emp of employees) {
    const balances = getBalancesForEmployee(emp, now);
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.textContent = emp.name;

    const startTd = document.createElement("td");
    startTd.textContent = emp.startDisplay || "";
    startTd.className = "cell-small muted";

    const annualTd = document.createElement("td");
    annualTd.className = "cell-small";
    annualTd.textContent = balances.annual.toFixed(1);

    const sickTd = document.createElement("td");
    sickTd.className = "cell-small";
    sickTd.textContent = balances.sick.toFixed(1);

    const familyTd = document.createElement("td");
    familyTd.className = "cell-small";
    familyTd.textContent = balances.family.toFixed(1);

    const studyTd = document.createElement("td");
    studyTd.className = "cell-small";
    studyTd.textContent = balances.study.toFixed(1);

    const relTd = document.createElement("td");
    relTd.className = "cell-small";
    relTd.textContent = balances.religious.toFixed(1);

    const accrualTd = document.createElement("td");
    accrualTd.className = "cell-small muted";
    accrualTd.textContent = (emp.annualAccrualPerMonth || 0).toFixed(2);

    tr.appendChild(nameTd);
    tr.appendChild(startTd);
    tr.appendChild(annualTd);
    tr.appendChild(sickTd);
    tr.appendChild(familyTd);
    tr.appendChild(studyTd);
    tr.appendChild(relTd);
    tr.appendChild(accrualTd);

    tbody.appendChild(tr);
  }
}

function renderEmployeeSelect(employees) {
  const sel = document.getElementById("leave-employee");
  if (!sel) return;
  const currentValue = sel.value;
  sel.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select employee";
  sel.appendChild(placeholder);

  for (const emp of employees) {
    const opt = document.createElement("option");
    opt.value = emp.id;
    opt.textContent = emp.name;
    sel.appendChild(opt);
  }

  if (employees.some((e) => e.id === currentValue)) {
    sel.value = currentValue;
  }
}

// --- Validation helpers ---

function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!msg) {
    el.style.display = "none";
    el.textContent = "";
  } else {
    el.style.display = "block";
    el.textContent = msg;
  }
}

function parseMMYY(str) {
  const trimmed = (str || "").trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const yearTwoDigits = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const fullYear = 2000 + yearTwoDigits;
  return { month, year: fullYear };
}

// --- Event wiring ---

function setupEmployeeForm() {
  const form = document.getElementById("employee-form");
  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    showError("employee-form-error", "");

    const name = document.getElementById("emp-name").value.trim();
    const startText = document.getElementById("emp-start").value.trim();
    const mmYY = parseMMYY(startText);
    const annualStart = Number(document.getElementById("emp-annual").value || "0");
    const sickStart = Number(document.getElementById("emp-sick").value || "0");
    const familyStart = Number(document.getElementById("emp-family").value || "0");
    const studyStart = Number(document.getElementById("emp-study").value || "0");
    const religiousStart = Number(
      document.getElementById("emp-religious").value || "0",
    );
    const accrual = Number(document.getElementById("emp-accrual").value || "0");

    if (!name) {
      showError("employee-form-error", "Please enter an employee name.");
      return;
    }
    if (!mmYY) {
      showError(
        "employee-form-error",
        "Start date must be in MM/YY format, e.g. 01/26.",
      );
      return;
    }
    if (annualStart < 0 || accrual < 0) {
      showError(
        "employee-form-error",
        "Annual leave and accrual must be zero or positive.",
      );
      return;
    }

    const employees = loadEmployees();
    const newEmp = createEmployee({
      name,
      startDisplay: startText,
      annualStart,
      sickStart,
      familyStart,
      studyStart,
      religiousStart,
      annualAccrualPerMonth: accrual,
    });

    const updated = [...employees, newEmp];
    saveEmployees(updated);
    renderEmployeesTable(updated);
    renderEmployeeSelect(updated);

    form.reset();
  });

  const resetBtn = document.getElementById("reset-all");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (
        !confirm(
          "This will remove all employees and history stored in this browser. Continue?",
        )
      ) {
        return;
      }
      saveEmployees([]);
      renderEmployeesTable([]);
      renderEmployeeSelect([]);
    });
  }
}

function setupLeaveForm() {
  const form = document.getElementById("leave-form");
  if (!form) return;

  // Default leave date to today
  const leaveDateInput = document.getElementById("leave-date");
  if (leaveDateInput) {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    leaveDateInput.value = `${yyyy}-${mm}-${dd}`;
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    showError("leave-form-error", "");

    const employeeId = document.getElementById("leave-employee").value;
    const type = document.getElementById("leave-type").value;
    const days = Number(document.getElementById("leave-days").value || "0");
    const dateStr = document.getElementById("leave-date").value;

    if (!employeeId) {
      showError("leave-form-error", "Please select an employee.");
      return;
    }
    if (!type) {
      showError("leave-form-error", "Please select a leave type.");
      return;
    }
    if (!days || days <= 0) {
      showError("leave-form-error", "Please enter a positive number of days.");
      return;
    }

    const dateISO = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();

    let employees = loadEmployees();
    const emp = employees.find((eEmp) => eEmp.id === employeeId);
    if (!emp) {
      showError("leave-form-error", "Selected employee could not be found.");
      return;
    }

    // Prevent overdrawing beyond current balance.
    const balances = getBalancesForEmployee(emp, new Date(dateISO));
    const remaining = balances[type] ?? 0;
    if (days > remaining + 0.0001) {
      showError(
        "leave-form-error",
        `Not enough ${type} leave. Available: ${remaining.toFixed(
          1,
        )} days, requested: ${days.toFixed(1)} days.`,
      );
      return;
    }

    employees = addTransaction(employees, employeeId, {
      type,
      days,
      dateISO,
    });
    saveEmployees(employees);
    renderEmployeesTable(employees);
    renderEmployeeSelect(employees);

    (document.getElementById("leave-days")).value = "";
  });
}

// --- Boot ---

document.addEventListener("DOMContentLoaded", () => {
  renderCurrentDate();
  const employees = loadEmployees();
  renderEmployeesTable(employees);
  renderEmployeeSelect(employees);
  setupEmployeeForm();
  setupLeaveForm();
});

