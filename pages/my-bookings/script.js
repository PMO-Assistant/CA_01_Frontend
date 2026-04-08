// -----------------------------------------------------------------------------
// My bookings page
// What: List / cancel (delete) bookings for ?empId=.
// Why:  Employee-facing booking management with cancel-only actions.
// -----------------------------------------------------------------------------
(function () {
  const root = document.getElementById("bookings-root");
  const statusEl = document.getElementById("bookings-status");
  const metaEl = document.getElementById("top-bar-meta");
  const toastEl = document.getElementById("bookings-toast");
  const cancelConfirmModal = document.getElementById("cancel-confirm-modal");
  const cancelConfirmKeepBtn = document.getElementById("cancel-confirm-keep");
  const cancelConfirmYesBtn = document.getElementById("cancel-confirm-yes");
  const assetsManageModal = document.getElementById("assets-manage-modal");
  const assetsManageMeta = document.getElementById("assets-manage-meta");
  const assetsManageList = document.getElementById("assets-manage-list");
  const assetsManageClose = document.getElementById("assets-manage-close");
  const assetsManageCancel = document.getElementById("assets-manage-cancel");
  const assetsManageSave = document.getElementById("assets-manage-save");

  document.getElementById("btn-back").addEventListener("click", () => {
    if (window.history.length > 1) window.history.back();
    else window.location.href = "../../index.html";
  });

  const params = new URLSearchParams(window.location.search);
  let empId = Number(params.get("empId"));
  if (!Number.isFinite(empId) || empId < 1) empId = null;

  metaEl.textContent = empId
    ? "Showing bookings for employee #" + String(empId) + " · add ?empId=2 to switch"
    : "Showing your bookings";

  let bookings = [];
  let loadError = "";
  let managingBooking = null;
  const assetOverflowUpdaters = [];
  const HOT_DESK_SESSION_TOKEN = "hotDeskSessionToken";

  function sessionHeaders() {
    try {
      const t = sessionStorage.getItem(HOT_DESK_SESSION_TOKEN);
      if (t && String(t).trim()) return { "X-Hot-Desk-Session": String(t).trim() };
    } catch (_) {}
    return {};
  }

  function apiCandidates(path) {
    const out = [];
    const seen = Object.create(null);
    const push = (u) => {
      if (!u || seen[u]) return;
      seen[u] = true;
      out.push(u);
    };
    const configuredApi =
      typeof window.HOT_DESK_API === "string" && window.HOT_DESK_API.trim()
        ? window.HOT_DESK_API.trim().replace(/\/$/, "")
        : "";
    if (configuredApi) push(configuredApi + path);
    if (window.location.protocol !== "file:") {
      const h = (window.location.hostname || "").toLowerCase();
      const isLocal =
        h === "localhost" ||
        h === "127.0.0.1" ||
        h === "[::1]" ||
        /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(h);
      if (isLocal) {
        push(window.location.origin.replace(/\/$/, "") + path);
        const proto = window.location.protocol === "https:" ? "https" : "http";
        push(proto + "://" + window.location.hostname + ":4000" + path);
      }
    }
    push("http://localhost:4000" + path);
    return out;
  }

  function showToast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.classList.toggle("bookings-toast--error", !!isError);
    toastEl.classList.add("is-visible");
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => {
      toastEl.classList.remove("is-visible");
    }, 3200);
  }

  function confirmCancelBookingUi() {
    return new Promise(function (resolve) {
      if (!cancelConfirmModal || !cancelConfirmKeepBtn || !cancelConfirmYesBtn) {
        resolve(window.confirm("Cancel this booking? This cannot be undone."));
        return;
      }

      let done = false;
      function finish(result) {
        if (done) return;
        done = true;
        cancelConfirmModal.hidden = true;
        cancelConfirmKeepBtn.removeEventListener("click", onKeep);
        cancelConfirmYesBtn.removeEventListener("click", onYes);
        cancelConfirmModal.removeEventListener("click", onBackdrop);
        document.removeEventListener("keydown", onKey);
        resolve(result);
      }
      function onKeep() {
        finish(false);
      }
      function onYes() {
        finish(true);
      }
      function onBackdrop(e) {
        if (e.target === cancelConfirmModal) finish(false);
      }
      function onKey(e) {
        if (e.key === "Escape") finish(false);
      }

      cancelConfirmModal.hidden = false;
      cancelConfirmKeepBtn.addEventListener("click", onKeep);
      cancelConfirmYesBtn.addEventListener("click", onYes);
      cancelConfirmModal.addEventListener("click", onBackdrop);
      document.addEventListener("keydown", onKey);
      cancelConfirmKeepBtn.focus();
    });
  }

  function bookingStartTime(booking) {
    const t = new Date(booking.bookingStart).getTime();
    return Number.isFinite(t) ? t : NaN;
  }

  function bookingEndTime(booking) {
    const t = new Date(booking.bookingFinish).getTime();
    return Number.isFinite(t) ? t : NaN;
  }

  /**
   * Next / current bookings first (left), by start time ascending.
   * Fully past bookings follow, most recent first.
   */
  function sortBookingsForDisplay(list) {
    const now = Date.now();
    const upcoming = [];
    const past = [];
    list.forEach(function (b) {
      const endMs = bookingEndTime(b);
      if (!Number.isFinite(endMs)) {
        upcoming.push(b);
        return;
      }
      if (endMs >= now) upcoming.push(b);
      else past.push(b);
    });
    upcoming.sort(function (a, b) {
      const ta = bookingStartTime(a);
      const tb = bookingStartTime(b);
      if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
      if (!Number.isFinite(ta)) return 1;
      if (!Number.isFinite(tb)) return -1;
      return ta - tb;
    });
    past.sort(function (a, b) {
      const ta = bookingStartTime(a);
      const tb = bookingStartTime(b);
      if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
      if (!Number.isFinite(ta)) return 1;
      if (!Number.isFinite(tb)) return -1;
      return tb - ta;
    });
    return upcoming.concat(past);
  }

  function formatWhenParts(booking) {
    const a = new Date(booking.bookingStart);
    const b = new Date(booking.bookingFinish);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) {
      return { date: "—", timeRange: "—" };
    }
    const datePart =
      String(a.getDate()).padStart(2, "0") +
      "/" +
      String(a.getMonth() + 1).padStart(2, "0") +
      "/" +
      String(a.getFullYear());
    const startTime = String(a.getHours()).padStart(2, "0") + ":" + String(a.getMinutes()).padStart(2, "0");
    const endTime = String(b.getHours()).padStart(2, "0") + ":" + String(b.getMinutes()).padStart(2, "0");
    return { date: datePart, timeRange: startTime + " - " + endTime };
  }

  function deskLines(booking) {
    const rows = booking.bookingDesks || [];
    return rows
      .map((bd) => {
        const desk = bd.desk;
        if (!desk) return null;
        const room = desk.room && desk.room.roomName;
        const deskId = desk.deskId;
        if (room && Number.isFinite(deskId)) return "Room " + room + " · Desk #" + String(deskId);
        return null;
      })
      .filter(Boolean);
  }

  function getSpaceSummary(booking) {
    const rows = booking && Array.isArray(booking.bookingDesks) ? booking.bookingDesks : [];
    const WHOLE_ROOM_ONLY = new Set(["F", "G", "H"]);
    if (!rows.length) {
      return { kind: "seat", icon: "armchair", text: "Seat" };
    }
    if (rows.length > 1) {
      const roomName =
        rows[0] && rows[0].desk && rows[0].desk.room && rows[0].desk.room.roomName
          ? String(rows[0].desk.room.roomName)
          : "";
      return { kind: "room", icon: "building-2", text: roomName ? "Room " + roomName : "Whole room" };
    }
    const first = rows[0] && rows[0].desk ? rows[0].desk : null;
    const roomName = first && first.room && first.room.roomName ? String(first.room.roomName) : "";
    const roomKey = roomName.trim().toUpperCase();
    if (roomKey && WHOLE_ROOM_ONLY.has(roomKey)) {
      return { kind: "room", icon: "building-2", text: "Room " + roomName };
    }
    const deskId = first && Number.isFinite(first.deskId) ? Number(first.deskId) : null;
    if (deskId != null) {
      return {
        kind: "seat",
        icon: "armchair",
        text: roomName ? "Room " + roomName + " - Seat " + String(deskId) : "Seat " + String(deskId),
      };
    }
    return { kind: "room", icon: "building-2", text: roomName ? "Room " + roomName : "Whole room" };
  }

  function assetNamesForCard(booking) {
    return (booking.assetBookings || [])
      .map(function (ab) {
        const a = ab && ab.asset;
        if (!a || typeof a.assetName !== "string" || !String(a.assetName).trim()) return null;
        return String(a.assetName).trim();
      })
      .filter(Boolean);
  }

  function fitAssetNamesIntoRow(assetNames, textEl, moreEl) {
    if (!textEl || !moreEl || !assetNames || !assetNames.length) return;
    const sep = ", ";
    const host = textEl.parentElement;
    if (!host) return;

    textEl.textContent = assetNames.join(sep);
    moreEl.hidden = true;
    if (textEl.scrollWidth <= textEl.clientWidth) return;

    let visibleCount = assetNames.length;
    while (visibleCount > 0) {
      const hiddenCount = assetNames.length - visibleCount;
      const shown = assetNames.slice(0, visibleCount).join(sep);
      textEl.textContent = shown;
      moreEl.textContent = "+" + String(hiddenCount);
      moreEl.hidden = false;
      const roomForText = host.clientWidth - moreEl.offsetWidth - 6;
      if (roomForText > 0 && textEl.scrollWidth <= roomForText) return;
      visibleCount -= 1;
    }
    textEl.textContent = "";
    moreEl.textContent = "+" + String(assetNames.length);
    moreEl.hidden = false;
  }

  function statusBadgeClass(status) {
    const s = String(status || "").trim().toLowerCase();
    if (s === "confirmed") return "booking-card__badge--confirmed";
    if (s === "pending") return "booking-card__badge--pending";
    if (s === "cancelled" || s === "canceled") return "booking-card__badge--cancelled";
    return "booking-card__badge--other";
  }

  function iconNameForAssetType(typeName) {
    const raw = String(typeName || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    if (!raw) return "package";
    if (raw.includes("monitor") || raw.includes("screen") || raw.includes("display") || raw === "tv") {
      return "monitor";
    }
    if (raw.includes("speaker") || raw.includes("audio") || raw.includes("sound")) return "speaker";
    if (raw.includes("projector") || raw.includes("presentation")) return "projector";
    if (raw.includes("camera")) return "camera";
    if (raw.includes("microphone") || raw.includes("mic")) return "mic";
    if (raw.includes("headset") || raw.includes("headphone")) return "headphones";
    if (raw.includes("table") || raw.includes("desk")) return "pen-tool";
    return "package";
  }

  /** One line for Manage Assets header: "16/04/26 09:00 - 17:00" when same calendar day. */
  function formatAssetsModalSlotLine(booking) {
    const a = new Date(booking.bookingStart);
    const b = new Date(booking.bookingFinish);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "—";
    function pad2(n) {
      return String(n).padStart(2, "0");
    }
    function shortDate(d) {
      return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + String(d.getFullYear()).slice(-2);
    }
    function timeOnly(d) {
      return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    }
    const sameDay =
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
    if (sameDay) {
      return shortDate(a) + " " + timeOnly(a) + " - " + timeOnly(b);
    }
    return shortDate(a) + " " + timeOnly(a) + " - " + shortDate(b) + " " + timeOnly(b);
  }

  function assetRowsFromJson(data) {
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (row) =>
          row &&
          (typeof row.assetId === "number" || typeof row.assetId === "string") &&
          typeof row.assetName === "string" &&
          typeof row.assetType === "string"
      )
      .map((row) => ({
        assetId: Number(row.assetId),
        assetName: row.assetName,
        assetType: row.assetType,
        status: typeof row.status === "string" && row.status.trim() ? row.status.trim() : "Available",
      }))
      .filter((row) => Number.isFinite(row.assetId));
  }

  async function fetchAssetsFromSqlApi() {
    const urls = apiCandidates("/api/assets");

    const tried = [];
    let lastErr = null;
    for (let i = 0; i < urls.length; i += 1) {
      const url = urls[i];
      if (tried.indexOf(url) !== -1) continue;
      tried.push(url);
      try {
        const res = await fetch(url, { credentials: "omit", headers: sessionHeaders() });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("Expected JSON array from /api/assets");
        return assetRowsFromJson(data);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Could not reach /api/assets");
  }

  async function fetchOccupiedAssetIdsForSlot(startIso, endIso) {
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return new Set();
    const params = new URLSearchParams();
    params.set("start", start.toISOString());
    params.set("end", end.toISOString());
    const urls = apiCandidates("/api/bookings/availability?" + params.toString());
    const tried = [];
    for (let i = 0; i < urls.length; i += 1) {
      const url = urls[i];
      if (tried.indexOf(url) !== -1) continue;
      tried.push(url);
      try {
        const res = await fetch(url, { credentials: "omit", headers: sessionHeaders() });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        const ids = new Set();
        (Array.isArray(data.occupiedAssetIds) ? data.occupiedAssetIds : []).forEach((id) => {
          const n = Number(id);
          if (Number.isFinite(n)) ids.add(n);
        });
        return ids;
      } catch (_) {}
    }
    return new Set();
  }

  async function patchBookingAssets(bookingId, selectedAssetIds) {
    const path = "/api/bookings/" + encodeURIComponent(String(bookingId));
    const urls = apiCandidates(path);
    let lastErr = null;
    for (let i = 0; i < urls.length; i += 1) {
      try {
        const res = await fetch(urls[i], {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...sessionHeaders() },
          credentials: "include",
          body: JSON.stringify({
            selectedAssets: selectedAssetIds.map((assetId) => ({ assetId })),
          }),
        });
        const text = await res.text();
        if (!res.ok) {
          let msg = "HTTP " + res.status;
          try {
            const j = JSON.parse(text);
            if (j && j.error) msg = j.error;
          } catch (_) {}
          throw new Error(msg);
        }
        return text ? JSON.parse(text) : {};
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Failed to update assets");
  }

  function closeAssetsManageModal() {
    if (!assetsManageModal) return;
    assetsManageModal.hidden = true;
    managingBooking = null;
  }

  async function openAssetsManageModal(booking) {
    if (!assetsManageModal || !assetsManageList || !assetsManageMeta) return;
    managingBooking = booking;
    assetsManageModal.hidden = false;
    assetsManageList.innerHTML = '<div class="assets-manage-modal__empty">Loading assets…</div>';
    assetsManageMeta.textContent =
      "List of assets available: " + formatAssetsModalSlotLine(booking);
    try {
      const allAssets = await fetchAssetsFromSqlApi();
      const occupied = await fetchOccupiedAssetIdsForSlot(booking.bookingStart, booking.bookingFinish);
      const currentlySelected = new Set(
        (booking.assetBookings || [])
          .map((ab) => Number(ab && ab.assetId))
          .filter(Number.isFinite)
      );
      currentlySelected.forEach((id) => occupied.delete(id));
      const rows = allAssets.filter(
        (a) => String(a.status || "").trim().toLowerCase() === "available" && !occupied.has(a.assetId)
      );
      assetsManageList.innerHTML = "";
      if (!rows.length) {
        assetsManageList.innerHTML =
          '<div class="assets-manage-modal__empty">No available assets for this booking slot.</div>';
      } else {
        const byType = new Map();
        rows.forEach(function (a) {
          const type = String(a.assetType || "Other");
          if (!byType.has(type)) byType.set(type, []);
          byType.get(type).push(a);
        });
        Array.from(byType.keys())
          .sort(function (a, b) {
            return a.localeCompare(b);
          })
          .forEach(function (typeName) {
            const groupTitle = document.createElement("div");
            groupTitle.className = "assets-manage-modal__group-title";
            groupTitle.innerHTML =
              '<i data-lucide="' +
              iconNameForAssetType(typeName) +
              '" aria-hidden="true"></i><span>' +
              typeName +
              "</span>";
            assetsManageList.appendChild(groupTitle);

            byType
              .get(typeName)
              .sort(function (a, b) {
                return String(a.assetName || "").localeCompare(String(b.assetName || ""));
              })
              .forEach((a) => {
                const label = document.createElement("label");
                label.className = "assets-manage-modal__row";
                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.value = String(a.assetId);
                cb.checked = currentlySelected.has(a.assetId);
                const itemIcon = document.createElement("span");
                itemIcon.className = "assets-manage-modal__item-icon";
                itemIcon.innerHTML =
                  '<i data-lucide="' + iconNameForAssetType(a.assetType) + '" aria-hidden="true"></i>';
                const name = document.createElement("span");
                name.className = "assets-manage-modal__name";
                name.textContent = a.assetName;
                const st = document.createElement("span");
                st.className = "assets-manage-modal__status";
                st.textContent = a.assetType;
                label.appendChild(cb);
                label.appendChild(itemIcon);
                label.appendChild(name);
                label.appendChild(st);
                assetsManageList.appendChild(label);
              });
          });
      }
      if (window.lucide && typeof window.lucide.createIcons === "function") {
        window.lucide.createIcons();
      }
    } catch (e) {
      assetsManageList.innerHTML =
        '<div class="assets-manage-modal__empty">Could not load assets. Please try again.</div>';
    }
  }

  async function fetchBookingsJson() {
    if (!Number.isFinite(empId) || empId < 1) {
      const meUrls = apiCandidates("/api/auth/me");
      let me = null;
      for (let mi = 0; mi < meUrls.length; mi += 1) {
        try {
          const r = await fetch(meUrls[mi], {
            credentials: "include",
            headers: sessionHeaders(),
          });
          if (!r.ok) continue;
          me = await r.json();
          if (me && Number.isFinite(Number(me.empId))) break;
        } catch (_) {}
      }
      if (!me || !Number.isFinite(Number(me.empId))) {
        throw new Error("Please sign in first.");
      }
      empId = Number(me.empId);
      metaEl.textContent = "Showing bookings for " + (me.name || ("employee #" + String(empId)));
    }
    const qs = "?empId=" + encodeURIComponent(String(empId));
    const urls = apiCandidates("/api/bookings" + qs);

    const tried = [];
    let lastErr = null;
    for (let i = 0; i < urls.length; i += 1) {
      const url = urls[i];
      if (tried.indexOf(url) !== -1) continue;
      tried.push(url);
      try {
        const res = await fetch(url, { credentials: "include", headers: sessionHeaders() });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        if (data && typeof data.error === "string" && !Array.isArray(data)) {
          throw new Error(data.error);
        }
        if (!Array.isArray(data)) throw new Error("Expected JSON array");
        return data;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Could not reach /api/bookings");
  }

  async function deleteBooking(bookingId) {
    const path = "/api/bookings/" + encodeURIComponent(String(bookingId));
    const urls = apiCandidates(path);

    const tried = [];
    let lastErr = null;
    for (let i = 0; i < urls.length; i += 1) {
      const url = urls[i];
      if (tried.indexOf(url) !== -1) continue;
      tried.push(url);
      try {
        const res = await fetch(url, {
          method: "DELETE",
          credentials: "include",
          headers: sessionHeaders(),
        });
        if (res.status === 404) throw new Error("Booking not found");
        if (!res.ok) {
          const text = await res.text();
          let errMsg = "HTTP " + res.status;
          try {
            const j = JSON.parse(text);
            if (j && j.error) errMsg = j.error;
          } catch (_) {}
          throw new Error(errMsg);
        }
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  }

  function render() {
    root.innerHTML = "";
    assetOverflowUpdaters.length = 0;
    if (loadError) {
      const p = document.createElement("p");
      p.className = "bookings-empty";
      p.innerHTML = loadError;
      root.appendChild(p);
      return;
    }
    if (!bookings.length) {
      const p = document.createElement("p");
      p.className = "bookings-empty";
      p.textContent = "No bookings yet. Create one from the floor plan after your API saves bookings to the database.";
      root.appendChild(p);
      return;
    }

    bookings.forEach((b) => {
      const card = document.createElement("article");
      card.className = "booking-card";

      const body = document.createElement("div");
      body.className = "booking-card__body";

      const meta = document.createElement("div");
      meta.className = "booking-card__meta";
      const idChip = document.createElement("div");
      idChip.className = "booking-card__id";
      idChip.innerHTML =
        '<i data-lucide="hash" aria-hidden="true"></i><span>' + String(b.bookingId) + "</span>";
      const head = document.createElement("div");
      head.className = "booking-card__head";
      const when = document.createElement("div");
      when.className = "booking-card__when";
      const space = getSpaceSummary(b);
      const whenSpace = document.createElement("div");
      whenSpace.className = "booking-card__when-space";
      whenSpace.innerHTML =
        '<i data-lucide="' +
        space.icon +
        '" aria-hidden="true"></i><span class="booking-card__when-space-text">' +
        space.text +
        "</span>";
      const whenParts = formatWhenParts(b);
      const whenTime = document.createElement("div");
      whenTime.className = "booking-card__when-time";
      whenTime.textContent = whenParts.timeRange;
      const whenDate = document.createElement("div");
      whenDate.className = "booking-card__when-date";
      whenDate.textContent = whenParts.date;
      when.appendChild(whenSpace);
      when.appendChild(whenTime);
      when.appendChild(whenDate);
      const badge = document.createElement("span");
      badge.className = "booking-card__badge " + statusBadgeClass(b.status);
      badge.textContent = String(b.status || "—");
      meta.appendChild(idChip);
      meta.appendChild(badge);
      head.appendChild(when);
      body.appendChild(meta);
      const main = document.createElement("div");
      main.className = "booking-card__main";
      main.appendChild(head);
      body.appendChild(main);

      let assetsWrap = null;
      const assetNames = assetNamesForCard(b);
      if (assetNames.length) {
        assetsWrap = document.createElement("div");
        assetsWrap.className = "booking-card__assets";
        const row = document.createElement("div");
        row.className = "booking-card__assets-row";
        const rowIcon = document.createElement("i");
        rowIcon.setAttribute("data-lucide", "package");
        rowIcon.setAttribute("aria-hidden", "true");
        const rowLabel = document.createElement("span");
        rowLabel.className = "booking-card__assets-label";
        rowLabel.textContent = "Assets";
        const rowText = document.createElement("span");
        rowText.className = "booking-card__assets-text";
        rowText.textContent = assetNames.join(", ");
        rowText.title = assetNames.join(", ");
        const rowMore = document.createElement("span");
        rowMore.className = "booking-card__assets-more";
        rowMore.hidden = true;
        rowMore.setAttribute("aria-hidden", "true");
        row.appendChild(rowIcon);
        row.appendChild(rowLabel);
        row.appendChild(rowText);
        row.appendChild(rowMore);
        assetsWrap.appendChild(row);
        assetOverflowUpdaters.push(function () {
          fitAssetNamesIntoRow(assetNames, rowText, rowMore);
        });
      }
      const actions = document.createElement("div");
      actions.className = "booking-card__actions";
      const manageBtn = document.createElement("button");
      manageBtn.type = "button";
      manageBtn.className = "booking-card__btn booking-card__btn--manage";
      manageBtn.textContent = "Manage Assets";
      manageBtn.addEventListener("click", async () => {
        await openAssetsManageModal(b);
      });
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "booking-card__btn booking-card__btn--delete";
      delBtn.textContent = "Cancel Booking";
      delBtn.addEventListener("click", async () => {
        const ok = await confirmCancelBookingUi();
        if (!ok) return;
        try {
          await deleteBooking(b.bookingId);
          showToast("Booking cancelled");
          await reload();
        } catch (e) {
          console.error(e);
          showToast(e.message || "Cancel failed", true);
        }
      });
      actions.appendChild(manageBtn);
      actions.appendChild(delBtn);
      const footer = document.createElement("div");
      footer.className = "booking-card__footer";
      if (assetsWrap) footer.appendChild(assetsWrap);
      footer.appendChild(actions);
      body.appendChild(footer);

      card.appendChild(body);
      root.appendChild(card);
    });
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
    if (assetOverflowUpdaters.length) {
      window.requestAnimationFrame(function () {
        assetOverflowUpdaters.forEach(function (update) {
          update();
        });
      });
    }
  }

  async function reload() {
    try {
      loadError = "";
      const data = await fetchBookingsJson();
      bookings = sortBookingsForDisplay(data);
    } catch (e) {
      console.error("[my-bookings]", e);
      bookings = [];
      loadError =
        "Could not load bookings from the server. Check the API is reachable and that <code>window.HOT_DESK_API</code> points to your backend.";
    }
    render();
  }

  statusEl.textContent = "Loading…";
  if (assetsManageClose) assetsManageClose.addEventListener("click", closeAssetsManageModal);
  if (assetsManageCancel) assetsManageCancel.addEventListener("click", closeAssetsManageModal);
  if (assetsManageModal) {
    assetsManageModal.addEventListener("click", function (e) {
      if (e.target === assetsManageModal) closeAssetsManageModal();
    });
  }
  if (assetsManageSave) {
    assetsManageSave.addEventListener("click", async function () {
      if (!managingBooking || !assetsManageList) return;
      const checks = assetsManageList.querySelectorAll('input[type="checkbox"]');
      const ids = [];
      checks.forEach(function (cb) {
        if (cb.checked) {
          const n = Number(cb.value);
          if (Number.isFinite(n)) ids.push(n);
        }
      });
      try {
        await patchBookingAssets(managingBooking.bookingId, ids);
        showToast("Booking assets updated");
        closeAssetsManageModal();
        await reload();
      } catch (e) {
        showToast((e && e.message) || "Failed to update assets", true);
      }
    });
  }
  reload()
    .then(() => {
      if (statusEl.parentNode) statusEl.remove();
    })
    .catch(() => {
      if (statusEl.parentNode) statusEl.remove();
    });
})();
