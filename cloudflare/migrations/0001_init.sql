-- Two fixed employee slots; names are editable from the app.
CREATE TABLE employees (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
);

INSERT INTO employees (id, name) VALUES (1, 'Empleado 1'), (2, 'Empleado 2');

-- One row per employee per day. A cleared day keeps its row with nulls so the
-- newer timestamp still wins over an older offline edit.
CREATE TABLE entries (
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  date TEXT NOT NULL,              -- YYYY-MM-DD
  horas REAL,
  costo INTEGER,                   -- whole pesos
  updated_at INTEGER NOT NULL,     -- client ms timestamp of the edit
  PRIMARY KEY (employee_id, date)
);

-- Append-only record of every write, so any past value can be recovered even
-- beyond D1's 30-day Time Travel window.
CREATE TABLE edit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at INTEGER NOT NULL,
  kind TEXT NOT NULL,              -- 'entry' | 'name'
  employee_id INTEGER NOT NULL,
  date TEXT,
  horas REAL,
  costo INTEGER,
  name TEXT,
  client_ts INTEGER NOT NULL
);
