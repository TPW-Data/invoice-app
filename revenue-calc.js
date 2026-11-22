// Revenue calculations, using the same definitions as the "Grand Total" tab of the workbook:
//   Revenue = Promet MP "Ukupno promet"   + Promet VP "Iznos računa"
//   VAT     = Promet MP "Ukupno PDV"      + Promet VP "Porez"
//   Profit  = Promet MP "Iznos marže"     + Promet VP "Marža (RUC) nakon provizija"
// Only the "Promet MP" and "Promet VP" tabs are used.
// Feb 29 is included (the workbook's profit formula leaves it out; see README note in the reply).
const REVENUE_COLUMNS = {
  promet_mp: { date: "Datum", revenue: "Ukupno promet", vat: "Ukupno PDV", profit: "Iznos marže" },
  promet_vp: { date: "Datum", revenue: "Iznos računa", vat: "Porez", profit: "Marža (RUC) nakon provizija" },
};

function emptyMonth() {
  return { mp: { revenue: 0, vat: 0, profit: 0 }, vp: { revenue: 0, vat: 0, profit: 0 } };
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

const yearData = (monthly, year) => monthly[year] || Array.from({ length: 12 }, emptyMonth);

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

// Change against the past year. Percentage is null when the past value is zero.
function change(current, past) {
  return {
    diff: current - past,
    pct: past === 0 ? null : (current - past) / Math.abs(past),
  };
}

if (typeof module !== "undefined") {
  module.exports = { REVENUE_COLUMNS, buildMonthly, yearData, split, sumMonths, change };
}
