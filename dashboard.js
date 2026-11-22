// Monthly Situation dashboard. Same rules as the original Excel sheet:
// - expenses are grouped by month and classification
// - Salary comes from the Salary data (all rows), classification "Salary"
// - Net = sum of the 7 classes; PDV = VAT of every row; Gross = Net + PDV
// Interactive: year and month selectors, click a month bar to focus on it,
// and show or hide each classification on the charts.
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const CLASSES = ["Primke", "Transport", "OPEX", "Salary", "Representation", "Marketing", "Investment"];
const COLORS = ["#456733", "#8fb573", "#1f6feb", "#f0a202", "#c0392b", "#8e44ad", "#16a085"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

let entries = [];
let year = null;
let month = null;          // null = whole year, otherwise 0..11
const hidden = new Set();  // classifications hidden on the charts
let barChart = null;
let pieChart = null;

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
$("year").addEventListener("change", () => { year = Number($("year").value); render(); });
$("month").addEventListener("change", () => setMonth($("month").value === "" ? null : Number($("month").value)));

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
    year = years.includes(year) ? year : years[0];
    $("year").replaceChildren(...years.map((y) => new Option(String(y), String(y))));
    $("year").value = String(year);
    $("month").replaceChildren(new Option("Whole year", ""), ...MONTHS.map((m, i) => new Option(m, String(i))));
    $("month").value = month === null ? "" : String(month);

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
function monthly(y) {
  const grid = MONTHS.map(() => ({ cls: Object.fromEntries(CLASSES.map((c) => [c, 0])), net: 0, vat: 0, gross: 0 }));
  let unmatched = 0;
  for (const e of entries) {
    if (e.date.getFullYear() !== y) continue;
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

function sumGrid(list) {
  const out = { cls: Object.fromEntries(CLASSES.map((c) => [c, 0])), net: 0, vat: 0, gross: 0 };
  for (const m of list) {
    for (const c of CLASSES) out.cls[c] += m.cls[c];
    out.net += m.net;
    out.vat += m.vat;
    out.gross += m.gross;
  }
  return out;
}

// ---------- interaction ----------
function setMonth(m) {
  month = m;
  $("month").value = m === null ? "" : String(m);
  render();
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
  if (year === null) return;
  const { grid, unmatched } = monthly(year);
  const label = month === null ? `${year}` : `${MONTHS[month]} ${year}`;
  const period = sumGrid(month === null ? grid : [grid[month]]);
  const yearTotals = sumGrid(grid);

  $("period").textContent = `Showing: ${label}`;

  // KPI cards (always all classes, the chips only affect the charts)
  const topClass = CLASSES.reduce((best, c) => (period.cls[c] > period.cls[best] ? c : best), CLASSES[0]);
  $("kpis").replaceChildren(
    kpi("Net (EUR)", fmt(period.net)),
    kpi("PDV (EUR)", fmt(period.vat)),
    kpi("Gross (EUR)", fmt(period.gross)),
    kpi("Largest class", period.cls[topClass] ? `${topClass} · ${fmt(period.cls[topClass])}` : "—")
  );

  renderChips();

  // Monthly table; click a row to focus that month
  const head = document.createElement("tr");
  for (const h of ["Month", ...CLASSES, "Net", "PDV", "Gross"]) {
    const th = document.createElement("th");
    th.textContent = h;
    head.append(th);
  }
  $("thead").replaceChildren(head);

  const rows = grid.map((m, i) => {
    const tr = document.createElement("tr");
    if (i === month) tr.className = "selected";
    tr.addEventListener("click", () => setMonth(month === i ? null : i));
    tr.append(cell(MONTHS[i]));
    for (const c of CLASSES) tr.append(cell(fmt(m.cls[c])));
    tr.append(cell(fmt(m.net), true), cell(fmt(m.vat)), cell(fmt(m.gross), true));
    return tr;
  });
  const tot = document.createElement("tr");
  tot.className = "total";
  tot.append(cell(`TOTAL ${year}`));
  for (const c of CLASSES) tot.append(cell(fmt(yearTotals.cls[c])));
  tot.append(cell(fmt(yearTotals.net)), cell(fmt(yearTotals.vat)), cell(fmt(yearTotals.gross)));
  $("tbody").replaceChildren(...rows, tot);

  $("note").textContent = unmatched
    ? `Note: ${fmt(unmatched)} EUR of net amounts have a classification outside the 7 classes, so they are not in Net (same as the Excel sheet).`
    : "";

  renderBarChart(grid);
  renderPieChart(period);
}

// Classification chips: tap to hide or show that group on the charts
function renderChips() {
  const chips = CLASSES.map((c, i) => {
    const b = document.createElement("button");
    b.type = "button";
    const isHidden = hidden.has(c);
    b.className = "chip" + (isHidden ? " off" : "");
    b.setAttribute("aria-pressed", String(!isHidden));
    b.style.setProperty("--c", COLORS[i]);
    const sw = document.createElement("span");
    sw.className = "swatch";
    b.append(sw, c);
    b.addEventListener("click", () => {
      if (hidden.has(c)) hidden.delete(c);
      else hidden.add(c);
      render();
    });
    return b;
  });
  if (hidden.size) {
    const all = document.createElement("button");
    all.type = "button";
    all.className = "chip all";
    all.textContent = "Show all";
    all.addEventListener("click", () => { hidden.clear(); render(); });
    chips.push(all);
  }
  $("chips").replaceChildren(...chips);
}

function renderBarChart(grid) {
  if (barChart) barChart.destroy();
  barChart = new Chart($("chart"), {
    type: "bar",
    data: {
      labels: MONTHS.map((m) => m.slice(0, 3)),
      datasets: CLASSES.map((c, i) => ({
        label: c,
        data: grid.map((m) => m.cls[c]),
        backgroundColor: COLORS[i],
        stack: "expenses",
        hidden: hidden.has(c),
        // outline the focused month
        borderColor: grid.map((_, k) => (k === month ? "#111" : "transparent")),
        borderWidth: grid.map((_, k) => (k === month ? 2 : 0)),
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      onClick: (_evt, els) => {
        if (!els.length) return;
        const k = els[0].index;
        setMonth(month === k ? null : k);
      },
      plugins: {
        legend: { display: false }, // chips above act as the legend
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)} EUR` } },
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => fmt(v) } },
      },
    },
  });
}

function renderPieChart(period) {
  if (pieChart) pieChart.destroy();
  const visible = CLASSES.filter((c) => !hidden.has(c));
  pieChart = new Chart($("pie"), {
    type: "doughnut",
    data: {
      labels: visible,
      datasets: [{
        data: visible.map((c) => period.cls[c]),
        backgroundColor: visible.map((c) => COLORS[CLASSES.indexOf(c)]),
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmt(ctx.parsed)} EUR` } },
      },
    },
  });
}
