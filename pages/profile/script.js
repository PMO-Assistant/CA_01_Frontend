(function () {
  var signInHref = new URL("../sign-in/index.html", window.location.href).href;
  var homeHref = new URL("../../index.html", window.location.href).href;

  function $(sel) {
    return document.querySelector(sel);
  }

  function formatDate(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch (_) {
      return iso;
    }
  }

  function setStatus(el, text, kind) {
    if (!el) return;
    el.textContent = text || "";
    el.classList.remove("profile-status--err");
    if (kind === "err") el.classList.add("profile-status--err");
    el.hidden = !text;
  }

  function redirectUnauthenticated() {
    try {
      sessionStorage.removeItem("hotDeskCardLoggedIn");
    } catch (_) {}
    window.location.href = signInHref;
  }

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function initialsFromName(name) {
    var t = String(name || "").trim();
    if (!t) return "?";
    var parts = t.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return t.length >= 2 ? t.slice(0, 2).toUpperCase() : t.charAt(0).toUpperCase();
  }

  function renderDl(dl, rows) {
    if (!dl) return;
    dl.innerHTML = "";
    rows.forEach(function (r) {
      var dt = document.createElement("dt");
      dt.textContent = r.label;
      var dd = document.createElement("dd");
      dd.textContent = r.value == null || r.value === "" ? "—" : String(r.value);
      if (r.mono) dd.classList.add("profile-mono");
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
  }

  function renderTags(tags) {
    var list = $("#profile-tags-list");
    var empty = $("#profile-tags-empty");
    if (!list || !empty) return;
    list.innerHTML = "";
    if (!tags || !tags.length) {
      list.hidden = true;
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    list.hidden = false;
    tags.forEach(function (t) {
      var summary = (t.summary && String(t.summary)) || "";
      var pillClass = "profile-pill--muted";
      if (t.isExpired) pillClass = "profile-pill--bad";
      else if (t.notYetValid) pillClass = "profile-pill--warn";
      else if (t.allowedForLogin) pillClass = "profile-pill--ok";
      var statePill = summary
        ? '<span class="profile-pill ' + pillClass + '">' + escapeHtml(summary) + "</span>"
        : "";

      var row = document.createElement("div");
      row.className = "profile-tag-row" + (t.isLoginTag ? " profile-tag-row--current" : "");
      row.innerHTML =
        '<div class="profile-tag-row__badge">' +
        (t.isLoginTag
          ? '<span class="profile-pill profile-pill--accent">This session</span>'
          : '<span class="profile-pill">Card</span>') +
        statePill +
        "</div>" +
        '<div class="profile-tag-row__grid">' +
        '<div><span class="profile-k">Tag ID</span><span class="profile-v">' +
        escapeHtml(String(t.tagId)) +
        "</span></div>" +
        '<div><span class="profile-k">Record status</span><span class="profile-v">' +
        escapeHtml(String(t.status || "—")) +
        "</span></div>" +
        '<div class="profile-tag-row__full"><span class="profile-k">NFC UID</span><span class="profile-v profile-mono">' +
        escapeHtml(t.nfcUid || "—") +
        "</span></div>" +
        '<div><span class="profile-k">Valid from</span><span class="profile-v">' +
        escapeHtml(formatDate(t.startDate)) +
        "</span></div>" +
        '<div><span class="profile-k">Expires</span><span class="profile-v">' +
        escapeHtml(formatDate(t.expiryDate)) +
        "</span></div>" +
        "</div>";
      list.appendChild(row);
    });
  }

  function renderStats(stats) {
    var grid = $("#profile-stats-grid");
    if (!grid) return;
    stats = stats || {};
    function num(k) {
      var v = stats[k];
      if (v == null || v === "") return "—";
      return String(v);
    }
    var items = [
      { value: num("bookingCount"), label: "Bookings (all time)" },
      { value: num("upcomingBookingCount"), label: "Upcoming bookings" },
      { value: num("pastBookingCount"), label: "Past bookings" },
      { value: num("deskBookingCount"), label: "Bookings with a desk" },
      { value: num("assetBookingCount"), label: "Asset reservations" },
      { value: num("distinctAssetsBooked"), label: "Distinct assets used" },
      { value: num("tagsTotal"), label: "Access cards (total)" },
      { value: num("tagsOkForLogin"), label: "Cards OK for login" },
      { value: num("tagsExpired"), label: "Cards expired" },
      { value: num("tagsOtherInactive"), label: "Cards inactive (not expired)" },
    ];
    grid.innerHTML = items
      .map(function (it) {
        return (
          '<div class="profile-stat"><div class="profile-stat__value">' +
          escapeHtml(it.value) +
          '</div><div class="profile-stat__label">' +
          escapeHtml(it.label) +
          "</div></div>"
        );
      })
      .join("");
  }

  function showHero(emp) {
    var hero = $("#profile-hero");
    var av = $("#profile-avatar");
    var nameEl = $("#profile-hero-name");
    var metaEl = $("#profile-hero-meta");
    var badge = $("#profile-hero-badge");
    if (!hero || !av || !nameEl || !metaEl || !badge) return;

    var displayName = (emp && emp.name) || "—";
    nameEl.textContent = displayName;
    av.textContent = initialsFromName(displayName);

    var metaParts = [];
    if (emp && emp.empId != null) metaParts.push("Employee #" + emp.empId);
    if (emp && emp.createdAt) metaParts.push("Joined " + formatDate(emp.createdAt));
    metaEl.textContent = metaParts.join(" · ");

    if (emp && emp.isActive === false) {
      badge.textContent = "Inactive account";
      badge.className = "profile-hero__badge is-inactive";
      badge.hidden = false;
    } else {
      badge.textContent = "Active";
      badge.className = "profile-hero__badge is-active";
      badge.hidden = false;
    }

    hero.hidden = false;
  }

  function showLoadFailed(msg) {
    var hero = $("#profile-hero");
    if (hero) hero.hidden = true;
    var statsSection = $("#profile-section-stats");
    if (statsSection) statsSection.hidden = false;
    renderStats({});
    var nameInput = $("#profile-name-input");
    if (nameInput) nameInput.value = "";
    renderDl($("#profile-dl-employee"), [
      { label: "Employee ID", value: "—" },
      { label: "Account status", value: "—" },
      { label: "Record created", value: "—" },
    ]);
    renderTags([]);
  }

  function setNameSaveStatus(el, text, kind) {
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("is-err", kind === "err");
  }

  function fetchProfile() {
    return hotDeskApiJsonSimple("GET", "/api/me/profile");
  }

  function applyProfile(data) {
    var emp = data.employee || {};
    var stats = data.stats || {};

    showHero(emp);

    var statsSection = $("#profile-section-stats");
    if (statsSection) statsSection.hidden = false;
    renderStats(stats);

    var nameInput = $("#profile-name-input");
    if (nameInput) nameInput.value = emp.name != null ? String(emp.name) : "";

    renderDl($("#profile-dl-employee"), [
      { label: "Employee ID", value: emp.empId },
      { label: "Account status", value: emp.isActive === false ? "Inactive" : "Active" },
      { label: "Record created", value: formatDate(emp.createdAt) },
    ]);

    renderTags(data.tags);
  }

  async function saveProfileName(ev) {
    ev.preventDefault();
    var input = $("#profile-name-input");
    var btn = $("#profile-name-save");
    var st = $("#profile-name-save-status");
    if (!input) return;
    var name = String(input.value || "").trim();
    if (!name) {
      setNameSaveStatus(st, "Enter a name.", "err");
      return;
    }
    if (btn) btn.disabled = true;
    setNameSaveStatus(st, "Saving…", null);
    try {
      await hotDeskApiJsonSimple("PATCH", "/api/me/profile", { name: name });
      var data = await fetchProfile();
      applyProfile(data);
      if (typeof window.updateWelcomeUserName === "function") {
        window.updateWelcomeUserName((data.employee && data.employee.name) || name);
      }
      setNameSaveStatus(st, "Saved.", null);
    } catch (e) {
      var msg = e && e.message ? String(e.message) : "Could not save";
      if (/HTTP 401|Not authenticated/i.test(msg)) {
        redirectUnauthenticated();
        return;
      }
      setNameSaveStatus(st, msg, "err");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function load() {
    setStatus($("#profile-load-status"), "Loading your profile…", null);
    renderStats({});

    try {
      var data = await fetchProfile();
      setStatus($("#profile-load-status"), "", null);
      applyProfile(data);
    } catch (e) {
      var msg = e && e.message ? String(e.message) : "Could not load profile";
      if (/HTTP 401|Not authenticated/i.test(msg)) {
        redirectUnauthenticated();
        return;
      }
      setStatus($("#profile-load-status"), msg, "err");
      showLoadFailed(msg);
    }
  }

  var backBtn = $("#profile-back");
  if (backBtn) {
    backBtn.addEventListener("click", function () {
      window.location.href = homeHref;
    });
  }

  var nameForm = $("#profile-name-form");
  if (nameForm) nameForm.addEventListener("submit", saveProfileName);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
