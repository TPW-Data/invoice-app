// Read-only management dashboard. Uses the same Supabase project and sign-in as the invoice app.
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
const RATES = [5, 13, 25];
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString("hr-HR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let all = [];
let chart = null;

// ---------- auth ----------
sb.auth.onAuthStateChange((_event, session) => {
  $("login-view").hidden = !!session;
  $("app-view").hidden = !session;
  if (session) load();
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
$("period").addEventListener("change", render);

// ---------- data ----------
function monthOf(r) {
  return (r.invoice_date || r.created_at).slice(0, 7); // YYYY-MM
}

async function load() {
  $("status").textContent = "Loading…";
  const { data, error } = await sb
    .from("invoices")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(5000);
  if (error) {
    $("status").textContent = error.message;
    return;
  }

  all = data.map((r) => ({ ...r, month: monthOf(r), gross: Number(r.gross_total) || 0 }));

  const months = [...new Set(all.map((r) => r.month))].sort().reverse();
  const current = $("period").value;
  $("period").replaceChildren(new Option("All time", "all"), ...months.map((m) => new Option(m, m)));
  if ([...$("period").options].some((o) => o.value === current)) $("period").value = current;

  renderMonthly();
  render();
  $("status").textContent = `Updated ${new Date().toLocaleString("hr-HR")} · ${all.length} invoices`;
}

function filtered() {
  const p = $("period").value;
  return p === "all" ? all : all.filter((r) => r.month === p);
}

function sum(rows, key) {
  return rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
}

function groupBy(rows, keyFn) {
  const out = {};
  for (const r of rows) {
    const k = keyFn(r);
    out[k] ??= { count: 0, gross: 0 };
    out[k].count++;
    out[k].gross += r.gross;
  }
  return out;
}

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

function tr(cells) {
  const row = document.createElement("tr");
  for (const c of cells) {
    const td = document.createElement("td");
    td.textContent = c;
    row.append(td);
  }
  return row;
}

// ---------- rendering ----------
function render() {
  const rows = filtered();
  const gross = sum(rows, "gross");
  const net = RATES.reduce((s, r) => s + sum(rows, `net_${r}`), 0);
  const vat = RATES.reduce((s, r) => s + sum(rows, `vat_${r}`), 0);
  const avg = rows.length ? gross / rows.length : 0;

  $("kpis").replaceChildren(
    kpi("Invoices", String(rows.length)),
    kpi("Average invoice (EUR)", fmt(avg)),
    kpi("Gross total (EUR)", fmt(gross)),
    kpi("Net total (EUR)", fmt(net)),
    kpi("VAT total (EUR)", fmt(vat)),
  );

  const byClass = groupBy(rows, (r) => r.expense_class || "Unclassified");
  $("by-class").replaceChildren(
    ...Object.entries(byClass)
      .sort((a, b) => b[1].gross - a[1].gross)
      .map(([name, g]) =>
        tr([name, String(g.count), fmt(g.gross), gross ? `${((g.gross / gross) * 100).toFixed(1)} %` : "0 %"])
      )
  );

  $("by-vat").replaceChildren(
    ...RATES.map((r) => tr([`${r} %`, fmt(sum(rows, `net_${r}`)), fmt(sum(rows, `vat_${r}`))]))
  );

  const bySupplier = groupBy(rows, (r) => r.company_name || "—");
  $("top-suppliers").replaceChildren(
    ...Object.entries(bySupplier)
      .sort((a, b) => b[1].gross - a[1].gross)
      .slice(0, 10)
      .map(([name, g]) => tr([name, String(g.count), fmt(g.gross)]))
  );
}

function renderMonthly() {
  const byMonth = groupBy(all, (r) => r.month);
  const keys = Object.keys(byMonth).sort();
  if (chart) chart.destroy();
  chart = new Chart($("chart-month"), {
    type: "bar",
    data: {
      labels: keys,
      datasets: [{ label: "Gross (EUR)", data: keys.map((k) => byMonth[k].gross), backgroundColor: "#1f6feb" }],
    },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
  });
}
