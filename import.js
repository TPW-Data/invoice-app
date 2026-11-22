// Import page: reads the MER workbook (three tabs) and stores each tab in the database.
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

const SHEETS = {
  "MER Archive": "mer_archive",
  "Salary": "salary",
  "Out of MER Racuni": "out_of_mer",
};

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

// ---------- import ----------
$("import-btn").addEventListener("click", async () => {
  const file = $("mer-file").files[0];
  if (!file) return setStatus("Choose the MER Excel file first.", true);
  if (!confirm("This replaces the MER Archive, Salary and Out of MER data with this file. Continue?")) return;
  $("import-btn").disabled = true;
  try {
    setStatus("Reading file…");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const missing = Object.keys(SHEETS).filter((n) => !wb.SheetNames.includes(n));
    if (missing.length) throw new Error(`Missing tab(s) in this file: ${missing.join(", ")}`);

    const counts = [];
    for (const [sheet, dataset] of Object.entries(SHEETS)) {
      const rows = sheetToObjects(wb.Sheets[sheet]);
      setStatus(`Saving ${sheet} (${rows.length} rows)…`);
      await replaceDataset(dataset, rows);
      counts.push(`${sheet} ${rows.length}`);
    }
    setStatus(`Import done: ${counts.join(", ")}.`);
  } catch (err) {
    setStatus(`Import failed: ${err.message}`, true);
  } finally {
    $("import-btn").disabled = false;
  }
});

// Turns a sheet into objects keyed by its header row (line breaks in headers are flattened)
function sheetToObjects(ws) {
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
  if (!aoa.length) return [];
  const headers = aoa[0].map((h) => (h == null ? "" : String(h).replace(/\s+/g, " ").trim()));
  return aoa
    .slice(1)
    .map((row) => {
      const obj = {};
      headers.forEach((h, i) => {
        if (!h) return;
        let v = row[i];
        if (v instanceof Date) v = dateKey(v);
        if (v !== null && v !== undefined && v !== "") obj[h] = v;
      });
      return obj;
    })
    .filter((o) => Object.keys(o).length > 0);
}

async function replaceDataset(dataset, rows) {
  const { error: delError } = await sb.from("mer_rows").delete().eq("dataset", dataset);
  if (delError) throw delError;
  const records = rows.map((data, i) => ({ dataset, row_no: i + 1, data }));
  for (let i = 0; i < records.length; i += 200) {
    const { error } = await sb.from("mer_rows").insert(records.slice(i, i + 200));
    if (error) throw error;
  }
}

// ---------- helpers ----------
function dateKey(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function setStatus(msg, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.className = isError ? "error" : "";
}
