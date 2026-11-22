// Shared menu for all pages: opens/closes the menu and highlights the current page (including table.html?t=...).
(function () {
  const btn = document.getElementById("menu-btn");
  const menu = document.getElementById("menu");
  if (!btn || !menu) return;

  const normalise = (url) => (url.pathname.endsWith("/") ? url.pathname + "index.html" : url.pathname) + url.search;
  const here = normalise(new URL(window.location.href));
  menu.querySelectorAll("a").forEach((a) => {
    const target = normalise(new URL(a.getAttribute("href"), window.location.href));
    if (target === here) {
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
