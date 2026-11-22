// Page access by role. The role comes from the signed-in user's app_metadata (set with supabase/roles.sql).
// This only controls what is shown. The database rules in roles.sql are what actually protect the data.
(function () {
  const ACCESS = {
    "index.html": ["admin", "accounting"],
    "dashboard.html": ["admin", "accounting", "management"],
    "table.html": ["admin", "accounting", "management"],
    "import.html": ["admin"],
  };

  const pageName = (url) => {
    const u = new URL(url, window.location.href);
    return (u.pathname.endsWith("/") ? u.pathname + "index.html" : u.pathname).split("/").pop();
  };
  const here = pageName(window.location.href);
  const allowed = (role, page) => !ACCESS[page] || ACCESS[page].includes(role);

  const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

  const denied = document.createElement("section");
  denied.id = "denied";
  denied.className = "card";
  denied.hidden = true;
  denied.innerHTML =
    '<h2>No access</h2>' +
    '<p class="muted" id="denied-text"></p>' +
    '<button class="btn secondary" id="denied-logout" type="button">Sign out</button>';
  document.querySelector("main").append(denied);
  document.getElementById("denied-logout").addEventListener("click", () => sb.auth.signOut());

  sb.auth.onAuthStateChange((_event, session) => {
    const role = session?.user?.app_metadata?.role || "";

    // Hide menu items the role cannot open
    document.querySelectorAll("#menu a").forEach((a) => {
      a.hidden = !allowed(role, pageName(a.href));
    });

    // Signed in, but this page is not for this role
    const blocked = !!session && !allowed(role, here);
    denied.hidden = !blocked;
    if (blocked) {
      document.getElementById("app-view").hidden = true;
      document.getElementById("login-view").hidden = true;
      document.getElementById("denied-text").textContent =
        `Your account (role: ${role || "none"}) cannot open this page. Ask the administrator to change your role.`;
    }
  });
})();
