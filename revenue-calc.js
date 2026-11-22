// Revenue calculations, using the same definitions as the "Grand Total" tab of the workbook:
//   Revenue = Promet MP "Ukupno promet"   + Promet VP "Iznos računa"
//   VAT     = Promet MP "Ukupno PDV"      + Promet VP "Porez"
//   Profit  = Promet MP "Iznos marže"     + Promet VP "Marža (RUC) nakon provizija"
// Only the "Promet MP" and "Promet VP" tabs are used.
// Feb 29 is included (the workbook's profit formula leaves it out).
const REVENUE_COLUMNS = {
  promet_mp: { date: "Datum", revenue: "Ukupno promet", vat: "Ukupno PDV", profit: "Iznos marže" },
  promet_vp: { date: "Datum", revenue: "Iznos računa", vat: "Porez", profit: "Marža (RUC) nakon provizija" },
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function emptyMonth() {
  return { mp: { revenue: 0, vat: 0, profit: 0 }, vp: { revenue: 0, vat: 0, profit: 0 } };
}

function emptyCounts() {
  return Array.from({ length: 12 }, () => ({ mpDays: 0, vpInvoices: 0 }));
}

function numOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// rowsByDataset: { promet_mp: [data, ...], promet_vp: [data, ...] }, where data is the stored row object.
// Returns monthly[year][monthIndex 0..11] = { mp: {revenue, vat, profit}, vp: {...} }
function buildMonthly(rowsByDataset) {
  const monthly = {};
  for (const dataset of Object.keys(REVENUE_COLUMNS)) {
    const cols = REVENUE_COLUMNS[dataset];
    const side = dataset === "promet_mp" ? "mp" : "vp";
    for (const d of rowsByDataset[dataset] || []) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d[cols.date] ?? ""));
      if (!m) continue;
      const year = Number(m[1]);
      const monthIndex = Number(m[2]) - 1;
      if (!monthly[year]) monthly[year] = Array.from({ length: 12 }, emptyMonth);
      const t = monthly[year][monthIndex][side];
      t.revenue += numOrZero(d[cols.revenue]);
      t.vat += numOrZero(d[cols.vat]);
      t.profit += numOrZero(d[cols.profit]);
    }
  }
  return monthly;
}

// counts[year][monthIndex] = { mpDays, vpInvoices }
// mpDays = MP rows with revenue (trading days), vpInvoices = VP rows (invoices)
function buildCounts(rowsByDataset) {
  const counts = {};
  for (const dataset of Object.keys(REVENUE_COLUMNS)) {
    const cols = REVENUE_COLUMNS[dataset];
    for (const d of rowsByDataset[dataset] || []) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d[cols.date] ?? ""));
      if (!m) continue;
      if (dataset === "promet_mp" && !(numOrZero(d[cols.revenue]) > 0)) continue;
      const year = Number(m[1]);
      const monthIndex = Number(m[2]) - 1;
      if (!counts[year]) counts[year] = emptyCounts();
      if (dataset === "promet_mp") counts[year][monthIndex].mpDays += 1;
      else counts[year][monthIndex].vpInvoices += 1;
    }
  }
  return counts;
}

// Average MP revenue per trading day, by weekday (Mon..Sun), for one year.
// monthIndex null = whole year, otherwise only that month.
function weekdayAverages(rowsByDataset, year, monthIndex) {
  const cols = REVENUE_COLUMNS.promet_mp;
  const sum = Array(7).fill(0);
  const n = Array(7).fill(0);
  for (const d of rowsByDataset.promet_mp || []) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d[cols.date] ?? ""));
    if (!m || Number(m[1]) !== year) continue;
    if (monthIndex !== null && Number(m[2]) - 1 !== monthIndex) continue;
    const rev = numOrZero(d[cols.revenue]);
    if (!(rev > 0)) continue;
    const dow = (new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay() + 6) % 7; // Monday = 0
    sum[dow] += rev;
    n[dow] += 1;
  }
  return WEEKDAYS.map((label, i) => ({ label, avg: n[i] ? sum[i] / n[i] : 0, days: n[i] }));
}

const yearData = (monthly, year) => monthly[year] || Array.from({ length: 12 }, emptyMonth);
const yearCounts = (counts, year) => counts[year] || emptyCounts();

// One month's value for a measure ("revenue" | "vat" | "profit"), split MP / VP / total
function split(m, measure) {
  return { mp: m.mp[measure], vp: m.vp[measure], total: m.mp[measure] + m.vp[measure] };
}

// Totals for a set of months (indexes), for one measure
function sumMonths(yearMonths, measure, indexes) {
  const out = { mp: 0, vp: 0, total: 0 };
  for (const i of indexes) {
    const s = split(yearMonths[i], measure);
    out.mp += s.mp;
    out.vp += s.vp;
    out.total += s.total;
  }
  return out;
}

// Sum of a count field (mpDays or vpInvoices) over a set of months
function sumCounts(yearCountsArr, field, indexes) {
  return indexes.reduce((acc, i) => acc + yearCountsArr[i][field], 0);
}

// Change against the past year. Percentage is null when the past value is zero.
function change(current, past) {
  return {
    diff: current - past,
    pct: past === 0 ? null : (current - past) / Math.abs(past),
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    REVENUE_COLUMNS, WEEKDAYS, buildMonthly, buildCounts, weekdayAverages,
    yearData, yearCounts, split, sumMonths, sumCounts, change,
  };
}
