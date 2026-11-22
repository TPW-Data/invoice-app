// Updates the MER workbook: keeps the four tabs, adds the app's invoices as "Uploaded Invoices",
// and extends the Monthly Situation formulas so those invoices are counted by date and classification.
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

const KEEP = ["MER Archive", "Salary", "Out of MER Racuni", "Monthly Situation"];
const UP_SHEET = "Uploaded Invoices";
const UP_HEADER = [
  "Invoice Date", "Invoice Number", "Company Name", "Amount Net (Original)", "CUR",
  "Net Amount EUR", "VAT EUR", "Gross Total EUR", "Document Type / Notes",
  "Invoice Classification", "Secondary Class",
];
const LAST_ROW = 9975; // same range the original Monthly Situation formulas use
const CLASS_COLS = ["D", "E", "F", "G", "H", "I", "J"]; // Primke … Investment
let fileBuffer = null;

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

// ---------- step 1: read the MER file ----------
$("mer-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  fileBuffer = null;
  $("download-btn").disabled = true;
  if (!file) return;
  try {
    setStatus("Reading file…");
    const buffer = await file.arrayBuffer();
    const wb = readWorkbook(buffer);
    const missing = KEEP.filter((n) => !wb.SheetNames.includes(n));
    if (missing.length) throw new Error(`Missing tab(s) in this file: ${missing.join(", ")}`);
    fileBuffer = buffer;
    $("download-btn").disabled = false;
    setStatus("File read. Press the button to create the updated file.");
  } catch (err) {
    setStatus(err.message, true);
  }
});

function readWorkbook(buffer) {
  return XLSX.read(buffer, { type: "array", cellFormula: true, cellDates: true, cellStyles: true });
}

// ---------- step 2: build and download ----------
$("download-btn").addEventListener("click", async () => {
  if (!fileBuffer) return;
  const btn = $("download-btn");
  btn.disabled = true;
  try {
    setStatus("Loading invoices from the app…");
    const { data, error } = await sb.from("invoices").select("*").order("created_at", { ascending: true }).limit(10000);
    if (error) throw error;

    // Fresh copy of the file each time, so formulas are never extended twice
    const src = readWorkbook(fileBuffer);
    const ms = src.Sheets["Monthly Situation"];
    addUploadedToSummary(ms);

    const upRows = data.map(toUploadedRow);
    const upSheet = XLSX.utils.aoa_to_sheet([UP_HEADER, ...upRows], { cellDates: true });
    for (let i = 2; i <= upRows.length + 1; i++) {
      const cell = upSheet[`A${i}`];
      if (cell) cell.z = "dd.mm.yyyy";
    }

    const out = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(out, src.Sheets["MER Archive"], "MER Archive");
    XLSX.utils.book_append_sheet(out, src.Sheets["Salary"], "Salary");
    XLSX.utils.book_append_sheet(out, src.Sheets["Out of MER Racuni"], "Out of MER Racuni");
    XLSX.utils.book_append_sheet(out, upSheet, UP_SHEET);
    XLSX.utils.book_append_sheet(out, ms, "Monthly Situation");
    out.Workbook = { CalcPr: { fullCalcOnLoad: true } }; // Excel recalculates everything on open

    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(out, `Plant_Olive_MER_${stamp}.xlsx`);
    setStatus(`Done. ${upRows.length} app invoice(s) added to "${UP_SHEET}" and Monthly Situation.`);
  } catch (err) {
    setStatus(`Could not create the file: ${err.message}`, true);
  } finally {
    btn.disabled = false;
  }
});

function toUploadedRow(r) {
  const net = round2(Number(r.net_5) + Number(r.net_13) + Number(r.net_25));
  const vat = round2(Number(r.vat_5) + Number(r.vat_13) + Number(r.vat_25));
  return [
    parseDate(r.invoice_date || r.created_at),
    r.invoice_number,
    r.company_name,
    net,
    "EUR",
    net,
    vat,
    round2(Number(r.gross_total)),
    "Uploaded invoice (app)",
    r.expense_class || "",
    null,
  ];
}

// Adds an Uploaded Invoices term to every Monthly Situation formula, using the same
// date and classification logic as the existing Out of MER Racuni terms.
function addUploadedToSummary(ms) {
  const U = "'Uploaded Invoices'";
  const term = (valCol, r, classCol) => {
    let t = `+SUMIFS(${U}!$${valCol}$2:$${valCol}$${LAST_ROW},${U}!$A$2:$A$${LAST_ROW},">="&DATE($D$1,$B${r},1),${U}!$A$2:$A$${LAST_ROW},"<="&DATE($D$1,$B${r},$A${r})`;
    if (classCol) t += `,${U}!$J$2:$J$${LAST_ROW},'Monthly Situation'!${classCol}$2`;
    return t + ")";
  };
  for (let r = 3; r <= 14; r++) {
    for (const col of CLASS_COLS) {
      const cell = ms[`${col}${r}`];
      if (!cell || typeof cell.f !== "string") throw new Error(`Unexpected layout in Monthly Situation at ${col}${r}`);
      cell.f += term("F", r, col); // Net Amount EUR, by classification
    }
    const pdv = ms[`L${r}`];
    if (!pdv || typeof pdv.f !== "string") throw new Error(`Unexpected layout in Monthly Situation at L${r}`);
    pdv.f += term("G", r, null); // VAT EUR
  }
  // Drop stale cached results so every formula is recalculated
  for (const addr of Object.keys(ms)) {
    if (addr.startsWith("!")) continue;
    if (ms[addr] && ms[addr].f) {
      delete ms[addr].v;
      delete ms[addr].w;
    }
  }
}

// ---------- helpers ----------
function parseDate(s) {
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function setStatus(msg, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.className = isError ? "error" : "";
}
