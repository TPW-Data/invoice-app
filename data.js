// Data Tables: imports the MER workbook (three tabs) into the database and shows every table.
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

const SHEETS = {
  "MER Archive": "mer_archive",
  "Salary": "salary",
  "Out of MER Racuni": "out_of_mer",
};
const UP_HEADER = [
  "Invoice Date", "Invoice Number", "Company Name", "Amount Net (Original)", "CUR",
  "Net Amount EUR", "VAT EUR", "Gross Total EUR", "Document Type / Notes",
  "Invoice Classification", "Secondary Class",
];

// ---------- auth ----------
sb.auth.onAuthStateChange((_event, session) => {
  $("login-view").hidden = !!session;
  $("app-view").hidden = !session;
  if (session) renderTable();
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
$("dataset").addEventListener("change", renderTable);
$("search").addEventListener("input", renderTable);

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
    renderTable();
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

// ---------- tables ----------
async function fetchAll(build) {
  const out = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await build().range(from, from + size - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}

async function loadRows(dataset) {
  if (dataset === "uploaded") {
    const inv = await fetchAll(() => sb.from("invoices").select("*").order("created_at"));
    return {
      headers: UP_HEADER,
      rows: inv.map((r) => {
        const net = Number(r.net_5) + Number(r.net_13) + Number(r.net_25);
        const vat = Number(r.vat_5) + Number(r.vat_13) + Number(r.vat_25);
        return {
          "Invoice Date": r.invoice_date || r.created_at.slice(0, 10),
          "Invoice Number": r.invoice_number,
          "Company Name": r.company_name,
          "Amount Net (Original)": net,
          "CUR": "EUR",
          "Net Amount EUR": net,
          "VAT EUR": vat,
          "Gross Total EUR": Number(r.gross_total),
          "Document Type / Notes": "Uploaded invoice (app)",
          "Invoice Classification": r.expense_class,
          "Secondary Class": null,
        };
      }),
    };
  }
  const data = await fetchAll(() =>
    sb.from("mer_rows").select("data").eq("dataset", dataset).order("row_no")
  );
  const rows = data.map((r) => r.data);
  // Column order = order in which keys first appear
  const headers = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!headers.includes(k)) headers.push(k);
  return { headers, rows };
}

async function renderTable() {
  if (!$("app-view") || $("app-view").hidden) return;
  try {
    const dataset = $("dataset").value;
    setStatus("Loading…");
    const { headers, rows } = await loadRows(dataset);

    const q = $("search").value.trim().toLowerCase();
    const shown = q
      ? rows.filter((r) => headers.some((h) => String(r[h] ?? "").toLowerCase().includes(q)))
      : rows;

    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    for (const h of headers) {
      const th = document.createElement("th");
      th.textContent = h;
      hr.append(th);
    }
    thead.append(hr);

    const tbody = document.createElement("tbody");
    for (const r of shown) {
      const tr = document.createElement("tr");
      for (const h of headers) {
        const td = document.createElement("td");
        const v = r[h];
        if (typeof v === "number") {
          td.className = "num";
          td.textContent = v.toLocaleString("hr-HR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ""))) {
          const [y, m, d] = String(v).split("-");
          td.textContent = `${d}.${m}.${y}.`;
        } else {
          td.textContent = v ?? "";
        }
        tr.append(td);
      }
      tbody.append(tr);
    }
    $("table").replaceChildren(thead, tbody);
    $("count").textContent = `${shown.length} of ${rows.length} rows`;
    setStatus("");
  } catch (err) {
    setStatus(`Could not load table: ${err.message}`, true);
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
