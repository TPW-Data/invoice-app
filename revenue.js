// Revenue dashboard: KPI cards, charts and the three tables (Revenue, VAT, Profit), compared with the past year.
// Period: "Whole year" compares the whole year with the past year; a month compares it with the same month last year.
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = MONTHS.map((m) => m.slice(0, 3));
const ALL_MONTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MEASURES = [
  { key: "revenue", title: "1. Revenue (EUR)" },
  { key: "vat", title: "2. VAT (EUR)" },
  { key: "profit", title: "3. Profit (EUR)" },
];
const COLORS = { green: "#456733", lightGreen: "#8fb573", blue: "#1f6feb", orange: "#f0a202", grey: "#c3c7cd", purple: "#8e44ad" };
const fmt = (n) => Number(n || 0).toLocaleString("hr-HR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n) => Number(n || 0).toLocaleString("hr-HR", { maximumFractionDigits: 0 });
const signed = (n) => (n > 0 ? "+" : "") + fmt(n);
const pctText = (p) => (p === null || p === undefined ? "—" : (p > 0 ? "+" : "") + (p * 100).toFixed(1) + " %");
const pctShare = (p) => (p === null || p === undefined ? "—" : (p * 100).toFixed(1) + " %");

let monthly = {};
let counts = {};
let rawRows = { promet_mp: [], promet_vp: [] };
let year = null;
let month = null; // null = whole year
const charts = {};

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

const isHeaderRow = (d) => d && d.__headers;

async function load() {
  try {
    $("status").textContent = "Loading…";
    const [mp, vp] = await Promise.all([
      fetchAll(() => sb.from("revenue_rows").select("data").eq("dataset", "promet_mp").order("row_no")),
      fetchAll(() => sb.from("revenue_rows").select("data").eq("dataset", "promet_vp").order("row_no")),
    ]);
    rawRows = {
      promet_mp: mp.map((r) => r.data).filter((d) => !isHeaderRow(d)),
      promet_vp: vp.map((r) => r.data).filter((d) => !isHeaderRow(d)),
    };
    monthly = buildMonthly(rawRows);
    counts = buildCounts(rawRows);

    const years = Object.keys(monthly).map(Number).sort((a, b) => b - a);
    if (!years.length) years.push(new Date().getFullYear());
    year = years.includes(year) ? year : years[0];
    $("year").replaceChildren(...years.map((y) => new Option(String(y), String(y))));
    $("year").value = String(year);
    $("month").replaceChildren(new Option("Whole year", ""), ...MONTHS.map((m, i) => new Option(m, String(i))));
    $("month").value = month === null ? "" : String(month);

    render();
    $("status").textContent = Object.keys(monthly).length
      ? `Updated ${new Date().toLocaleString("hr-HR")} · ${rawRows.promet_mp.length} MP rows, ${rawRows.promet_vp.length} VP rows`
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
  const curC = yearCounts(counts, year);
  const pastC = yearCounts(counts, year - 1);
  const idx = month === null ? ALL_MONTHS : [month];
  const label = month === null ? `${year}` : `${MONTHS[month]} ${year}`;
  const pastLabel = month === null ? `${year - 1}` : `${MONTHS[month]} ${year - 1}`;
  $("period").textContent = `Showing ${label}, compared with ${pastLabel}. Click a month in the tables to see that month in all earlier years.`;

  renderKpis(cur, past, curC, pastC, idx);
  renderCharts(cur, past, curC, idx);
  $("tables").replaceChildren(...MEASURES.map((m) => buildCard(m, cur, past, idx)));
}

// ---------- KPI cards ----------
function renderKpis(cur, past, curC, pastC, idx) {
  const rev = sumMonths(cur, "revenue", idx);
  const revP = sumMonths(past, "revenue", idx);
  const vat = sumMonths(cur, "vat", idx);
  const vatP = sumMonths(past, "vat", idx);
  const prof = sumMonths(cur, "profit", idx);
  const profP = sumMonths(past, "profit", idx);
  const marginNow = rev.total ? prof.total / rev.total : null;
  const marginPast = revP.total ? profP.total / revP.total : null;
  const mpShare = rev.total ? rev.mp / rev.total : null;
  const mpShareP = revP.total ? revP.mp / revP.total : null;
  const invoices = sumCounts(curC, "vpInvoices", idx);
  const invoicesP = sumCounts(pastC, "vpInvoices", idx);
  const days = sumCounts(curC, "mpDays", idx);
  const daysP = sumCounts(pastC, "mpDays", idx);
  const avgDay = days ? rev.mp / days : null;
  const avgDayP = daysP ? revP.mp / daysP : null;

  // Best month of the year (always the whole year)
  const yearTotals = cur.map((m) => split(m, "revenue").total);
  const bestIdx = yearTotals.reduce((b, v, i) => (v > yearTotals[b] ? i : b), 0);
  const bestVal = yearTotals[bestIdx];

  const cards = [
    kpiCard("Revenue", fmt(rev.total), "green", changeLine(rev.total, revP.total, "money")),
    kpiCard("VAT", fmt(vat.total), "blue", changeLine(vat.total, vatP.total, "money")),
    kpiCard("Profit (margin)", fmt(prof.total), "orange", changeLine(prof.total, profP.total, "money")),
    kpiCard("Margin %", pctShare(marginNow), "orange", `past ${pctShare(marginPast)} · ${ppText(marginNow, marginPast)}`),
    kpiCard("MP share of revenue", pctShare(mpShare), "purple", `past ${pctShare(mpShareP)} · ${ppText(mpShare, mpShareP)}`),
    kpiCard("VP invoices", fmt0(invoices), "blue", `past ${fmt0(invoicesP)} · ${changeText(invoices, invoicesP)}`),
    kpiCard("Avg MP revenue per day", fmt(avgDay), "green", `past ${fmt(avgDayP)} · ${changeText(avgDay, avgDayP)}`),
    kpiCard("Best month of year", MONTHS[bestIdx], "purple", `${MONTHS[bestIdx]}: ${fmt(bestVal)} EUR · ${fmt0(days)} MP days in period`),
  ];
  $("kpis").replaceChildren(...cards);
}

function kpiCard(title, value, color, sub) {
  const div = document.createElement("div");
  div.className = `kpi ${color === "green" ? "" : color}`.trim();
  const small = document.createElement("small");
  small.textContent = title;
  const strong = document.createElement("strong");
  strong.textContent = value;
  const s = document.createElement("div");
  s.className = "sub";
  if (typeof sub === "string") {
    s.textContent = sub;
  } else {
    s.append(sub);
  }
  div.append(small, strong, s);
  return div;
}

// "change +1.234,00 (+5.2 %) vs past" as a coloured span
function changeLine(now, past, type) {
  const ch = change(now, past);
  const span = document.createElement("span");
  span.textContent = `${signed(ch.diff)} (${pctText(ch.pct)}) vs past ${fmt(past)}`;
  span.className = ch.diff > 0 ? "pos" : ch.diff < 0 ? "neg" : "";
  return span;
}

function changeText(now, past) {
  const ch = change(now, past);
  return `${signed(ch.diff)} (${pctText(ch.pct)})`;
}

// Change in percentage points for margin / share
function ppText(now, past) {
  if (now === null || past === null) return "—";
  const d = (now - past) * 100;
  return `${(d > 0 ? "+" : "") + d.toFixed(1)} pp`;
}

// ---------- charts ----------
function chart(id, config) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($(id), {
    ...config,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      ...config.options,
    },
  });
}

