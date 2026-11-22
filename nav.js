// Shared menu for index.html and dashboard.html: opens/closes the menu and highlights the current page.
(function () {
  const btn = document.getElementById("menu-btn");
  const menu = document.getElementById("menu");
  if (!btn || !menu) return;

  const here = window.location.pathname.split("/").pop() || "index.html";
  menu.querySelectorAll("a").forEach((a) => {
    if (a.getAttribute("href") === here) {
      a.classList.add("current");
      a.setAttribute("aria-current", "page");
    }
  });

  btn.addEventListener("click", () => {
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  });
})();
