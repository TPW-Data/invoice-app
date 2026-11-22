// Monthly Situation dashboard. Same rules as the original Excel sheet:
// - expenses are grouped by month and classification
// - Salary comes from the Salary data (all rows), classification "Salary"
// - Net = sum of the 7 classes; PDV = VAT of every row; Gross = Net + PDV
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const CLASSES = ["Primke", "Transport", "OPEX", "Salary", "Representation", "Marketing", "Investment"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
let entries = [];
let chart = null;

// ---------- auth ----------
sb.auth.onAuthStateChange((_event, session) => {
  $("login-view").hidden = !!session;
  $("app-view").hidden = !session;
  if (session) setTimeout(load, 0); // run after the sign-in step has finished
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
$("year").addEventListener("change", render);

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

async function load() {
  try {
    $("status").textContent = "Loading…";
    const [mer, out, sal, inv] = await Promise.all([
      fetchAll(() => sb.from("mer_rows").select("data").eq("dataset", "mer_archive").order("row_no")),
      fetchAll(() => sb.from("mer_rows").select("data").eq("dataset", "out_of_mer").order("row_no")),
      fetchAll(() => sb.from("mer_rows").select("data").eq("dataset", "salary").order("row_no")),
      fetchAll(() => sb.from("invoices").select("*").order("created_at")),
    ]);

    entries = [];
    for (const { data: d } of mer) {
      entries.push({ date: parseKey(d["Updated Date"]), cls: d["Invoice Classification"], net: num(d["Total Excl. VAT"]), vat: num(d["Total VAT"]) });
    }
    for (const { data: d } of out) {
      entries.push({ date: parseKey(d["Invoice Date"]), cls: d["Invoice Classification"], net: num(d["Net Amount EUR"]), vat: num(d["VAT EUR"]) });
    }
    for (const { data: d } of sal) {
      entries.push({ date: parseKey(d["Datum valute"]), cls: "Salary", net: num(d["Iznos isplate"]), vat: 0 });
    }
    for (const r of inv) {
      entries.push({
        date: parseKey(r.invoice_date || r.created_at),
        cls: r.expense_class,
        net: num(r.net_5) + num(r.net_13) + num(r.net_25),
        vat: num(r.vat_5) + num(r.vat_13) + num(r.vat_25),
      });
    }
    entries = entries.filter((e) => e.date);

    const years = [...new Set(entries.map((e) => e.date.getFullYear()))].sort((a, b) => b - a);
    if (!years.length) years.push(new Date().getFullYear());
    const current = Number($("year").value) || years[0];
    $("year").replaceChildren(...years.map((y) => new Option(String(y), String(y))));
    $("year").value = String(years.includes(current) ? current : years[0]);

    render();
    $("status").textContent = `Updated ${new Date().toLocaleString("hr-HR")} · ${entries.length} rows`;
  } catch (err) {
    const msg = err?.message || JSON.stringify(err);
    $("status").textContent = `Could not load data: ${msg}`;
    console.error("Dashboard load failed:", err);
  }
}

function parseKey(s) {
  const m = String(s ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ---------- calculation ----------
function monthly(year) {
  const grid = MONTHS.map(() => ({ cls: Object.fromEntries(CLASSES.map((c) => [c, 0])), net: 0, vat: 0, gross: 0 }));
  let unmatched = 0;
  for (const e of entries) {
    if (e.date.getFullYear() !== year) continue;
    const m = grid[e.date.getMonth()];
    if (CLASSES.includes(e.cls)) {
      m.cls[e.cls] += e.net;
      m.net += e.net;
    } else {
      unmatched += e.net;
    }
    m.vat += e.vat;
  }
  grid.forEach((m) => (m.gross = m.net + m.vat));
  return { grid, unmatched };
}

// ---------- rendering ----------
const fmt = (n) => Number(n || 0).toLocaleString("hr-HR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function kpi(label, value) {
  const div = document.createElement("div");
  div.className = "kpi";
  const small = document.createElement("small");
  small.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = value;
  div.append(small, strong);
  return div;
}

function cell(text, bold = false) {
  const td = document.createElement("td");
  td.textContent = text;
  if (bold) td.style.fontWeight = "700";
  return td;
}

function render() {
  const year = Number($("year").value);
  const { grid, unmatched } = monthly(year);
  const totals = { cls: Object.fromEntries(CLASSES.map((c) => [c, 0])), net: 0, vat: 0, gross: 0 };
  for (const m of grid) {
    for (const c of CLASSES) totals.cls[c] += m.cls[c];
    totals.net += m.net;
    totals.vat += m.vat;
    totals.gross += m.gross;
  }

  // KPI cards
  const topClass = CLASSES.reduce((best, c) => (totals.cls[c] > totals.cls[best] ? c : best), CLASSES[0]);
  $("kpis").replaceChildren(
    kpi("Net total (EUR)", fmt(totals.net)),
    kpi("PDV total (EUR)", fmt(totals.vat)),
    kpi("Gross total (EUR)", fmt(totals.gross)),
    kpi("Largest class", totals.cls[topClass] ? `${topClass} · ${fmt(totals.cls[topClass])}` : "—")
  );

  // Monthly table (same layout as the original Monthly Situation tab)
  const head = document.createElement("tr");
  for (const h of ["Month", ...CLASSES, "Net", "PDV", "Gross"]) {
    const th = document.createElement("th");
    th.textContent = h;
    head.append(th);
  }
  $("thead").replaceChildren(head);

  const rows = grid.map((m, i) => {
    const tr = document.createElement("tr");
    tr.append(cell(MONTHS[i]));
    for (const c of CLASSES) tr.append(cell(fmt(m.cls[c])));
    tr.append(cell(fmt(m.net), true), cell(fmt(m.vat)), cell(fmt(m.gross), true));
    return tr;
  });
  const tot = document.createElement("tr");
  tot.className = "total";
  tot.append(cell("TOTAL"));
  for (const c of CLASSES) tot.append(cell(fmt(totals.cls[c])));
  tot.append(cell(fmt(totals.net)), cell(fmt(totals.vat)), cell(fmt(totals.gross)));
  $("tbody").replaceChildren(...rows, tot);

  $("note").textContent = unmatched
    ? `Note: ${fmt(unmatched)} EUR of net amounts have a classification outside the 7 classes, so they are not in Net (same as the Excel sheet).`
    : "";

  // Chart: stacked by class
  if (chart) chart.destroy();
  const palette = ["#456733", "#8fb573", "#1f6feb", "#f0a202", "#c0392b", "#8e44ad", "#16a085"];
  chart = new Chart($("chart"), {
    type: "bar",
    data: {
      labels: MONTHS.map((m) => m.slice(0, 3)),
      datasets: CLASSES.map((c, i) => ({
        label: c,
        data: grid.map((m) => m.cls[c]),
        backgroundColor: palette[i],
        stack: "expenses",
      })),
    },
    options: {
      plugins: { legend: { position: "bottom" } },
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
    },
  });
}
