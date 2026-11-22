// Revenue page: three tables (Revenue, VAT, Profit), each compared with the past year.
// Period selection: whole year (compares with the whole past year) or one month (compares with the same month last year).
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ALL_MONTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MEASURES = [
  { key: "revenue", title: "1. Revenue (EUR)" },
  { key: "vat", title: "2. VAT (EUR)" },
  { key: "profit", title: "3. Profit (EUR)" },
];
const fmt = (n) => Number(n || 0).toLocaleString("hr-HR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (n) => (n > 0 ? "+" : "") + fmt(n);
const pctText = (p) => (p === null ? "—" : (p > 0 ? "+" : "") + (p * 100).toFixed(1) + " %");

let monthly = {};
let year = null;
let month = null; // null = whole year

// ---------- auth ----------
sb.auth.onAuthStateChange((_event, session) => {
  $("login-view").hidden = !!session;
  $("app-view").hidden = !session;
  if (session) setTimeout(load, 0);
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
    const [mp, vp] = await Promise.all([
      fetchAll(() => sb.from("revenue_rows").select("data").eq("dataset", "promet_mp").order("row_no")),
      fetchAll(() => sb.from("revenue_rows").select("data").eq("dataset", "promet_vp").order("row_no")),
    ]);
    monthly = buildMonthly({ promet_mp: mp.map((r) => r.data), promet_vp: vp.map((r) => r.data) });

    const years = Object.keys(monthly).map(Number).sort((a, b) => b - a);
    if (!years.length) years.push(new Date().getFullYear());
    year = years.includes(year) ? year : years[0];
    $("year").replaceChildren(...years.map((y) => new Option(String(y), String(y))));
    $("year").value = String(year);
    $("month").replaceChildren(new Option("Whole year", ""), ...MONTHS.map((m, i) => new Option(m, String(i))));
    $("month").value = month === null ? "" : String(month);

    render();
    $("status").textContent = Object.keys(monthly).length
      ? `Updated ${new Date().toLocaleString("hr-HR")} · ${mp.length} Promet MP rows, ${vp.length} Promet VP rows`
      : "No revenue data yet. Upload the workbook on Upload Revenue.";
  } catch (err) {
    $("status").textContent = `Could not load data: ${err?.message || JSON.stringify(err)}`;
    console.error("Revenue load failed:", err);
  }
}

function setMonth(m) {
  month = m;
  $("month").value = m === null ? "" : String(m);
  render();
}

// ---------- rendering ----------
function render() {
  if (year === null) return;
  const cur = yearData(monthly, year);
  const past = yearData(monthly, year - 1);
  const indexes = month === null ? ALL_MONTHS : [month];
  const label = month === null ? `${year}` : `${MONTHS[month]} ${year}`;
  const pastLabel = month === null ? `${year - 1}` : `${MONTHS[month]} ${year - 1}`;
  $("period").textContent = `Showing ${label}, compared with ${pastLabel}. Choose "Whole year" to compare years, or a month to compare the same month last year.`;
  $("tables").replaceChildren(...MEASURES.map((m) => buildCard(m, cur, past, indexes)));
}

function buildCard(measure, cur, past, indexes) {
  const card = document.createElement("div");
  card.className = "card";

  const h = document.createElement("h2");
  h.textContent = measure.title;

  const now = sumMonths(cur, measure.key, indexes).total;
  const before = sumMonths(past, measure.key, indexes).total;
  const ch = change(now, before);
  const line = document.createElement("p");
  line.className = "kpi-line";
  line.append(
    `Selected period: ${fmt(now)} · Past year: ${fmt(before)} · `,
    changeSpan(ch)
  );

  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  for (const t of ["Month", "MP", "VP", "Total", "Past year", "Change", "Change %"]) {
    const th = document.createElement("th");
    th.textContent = t;
    hr.append(th);
  }
  thead.append(hr);

  const tbody = document.createElement("tbody");
  cur.forEach((m, i) => {
    const s = split(m, measure.key);
    const p = split(past[i], measure.key).total;
    const c = change(s.total, p);
    const tr = document.createElement("tr");
    if (month === i) tr.className = "selected";
    tr.append(
      cellText(MONTHS[i]),
      cellText(fmt(s.mp)),
      cellText(fmt(s.vp)),
      cellText(fmt(s.total)),
      cellText(fmt(p)),
      changeCell(c.diff, true),
      changeCell(c.pct, false)
    );
    tr.addEventListener("click", () => setMonth(month === i ? null : i));
    tbody.append(tr);
  });

  const all = sumMonths(cur, measure.key, ALL_MONTHS);
  const allPast = sumMonths(past, measure.key, ALL_MONTHS).total;
  const allCh = change(all.total, allPast);
  const tot = document.createElement("tr");
  tot.className = "total";
  tot.append(
    cellText(`TOTAL ${year}`),
    cellText(fmt(all.mp)),
    cellText(fmt(all.vp)),
    cellText(fmt(all.total)),
    cellText(fmt(allPast)),
    changeCell(allCh.diff, true),
    changeCell(allCh.pct, false)
  );
  tbody.append(tot);

  const table = document.createElement("table");
  table.append(thead, tbody);
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  wrap.append(table);

  card.append(h, line, wrap);
  return card;
}

function cellText(text) {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}

function changeCell(value, isMoney) {
  const td = document.createElement("td");
  if (value === null) {
    td.textContent = "—";
  } else {
    td.textContent = isMoney ? signed(value) : pctText(value);
    td.className = value > 0 ? "pos" : value < 0 ? "neg" : "";
  }
  return td;
}

function changeSpan(ch) {
  const span = document.createElement("span");
  span.textContent = `change ${signed(ch.diff)} (${pctText(ch.pct)})`;
  span.className = ch.diff > 0 ? "pos" : ch.diff < 0 ? "neg" : "";
  return span;
}
