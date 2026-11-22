const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
const BUCKET = "invoice-images";
const EXCEL_PATH = "exports/invoices.xlsx"; // the accumulated workbook, rewritten after every save
const RATES = [5, 13, 25];
const $ = (id) => document.getElementById(id);
const num = (id) => parseFloat($(id).value) || 0;
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
let sourceBlob = null;  // the file to keep in Storage
let fileType = "image/jpeg";
let fileExt = "jpg";

// ---------- setup ----------
$("expense_class").replaceChildren(
  new Option("— select —", ""),
  ...CONFIG.EXPENSE_CATEGORIES.map((c) => new Option(c, c))
);

// ---------- auth ----------
sb.auth.onAuthStateChange((_event, session) => {
  $("login-view").hidden = !!session;
  $("app-view").hidden = !session;
  if (session) refreshList();
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

// ---------- invoice file (photo, PDF or Word) -> AI extraction ----------
$("btn-photo").addEventListener("click", () => $("photo").click());
$("btn-doc").addEventListener("click", () => $("doc").click());
$("photo").addEventListener("change", (e) => handleFile(e.target.files[0]));
$("doc").addEventListener("change", (e) => handleFile(e.target.files[0]));

async function handleFile(file) {
  if (!file) return;
  try {
    const name = file.name.toLowerCase();
    $("preview").hidden = true;
    setStatus("Preparing file…");

    let payload;
    if (file.type.startsWith("image/") || /\.(jpe?g|png|heic|heif|webp)$/.test(name)) {
      sourceBlob = await shrinkImage(file, 1600, 0.8);
      fileType = "image/jpeg";
      fileExt = "jpg";
      $("preview").src = URL.createObjectURL(sourceBlob);
      $("preview").hidden = false;
      payload = { fileBase64: await blobToBase64(sourceBlob), mediaType: "image/jpeg" };
    } else if (name.endsWith(".pdf")) {
      if (file.size > 4 * 1024 * 1024) throw new Error("PDF is larger than 4 MB – please use a smaller file.");
      sourceBlob = file;
      fileType = "application/pdf";
      fileExt = "pdf";
      payload = { fileBase64: await blobToBase64(file), mediaType: "application/pdf" };
    } else if (name.endsWith(".docx")) {
      sourceBlob = file;
      fileType = DOCX_MIME;
      fileExt = "docx";
      const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      payload = { text: value };
    } else {
      throw new Error("Unsupported file. Use a photo, a PDF, or a .docx file (for an old .doc file, save it as .docx or PDF first).");
    }

    setStatus("Reading invoice…");
    const { data, error } = await sb.functions.invoke("extract-invoice", {
      body: { ...payload, categories: CONFIG.EXPENSE_CATEGORIES },
    });
    if (error || data?.error) throw new Error(data?.error || error.message);

    fillForm(data);
    setStatus("Check the values, then save.");
  } catch (err) {
    setStatus(`Could not read invoice – enter the data manually. (${err.message})`, true);
  }
}

function fillForm(d) {
  $("invoice_number").value = d.invoice_number ?? "";
  $("invoice_date").value = toISODate(d.invoice_date);
  $("company_name").value = d.company_name ?? "";
  $("oib").value = String(d.oib ?? "").replace(/\D/g, "");
  $("gross_total").value = d.gross_total ?? "";
  $("expense_class").value = d.expense_class ?? "";
  const breakdown = d.vat_breakdown || [];
  for (const r of RATES) {
    const row = breakdown.find((x) => Number(x.rate) === r) || {};
    $(`net_${r}`).value = row.net ?? "";
    $(`vat_${r}`).value = row.vat ?? "";
  }

  // No VAT on the invoice: the whole amount goes into the 25% net column
  const hasVat = breakdown.some((x) => Number(x.vat) > 0);
  if (!hasVat && d.gross_total != null) {
    const net = breakdown.reduce((s, x) => s + (Number(x.net) || 0), 0) || Number(d.gross_total);
    for (const r of RATES) {
      $(`net_${r}`).value = "";
      $(`vat_${r}`).value = "";
    }
    $("net_25").value = net.toFixed(2);
  }
  validate();
}

// ---------- validation ----------
$("save-form").addEventListener("input", validate);

function validate() {
  const warnings = [];
  const oib = $("oib").value.trim();
  if (oib && !isValidOIB(oib)) warnings.push("OIB failed the check-digit test – please verify.");

  const sum = RATES.reduce((s, r) => s + num(`net_${r}`) + num(`vat_${r}`), 0);
  const gross = num("gross_total");
  if (gross && Math.abs(sum - gross) > 0.01) {
    warnings.push(`Net + VAT (${sum.toFixed(2)}) does not match gross total (${gross.toFixed(2)}).`);
  }

  $("warnings").replaceChildren(
    ...warnings.map((w) => {
      const li = document.createElement("li");
      li.textContent = w;
      return li;
    })
  );
  return warnings.length === 0;
}

// Croatian invoices show dates as 22.11.2026. – convert to 2026-11-22 for the date box
function toISODate(s) {
  if (!s) return "";
  const hr = String(s).match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  if (hr) return `${hr[3]}-${hr[2].padStart(2, "0")}-${hr[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

// ISO 7064 MOD 11,10 check digit used for Croatian OIB numbers
function isValidOIB(oib) {
  if (!/^\d{11}$/.test(oib)) return false;
  let a = 10;
  for (let i = 0; i < 10; i++) {
    a = (a + Number(oib[i])) % 10;
    if (a === 0) a = 10;
    a = (a * 2) % 11;
  }
  let check = 11 - a;
  if (check === 10) check = 0;
  return check === Number(oib[10]);
}

// ---------- save ----------
$("save-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("save-btn");
  btn.disabled = true;
  try {
    const { data: { user } } = await sb.auth.getUser();

    // Source photo is kept in private Storage; the invoice row stores its path.
    let imagePath = null;
    if (sourceBlob) {
      imagePath = `${user.id}/${Date.now()}.${fileExt}`;
      const { error } = await sb.storage.from(BUCKET).upload(imagePath, sourceBlob, { contentType: fileType });
      if (error) throw error;
    }

    const row = {
      invoice_number: $("invoice_number").value.trim(),
      invoice_date: $("invoice_date").value || null,
      company_name: $("company_name").value.trim(),
      oib: $("oib").value.trim(),
      net_5: num("net_5"), vat_5: num("vat_5"),
      net_13: num("net_13"), vat_13: num("vat_13"),
      net_25: num("net_25"), vat_25: num("vat_25"),
      gross_total: num("gross_total"),
      expense_class: $("expense_class").value,
      image_path: imagePath,
    };
    const { error } = await sb.from("invoices").insert(row);
    if (error) throw error;

    resetForm();
    refreshList();

    // Saved already; a failure here must not look like a failed save.
    setStatus("Saved ✓ – updating Excel…");
    try {
      await publishExcel();
      setStatus("Saved ✓ – Excel updated.");
    } catch (xerr) {
      setStatus(`Saved, but the Excel file could not be updated: ${xerr.message}`, true);
    }
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

function resetForm() {
  $("save-form").reset();
  sourceBlob = null;
  $("photo").value = "";
  $("doc").value = "";
  $("preview").hidden = true;
  $("warnings").replaceChildren();
}

// ---------- list ----------
async function refreshList() {
  const { data, error } = await sb
    .from("invoices")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    $("list").textContent = error.message;
    return;
  }
  $("list").replaceChildren(
    ...data.map((r) => {
      const div = document.createElement("div");
      div.className = "item";
      const title = document.createElement("strong");
      title.textContent = `${r.invoice_number} – ${r.company_name}`;
      const meta = document.createElement("small");
      meta.textContent = `${r.expense_class ?? ""} · ${Number(r.gross_total).toFixed(2)} EUR`;
      div.append(title, document.createElement("br"), meta);
      if (r.image_path) {
        const btn = document.createElement("button");
        btn.className = "btn small";
        btn.textContent = "View photo";
        btn.addEventListener("click", () => viewPhoto(r.image_path));
        div.append(document.createElement("br"), btn);
      }
      return div;
    })
  );
  if (!data.length) $("list").textContent = "No invoices yet.";
}

async function viewPhoto(path) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 300);
  if (error) return setStatus(error.message, true);
  window.open(data.signedUrl, "_blank");
}

// ---------- accumulated Excel: one row per invoice ----------
async function buildWorkbookBlob() {
  const { data, error } = await sb
    .from("invoices")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const header = [
    "Invoice number", "Invoice date", "Company name", "OIB",
    "Net 5%", "VAT 5%", "Net 13%", "VAT 13%", "Net 25%", "VAT 25%",
    "Gross total", "Expense classification", "Uploaded",
  ];
  const rows = data.map((r) => [
    r.invoice_number, r.invoice_date ?? "", r.company_name, r.oib,
    Number(r.net_5), Number(r.vat_5),
    Number(r.net_13), Number(r.vat_13),
    Number(r.net_25), Number(r.vat_25),
    Number(r.gross_total), r.expense_class, r.created_at.slice(0, 10),
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws["!cols"] = header.map((_, i) => ({ wch: i === 2 ? 30 : i === 11 ? 22 : 14 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Invoices");
  const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// Rebuild from the database and overwrite the shared workbook in Storage
async function publishExcel() {
  const blob = await buildWorkbookBlob();
  const { error } = await sb.storage.from(BUCKET).upload(EXCEL_PATH, blob, {
    upsert: true,
    contentType: blob.type,
  });
  if (error) throw error;
}

// Download the current workbook
$("export-btn").addEventListener("click", async () => {
  try {
    const blob = await buildWorkbookBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoices-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    setStatus(err.message, true);
  }
});

// ---------- helpers ----------
function setStatus(msg, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.className = isError ? "error" : "";
}

// Downscale phone photos before upload/AI reading to keep them fast and small
function shrinkImage(file, maxSide, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Image conversion failed"))),
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => reject(new Error("Could not open image"));
    img.src = URL.createObjectURL(file);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
