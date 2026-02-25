/**
 * SC Shared Navigation Bar
 *
 * Injects a consistent nav bar into all pages.
 * Shows different links based on auth state.
 * Depends on sc-auth.js.
 *
 * Usage: add <div id="sc-nav"></div> where you want the nav, then call SC_NAV.init()
 * Or call SC_NAV.inject() to auto-replace the existing top-bar.
 */

var SC_NAV = {
  /**
   * Initialize the nav bar. Call after SC_AUTH.init().
   */
  init: function() {
    this.render();
    /* Re-render on auth state change */
    SC_AUTH.onAuthChange(function() {
      SC_NAV.render();
    });
  },

  /**
   * Render the nav bar into #sc-nav or the existing .top-bar element.
   */
  render: function() {
    var target = document.getElementById("sc-nav") || document.querySelector(".top-bar");
    if (!target) return;

    var currentPage = window.location.pathname.split("/").pop() || "index.html";
    var isLoggedIn = SC_AUTH.isLoggedIn();
    var member = SC_AUTH.member;

    var left = [
      this._link("SC", "index.html", currentPage, "nav-brand"),
      this._link("Configurator", "configurator.html", currentPage),
      this._link("Library", "library.html", currentPage),
      this._link("LamiForm", "lamiform.html", currentPage),
      this._link("Marketplace", "marketplace.html", currentPage)
    ].join("");

    var right = "";
    if (isLoggedIn && member) {
      var tierInfo = SC_API.getTierInfo(member.tier_id);
      right = [
        '<span class="nav-tier">' + tierInfo.name + '</span>',
        this._link("Dashboard", "dashboard.html", currentPage),
        '<a href="#" class="nav-link" id="nav-logout">Logout</a>'
      ].join("");
    } else {
      right = [
        this._link("Login", "login.html", currentPage),
        this._link("Register", "register.html", currentPage, "nav-register")
      ].join("");
    }

    target.innerHTML =
      '<nav class="sc-nav">' +
        '<div class="sc-nav-left">' + left + '</div>' +
        '<div class="sc-nav-right">' + right + '</div>' +
      '</nav>';

    /* Attach logout handler */
    var logoutBtn = document.getElementById("nav-logout");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async function(e) {
        e.preventDefault();
        await SC_AUTH.logout();
        window.location.href = "index.html";
      });
    }
  },

  /**
   * Build a nav link.
   */
  _link: function(label, href, currentPage, extraClass) {
    var cls = "nav-link";
    if (extraClass) cls += " " + extraClass;
    if (currentPage === href) cls += " nav-active";
    return '<a href="' + href + '" class="' + cls + '">' + label + '</a>';
  },

  /**
   * Inject nav bar CSS into the page <head>.
   * Call once on page load.
   */
  injectStyles: function() {
    if (document.getElementById("sc-nav-styles")) return;
    var style = document.createElement("style");
    style.id = "sc-nav-styles";
    style.textContent = [
      ".sc-nav { display:flex; align-items:center; justify-content:space-between; padding:0 24px; height:48px; border-bottom:1px solid #222; background:#0a0a0a; }",
      ".sc-nav-left, .sc-nav-right { display:flex; align-items:center; gap:16px; }",
      ".nav-link { color:#888; text-decoration:none; font-size:13px; letter-spacing:1px; transition:color 0.15s; }",
      ".nav-link:hover { color:#fff; }",
      ".nav-active { color:#fff; }",
      ".nav-brand { font-size:14px; font-weight:400; letter-spacing:2px; text-transform:uppercase; color:#fff; }",
      ".nav-register { background:#fff; color:#000; padding:6px 16px; border-radius:4px; font-size:12px; letter-spacing:1px; }",
      ".nav-register:hover { color:#000; opacity:0.85; }",
      ".nav-tier { font-size:10px; color:#555; letter-spacing:2px; text-transform:uppercase; padding:3px 8px; border:1px solid #333; border-radius:3px; }"
    ].join("\n");
    document.head.appendChild(style);
  }
};
