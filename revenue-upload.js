// Upload page for revenue: reads "Promet MP" and "Promet VP" and replaces the stored revenue rows.
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

const SHEETS = { "Promet MP": "promet_mp", "Promet VP": "promet_vp" };

// ---------- auth ----------
sb.auth.onAuthStateChange((_event, session) => {
  $("login-view").hidden = !!session;
  $("app-view").hidden = !session;
});

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value,
  });
  $("login-msg").textContent = error ? "Wrong email or password." : "";
  if (!error) $("password").value = "";
});

$("logout-btn").addEventListener("click", () => sb.auth.signOut());

// ---------- upload ----------
$("import-btn").addEventListener("click", async () => {
  const file = $("rev-file").files[0];
  if (!file) return setStatus("Choose the Excel file first.", true);
  if (!confirm("This replaces all revenue data (Promet MP and Promet VP) with this file. Continue?")) return;
  $("import-btn").disabled = true;
  try {
    setStatus("Reading file…");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const missing = Object.keys(SHEETS).filter((n) => !wb.SheetNames.includes(n));
    if (missing.length) throw new Error(`Missing tab(s) in this file: ${missing.join(", ")}`);

    const counts = [];
    for (const [sheet, dataset] of Object.entries(SHEETS)) {
      const { rows, skipped } = sheetToRows(wb.Sheets[sheet], sheet, dataset);
      setStatus(`Saving ${sheet} (${rows.length} rows)…`);
      await replaceDataset(dataset, rows);
      counts.push(`${sheet} ${rows.length}${skipped ? ` (${skipped} rows without a date skipped)` : ""}`);
    }
    setStatus(`Upload done: ${counts.join(", ")}.`);
  } catch (err) {
    setStatus(`Upload failed: ${err.message}`, true);
  } finally {
    $("import-btn").disabled = false;
  }
});

// Finds the header row (the workbook has a total line above it in Promet MP), then keeps only the needed columns.
function sheetToRows(ws, sheetName, dataset) {
  const cols = REVENUE_COLUMNS[dataset];
  const needed = [cols.date, cols.revenue, cols.vat, cols.profit];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });

  const headerIndex = aoa.slice(0, 6).findIndex((row) => {
    const names = row.map((h) => (h == null ? "" : String(h).replace(/\s+/g, " ").trim()));
    return needed.every((n) => names.includes(n));
  });
  if (headerIndex < 0) {
    throw new Error(`Columns not found in "${sheetName}": ${needed.join(", ")}`);
  }

  const names = aoa[headerIndex].map((h) => (h == null ? "" : String(h).replace(/\s+/g, " ").trim()));
  const at = Object.fromEntries(needed.map((n) => [n, names.indexOf(n)]));
  const rows = [];
  let skipped = 0;
  for (const row of aoa.slice(headerIndex + 1)) {
    const d = row[at[cols.date]];
    const key = d instanceof Date ? dateKey(d) : String(d ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      if (d !== null && d !== undefined && d !== "") skipped++;
      continue;
    }
    rows.push({
      [cols.date]: key,
      [cols.revenue]: numOrZero(row[at[cols.revenue]]),
      [cols.vat]: numOrZero(row[at[cols.vat]]),
      [cols.profit]: numOrZero(row[at[cols.profit]]),
    });
  }
  return { rows, skipped };
}

function numOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function replaceDataset(dataset, rows) {
  const { error: delError } = await sb.from("revenue_rows").delete().eq("dataset", dataset);
  if (delError) throw delError;
  const records = rows.map((data, i) => ({ dataset, row_no: i + 1, data }));
  for (let i = 0; i < records.length; i += 200) {
    const { error } = await sb.from("revenue_rows").insert(records.slice(i, i + 200));
    if (error) throw error;
  }
}

function dateKey(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function setStatus(msg, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.className = isError ? "error" : "";
}