const kFmt = (v) => `${fmt0(v / 1000)} k`;

function renderCharts(cur, past, curC, idx) {
  const curTotals = cur.map((m) => split(m, "revenue").total);
  const pastTotals = past.map((m) => split(m, "revenue").total);

  // 1. Monthly revenue: this year vs past year
  chart("c-monthly", {
    type: "bar",
    data: {
      labels: SHORT,
      datasets: [
        { label: `${year}`, data: curTotals, backgroundColor: COLORS.green, borderRadius: 4 },
        { label: `${year - 1}`, data: pastTotals, backgroundColor: COLORS.grey, borderRadius: 4 },
      ],
    },
    options: {
      plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y)} EUR` } } },
      scales: { y: { beginAtZero: true, ticks: { callback: kFmt } } },
    },
  });

  // 2. Year to date: cumulative revenue up to the last month with data
  const hasData = (i) => cur[i].mp.revenue + cur[i].vp.revenue !== 0 || curC[i].mpDays + curC[i].vpInvoices > 0;
  let lastIdx = -1;
  for (let i = 0; i < 12; i++) if (hasData(i)) lastIdx = i;
  const cumulative = (arr, limit) => {
    let run = 0;
    return arr.map((v, i) => {
      run += v;
      return limit === null || i <= limit ? run : null;
    });
  };
  chart("c-ytd", {
    type: "line",
    data: {
      labels: SHORT,
      datasets: [
        { label: `${year}`, data: cumulative(curTotals, lastIdx), borderColor: COLORS.green, backgroundColor: "rgba(69,103,51,.15)", fill: true, tension: .3 },
        { label: `${year - 1}`, data: cumulative(pastTotals, null), borderColor: COLORS.grey, borderDash: [6, 4], tension: .3, pointRadius: 0 },
      ],
    },
    options: {
      plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y)} EUR` } } },
      scales: { y: { beginAtZero: true, ticks: { callback: kFmt } } },
    },
  });

  // 3. MP and VP stacked by month
  chart("c-split", {
    type: "bar",
    data: {
      labels: SHORT,
      datasets: [
        { label: "MP", data: cur.map((m) => m.mp.revenue), backgroundColor: COLORS.green, stack: "rev" },
        { label: "VP", data: cur.map((m) => m.vp.revenue), backgroundColor: COLORS.blue, stack: "rev" },
      ],
    },
    options: {
      plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y)} EUR` } } },
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { callback: kFmt } } },
    },
  });

  // 4. Profit bars with margin % line
  const profit = cur.map((m) => split(m, "profit").total);
  const margin = cur.map((m) => {
    const r = split(m, "revenue").total;
    return r ? split(m, "profit").total / r : null;
  });
  chart("c-profit", {
    type: "bar",
    data: {
      labels: SHORT,
      datasets: [
        { label: "Profit (EUR)", data: profit, backgroundColor: COLORS.orange, borderRadius: 4, yAxisID: "y" },
        { label: "Margin %", data: margin, type: "line", borderColor: COLORS.purple, backgroundColor: COLORS.purple, tension: .3, yAxisID: "y1" },
      ],
    },
    options: {
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            label: (c) => (c.dataset.yAxisID === "y1" ? `Margin: ${pctShare(c.parsed.y)}` : `Profit: ${fmt(c.parsed.y)} EUR`),
          },
        },
      },
      scales: {
        y: { beginAtZero: true, ticks: { callback: kFmt } },
        y1: { position: "right", beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { callback: (v) => `${(v * 100).toFixed(0)} %` } },
      },
    },
  });

  // 5. VAT by month: this year vs past year
  chart("c-vat", {
    type: "bar",
    data: {
      labels: SHORT,
      datasets: [
        { label: `${year}`, data: cur.map((m) => split(m, "vat").total), backgroundColor: COLORS.blue, borderRadius: 4 },
        { label: `${year - 1}`, data: past.map((m) => split(m, "vat").total), backgroundColor: COLORS.grey, borderRadius: 4 },
      ],
    },
    options: {
      plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y)} EUR` } } },
      scales: { y: { beginAtZero: true, ticks: { callback: kFmt } } },
    },
  });

  // 6. MP / VP share for the selected period
  const period = sumMonths(cur, "revenue", idx);
  chart("c-share", {
    type: "doughnut",
    data: {
      labels: ["MP", "VP"],
      datasets: [{ data: [period.mp, period.vp], backgroundColor: [COLORS.green, COLORS.blue] }],
    },
    options: {
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${fmt(c.parsed)} EUR` } },
      },
    },
  });

  // 7. Average MP revenue per trading day, by weekday (selected period)
  const week = weekdayAverages(rawRows, year, month);
  chart("c-week", {
    type: "bar",
    data: {
      labels: week.map((w) => w.label),
      datasets: [{ label: "Avg per day", data: week.map((w) => w.avg), backgroundColor: COLORS.lightGreen, borderRadius: 4 }],
    },
    options: {
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `Avg: ${fmt(c.parsed.y)} EUR (${week[c.dataIndex].days} days)` } },
      },
      scales: { y: { beginAtZero: true, ticks: { callback: kFmt } } },
    },
  });

  // 8. All years: revenue and profit
  const years = Object.keys(monthly).map(Number).sort((a, b) => a - b);
  chart("c-years", {
    type: "bar",
    data: {
      labels: years.map(String),
      datasets: [
        { label: "Revenue", data: years.map((y) => sumMonths(yearData(monthly, y), "revenue", ALL_MONTHS).total), backgroundColor: COLORS.green, borderRadius: 4 },
        { label: "Profit", data: years.map((y) => sumMonths(yearData(monthly, y), "profit", ALL_MONTHS).total), backgroundColor: COLORS.orange, borderRadius: 4 },
      ],
    },
    options: {
      plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y)} EUR` } } },
      scales: { y: { beginAtZero: true, ticks: { callback: kFmt } } },
    },
  });
}

