// One table per page. The menu link decides which one: table.html?t=mer_archive | salary | out_of_mer | uploaded
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

const TABLES = {
  mer_archive: "MER Archive",
  salary: "Salary",
  out_of_mer: "Out of MER Racuni",
  uploaded: "Uploaded Invoices",
  promet_mp: "MP",
  promet_vp: "VP",
};
const UP_HEADER = [
  "Invoice Date", "Invoice Number", "Company Name", "Amount Net (Original)", "CUR",
  "Net Amount EUR", "VAT EUR", "Gross Total EUR", "Document Type / Notes",
  "Invoice Classification", "Secondary Class",
];

const requested = new URLSearchParams(window.location.search).get("t");
const known = Object.hasOwn(TABLES, requested);
const dataset = known ? requested : null;
const tableTitle = known ? TABLES[dataset] : "Unknown table";
$("title").textContent = tableTitle;
document.title = `Plant Olive – ${tableTitle}`;

let cache = null; // { headers, rows } for this table, loaded once per visit

// ---------- auth ----------
sb.auth.onAuthStateChange((_event, session) => {
  $("login-view").hidden = !!session;
  $("app-view").hidden = !session;
  if (session) setTimeout(loadAndDraw, 0); // run after the sign-in step has finished
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
$("search").addEventListener("input", () => cache && draw());

// ---------- data ----------
// Supabase returns at most 1000 rows per request, so read in pages
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

async function loadRows() {
  if (dataset === "promet_mp" || dataset === "promet_vp") {
    // Revenue tabs: every column of the uploaded sheet, in the original order (saved in the first stored row)
    const data = await fetchAll(() =>
      sb.from("revenue_rows").select("data").eq("dataset", dataset).order("row_no")
    );
    const headerRow = data.find((r) => r.data && r.data.__headers);
    const headers = headerRow ? headerRow.data.__headers : Object.values(REVENUE_COLUMNS[dataset]);
    const rows = data.filter((r) => !(r.data && r.data.__headers)).map((r) => r.data);
    return { headers, rows };
  }
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

async function loadAndDraw() {
  if (!known) {
    setStatus(`Unknown table "${requested ?? ""}". Open it from the menu.`, true);
    return;
  }
  try {
    setStatus("Loading…");
    cache = await loadRows();
    draw();
    setStatus("");
  } catch (err) {
    setStatus(`Could not load table: ${err?.message || JSON.stringify(err)}`, true);
    console.error("Table load failed:", err);
  }
}

// ---------- drawing ----------
function draw() {
  const { headers, rows } = cache;
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
}

function setStatus(msg, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.className = isError ? "error" : "";
}
