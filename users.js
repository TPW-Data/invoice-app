// Admin user panel. Talks to the "manage-users" Edge Function, which checks the caller is an admin.
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const ROLES = ["admin", "accounting", "management"];
let users = [];

// ---------- auth ----------
sb.auth.onAuthStateChange((_event, session) => {
  $("login-view").hidden = !!session;
  $("app-view").hidden = !session;
  if (session) setTimeout(loadUsers, 0);
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

// ---------- server calls ----------
async function call(body) {
  const { data, error } = await sb.functions.invoke("manage-users", { body });
  if (error) {
    let msg = error.message;
    try {
      const j = await error.context.json();
      msg = j.error || msg;
    } catch (_) { /* keep generic message */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

async function loadUsers() {
  try {
    setStatus("Loading users…");
    const data = await call({ action: "list" });
    users = data.users.sort((a, b) => (a.email || "").localeCompare(b.email || ""));
    renderUsers();
    setStatus("");
  } catch (err) {
    setStatus(`Could not load users: ${err.message}`, true);
  }
}

// ---------- rendering ----------
function renderUsers() {
  const rows = users.map((u) => {
    const tr = document.createElement("tr");

    const tdEmail = document.createElement("td");
    tdEmail.textContent = u.email ?? "";

    const select = document.createElement("select");
    select.append(new Option("No access", ""), ...ROLES.map((r) => new Option(r, r)));
    select.value = u.role || "";

    const tdRole = document.createElement("td");
    tdRole.append(select);

    const tdLast = document.createElement("td");
    tdLast.textContent = u.last_sign_in ? new Date(u.last_sign_in).toLocaleString("hr-HR") : "never";

    const save = document.createElement("button");
    save.className = "btn small";
    save.type = "button";
    save.textContent = "Save";
    save.addEventListener("click", async () => {
      save.disabled = true;
      try {
        await call({ action: "set_role", user_id: u.id, role: select.value });
        u.role = select.value;
        setStatus(`Saved: ${u.email} → ${select.value || "no access"}. The user must sign out and back in.`);
      } catch (err) {
        select.value = u.role || "";
        setStatus(`Could not save: ${err.message}`, true);
      } finally {
        save.disabled = false;
      }
    });
    const tdSave = document.createElement("td");
    tdSave.append(save);

    tr.append(tdEmail, tdRole, tdLast, tdSave);
    return tr;
  });
  $("users").replaceChildren(...rows);

  $("pw-user").replaceChildren(...users.map((u) => new Option(u.email, u.id)));
}

// ---------- add user ----------
$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("add-btn").disabled = true;
  try {
    await call({
      action: "create",
      email: $("new-email").value,
      password: $("new-password").value,
      role: $("new-role").value,
    });
    $("add-status").textContent = `User ${$("new-email").value.trim()} created.`;
    $("add-status").className = "";
    $("add-form").reset();
    $("new-role").value = "management";
    await loadUsers();
  } catch (err) {
    $("add-status").textContent = `Could not create user: ${err.message}`;
    $("add-status").className = "error";
  } finally {
    $("add-btn").disabled = false;
  }
});

// ---------- set password ----------
$("pw-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("pw-btn").disabled = true;
  try {
    const u = users.find((x) => x.id === $("pw-user").value);
    await call({ action: "set_password", user_id: $("pw-user").value, password: $("pw-password").value });
    $("pw-status").textContent = `Password changed for ${u?.email ?? "user"}.`;
    $("pw-status").className = "";
    $("pw-form").reset();
  } catch (err) {
    $("pw-status").textContent = `Could not change password: ${err.message}`;
    $("pw-status").className = "error";
  } finally {
    $("pw-btn").disabled = false;
  }
});

function setStatus(msg, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.className = isError ? "error" : "";
}