// ---------- tables ----------
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
  line.append(`Selected period: ${fmt(now)} · Past year: ${fmt(before)} · `, changeSpan(ch));

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

    // Clicked month: show the same month in every earlier year, under the clicked line
    if (month === i) {
      const years = historyYears();
      for (const y of years) tbody.append(historyRow(measure.key, y, i));
      if (years.length) tbody.append(historyAverageRow(measure.key, years, i));
    }
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

// Years before the selected year that have data, newest first
function historyYears() {
  return Object.keys(monthly)
    .map(Number)
    .filter((y) => y < year)
    .sort((a, b) => b - a);
}

// One earlier year for the clicked month. "Past year" is the year before that one.
function historyRow(key, y, i) {
  const s = split(yearData(monthly, y)[i], key);
  const p = split(yearData(monthly, y - 1)[i], key).total;
  const c = change(s.total, p);
  const tr = document.createElement("tr");
  tr.className = "history";
  tr.append(
    cellText(`${MONTHS[i]} ${y}`),
    cellText(fmt(s.mp)),
    cellText(fmt(s.vp)),
    cellText(fmt(s.total)),
    cellText(fmt(p)),
    changeCell(c.diff, true),
    changeCell(c.pct, false)
  );
  return tr;
}

// Average of the earlier years for the clicked month
function historyAverageRow(key, years, i) {
  const values = years.map((y) => split(yearData(monthly, y)[i], key));
  const n = values.length;
  const avg = {
    mp: values.reduce((a, v) => a + v.mp, 0) / n,
    vp: values.reduce((a, v) => a + v.vp, 0) / n,
    total: values.reduce((a, v) => a + v.total, 0) / n,
  };
  const tr = document.createElement("tr");
  tr.className = "history avg";
  tr.append(
    cellText(`${MONTHS[i]} average (${years[years.length - 1]}–${years[0]})`),
    cellText(fmt(avg.mp)),
    cellText(fmt(avg.vp)),
    cellText(fmt(avg.total)),
    cellText(""),
    cellText(""),
    cellText("")
  );
  return tr;
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
