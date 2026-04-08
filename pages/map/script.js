// -----------------------------------------------------------------------------
// Floor plan / seat picker page
// What: Back nav, SVG floorplan (clusters + meeting rooms), pan/zoom, desk selection, asset
//       drawer from API, Flatpickr slot, draft hand-off to my-bookings.
// Why:  Prototype map UX; seat layout model adapted from CodePen by Nick Watton
//       (https://codepen.io/2Mogs/pen/rNpOORQ).
// -----------------------------------------------------------------------------
document.getElementById("btn-back").addEventListener("click", () => {
  if (window.history.length > 1) window.history.back();
  else window.location.href = "../home/index.html";
});

const appRoot = document.querySelector(".app");
const floorplan = document.querySelector("#floorplan");
const nextFab = document.getElementById("btn-next");
const timeStartInput = document.querySelector("#time-start");
const timeEndInput = document.querySelector("#time-end");
const btnAssetsToggle = document.getElementById("btn-assets-toggle");
const assetPanel = document.getElementById("asset-panel");
const assetList = document.getElementById("asset-list");
const assetBackdrop = document.getElementById("asset-backdrop");
const assetPanelClose = document.getElementById("asset-panel-close");
const mapNotice = document.getElementById("map-notice");
const mapNoticeText = document.getElementById("map-notice-text");
const mapNoticeClose = document.getElementById("map-notice-close");
const bookingConfirm = document.getElementById("booking-confirm");
const confirmDate = document.getElementById("confirm-date");
const confirmTime = document.getElementById("confirm-time");
const confirmSpace = document.getElementById("confirm-space");
const confirmAssets = document.getElementById("confirm-assets");
const confirmCancel = document.getElementById("confirm-cancel");
const confirmSubmit = document.getElementById("confirm-submit");
const bookingSuccess = document.getElementById("booking-success");
let mapNoticeTimer = null;
let pendingBookingBody = null;
const HOT_DESK_SESSION_TOKEN = "hotDeskSessionToken";

function getSessionTokenHeader() {
  try {
    const t = sessionStorage.getItem(HOT_DESK_SESSION_TOKEN);
    if (t && String(t).trim()) return { "X-Hot-Desk-Session": String(t).trim() };
  } catch (_) {}
  return {};
}

function apiCandidates(path) {
  const p = String(path || "");
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
  if (configuredApi) push(configuredApi + p);
  if (window.location.protocol !== "file:") {
    const h = (window.location.hostname || "").toLowerCase();
    const isLocal =
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "[::1]" ||
      /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(h);
    if (isLocal) {
      push(window.location.origin.replace(/\/$/, "") + p);
      const proto = window.location.protocol === "https:" ? "https" : "http";
      push(proto + "://" + window.location.hostname + ":4000" + p);
    }
  }
  push("http://localhost:4000" + p);
  return out;
}

function showMapNotice(message, isError) {
  if (!mapNotice || !mapNoticeText) return;
  mapNoticeText.textContent = String(message || "");
  mapNotice.classList.toggle("map-notice--error", !!isError);
  mapNotice.classList.toggle("map-notice--info", !isError);
  mapNotice.classList.add("is-visible");
  if (mapNoticeTimer) clearTimeout(mapNoticeTimer);
  mapNoticeTimer = setTimeout(function () {
    mapNotice.classList.remove("is-visible");
  }, isError ? 5200 : 3600);
}
if (mapNoticeClose) {
  mapNoticeClose.addEventListener("click", function () {
    if (mapNoticeTimer) clearTimeout(mapNoticeTimer);
    if (mapNotice) mapNotice.classList.remove("is-visible");
  });
}
if (confirmCancel) {
  confirmCancel.addEventListener("click", function () {
    if (bookingConfirm) bookingConfirm.classList.remove("is-open");
    pendingBookingBody = null;
  });
}
if (confirmSubmit) {
  confirmSubmit.addEventListener("click", function () {
    if (!pendingBookingBody) return;
    submitBookingPayload(pendingBookingBody);
  });
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
    .map((row) => {
      const statusRaw = row.status;
      const status =
        typeof statusRaw === "string" && statusRaw.trim()
          ? statusRaw.trim()
          : "Available";
      return {
        assetId: Number(row.assetId),
        assetName: row.assetName,
        assetType: row.assetType,
        status,
      };
    })
    .filter((row) => Number.isFinite(row.assetId));
}

function isAssetBooked(a) {
  if (!a) return false;
  return occupiedAssetIds.has(a.assetId);
}

function isAssetStatusBookable(a) {
  const raw = String((a && a.status) || "")
    .trim()
    .toLowerCase();
  if (!raw) return true;
  return raw === "available";
}

function isAssetSelectable(a) {
  return !isAssetBooked(a) && isAssetStatusBookable(a);
}

function formatStatusTitle(raw) {
  const s = String(raw || "").trim();
  if (!s) return "Unavailable";
  return s
    .toLowerCase()
    .split(/\s+/)
    .map(function (w) {
      return w ? w.charAt(0).toUpperCase() + w.slice(1) : "";
    })
    .join(" ");
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
      const res = await fetch(url, { credentials: "omit", headers: getSessionTokenHeader() });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (data && typeof data.error === "string" && !Array.isArray(data)) {
        throw new Error(data.error);
      }
      if (!Array.isArray(data)) {
        throw new Error("Expected a JSON array from /api/assets");
      }
      const rows = assetRowsFromJson(data);
      if (rows.length === 0 && data.length === 0) {
        return { rows: [], url };
      }
      if (rows.length === 0) {
        throw new Error("No valid Asset rows (need assetId, assetName, assetType)");
      }
      return { rows, url };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Could not reach /api/assets");
}

let assetsCatalog = [];
const selectedAssetIds = new Set();
const occupiedAssetIds = new Set();
const occupiedDeskKeySet = new Set();
const occupiedRoomSet = new Set();

function isAssetPanelOpen() {
  return appRoot.classList.contains("asset-panel-open");
}

function openAssetPanel() {
  appRoot.classList.add("asset-panel-open");
  assetPanel.setAttribute("aria-hidden", "false");
  assetBackdrop.setAttribute("aria-hidden", "false");
  btnAssetsToggle.setAttribute("aria-expanded", "true");
}

function closeAssetPanel() {
  appRoot.classList.remove("asset-panel-open");
  assetPanel.setAttribute("aria-hidden", "true");
  assetBackdrop.setAttribute("aria-hidden", "true");
  btnAssetsToggle.setAttribute("aria-expanded", "false");
}

function toggleAssetPanel() {
  if (isAssetPanelOpen()) closeAssetPanel();
  else openAssetPanel();
}

function getSelectedAssetsPayload() {
  return assetsCatalog
    .filter((a) => selectedAssetIds.has(a.assetId) && isAssetSelectable(a))
    .map((a) => ({
      assetId: a.assetId,
      assetName: a.assetName,
      assetType: a.assetType,
    }));
}

const ASSET_TYPE_ICON_INNER = {
  screen:
    '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  "drawing table":
    '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8"/><path d="M8 11h6"/>',
  speaker:
    '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  projector:
    '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M8 21h8"/><path d="M12 18v3"/><circle cx="12" cy="12" r="2"/><path d="M6 10h.01"/><path d="M18 10h.01"/>',
  camera:
    '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  microphone:
    '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
  headset:
    '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>',
  default:
    '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
};

const ASSET_TYPE_ICON_ALIASES = {
  monitor: "screen",
  display: "screen",
  displays: "screen",
  tv: "screen",
  audio: "speaker",
  sound: "speaker",
  draft: "drawing table",
  whiteboard: "drawing table",
};

function iconInnerForAssetType(typeName) {
  const raw = String(typeName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const compact = raw.replace(/\s/g, "");
  const candidates = [
    ASSET_TYPE_ICON_ALIASES[raw],
    ASSET_TYPE_ICON_ALIASES[compact],
    raw,
    compact,
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i];
    if (!c) continue;
    if (ASSET_TYPE_ICON_INNER[c]) return ASSET_TYPE_ICON_INNER[c];
    const cCompact = c.replace(/\s/g, "");
    if (ASSET_TYPE_ICON_INNER[cCompact]) return ASSET_TYPE_ICON_INNER[cCompact];
  }
  return ASSET_TYPE_ICON_INNER.default;
}

function createAssetTypeIconEl(typeName) {
  const inner = iconInnerForAssetType(typeName);
  const markup =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    inner +
    "</svg>";
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  const svg = doc.documentElement;
  const wrap = document.createElement("span");
  wrap.className = "asset-panel__group-title-icon";
  wrap.setAttribute("aria-hidden", "true");
  wrap.appendChild(svg);
  return wrap;
}

function renderAssetList() {
  if (!assetsCatalog.length) {
    assetList.innerHTML =
      '<p class="asset-panel__empty">No assets in the list. If the API works but the database is empty, run <code>npx prisma db seed</code> in the Backend folder>.</p>';
    return;
  }
  assetsCatalog.forEach((a) => {
    if (!isAssetSelectable(a)) selectedAssetIds.delete(a.assetId);
  });
  const byType = new Map();
  const sorted = [...assetsCatalog].sort((a, b) => {
    const t = a.assetType.localeCompare(b.assetType);
    if (t !== 0) return t;
    return a.assetName.localeCompare(b.assetName);
  });
  sorted.forEach((a) => {
    if (!byType.has(a.assetType)) byType.set(a.assetType, []);
    byType.get(a.assetType).push(a);
  });
  assetList.innerHTML = "";
  byType.forEach((items, typeName) => {
    const group = document.createElement("div");
    group.className = "asset-panel__group";
    const title = document.createElement("div");
    title.className = "asset-panel__group-title";
    title.appendChild(createAssetTypeIconEl(typeName));
    const titleText = document.createElement("span");
    titleText.className = "asset-panel__group-title-text";
    titleText.textContent = typeName;
    title.appendChild(titleText);
    group.appendChild(title);
    items.forEach((a) => {
      const selectable = isAssetSelectable(a);
      const unavailableReason = isAssetBooked(a) ? "Booked" : formatStatusTitle(a.status);
      const row = document.createElement("label");
      row.className = "asset-panel__row" + (selectable ? "" : " asset-panel__row--booked");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selectable ? selectedAssetIds.has(a.assetId) : false;
      cb.disabled = !selectable;
      if (selectable) {
        cb.addEventListener("change", () => {
          if (cb.checked) selectedAssetIds.add(a.assetId);
          else selectedAssetIds.delete(a.assetId);
          updateSelectionDock();
        });
      }
      if (!selectable) row.setAttribute("aria-disabled", "true");
      const textWrap = document.createElement("span");
      textWrap.className = "asset-panel__row-text";
      const nameEl = document.createElement("span");
      nameEl.className = "asset-panel__row-name";
      nameEl.textContent = a.assetName;
      textWrap.appendChild(nameEl);
      if (!selectable) {
        const badge = document.createElement("span");
        badge.className = "asset-panel__booked-badge";
        badge.textContent = unavailableReason;
        textWrap.appendChild(badge);
      }
      row.appendChild(cb);
      row.appendChild(textWrap);
      group.appendChild(row);
    });
    assetList.appendChild(group);
  });
  updateSelectionDock();
}

async function loadAssetsCatalog() {
  assetList.innerHTML = '<p class="asset-panel__empty">Loading from database…</p>';
  try {
    const { rows } = await fetchAssetsFromSqlApi();
    assetsCatalog = rows;
  } catch (e) {
    console.error("[map] Assets API:", e);
    assetsCatalog = [];
    assetList.innerHTML =
      '<p class="asset-panel__empty">Could not load assets from the server. Start the Backend API, ensure the <code>Asset</code> table has data, and open the app from the same origin as the API (or set <code>window.HOT_DESK_API</code> to your API base URL).</p>';
    return;
  }
  renderAssetList();
}

btnAssetsToggle.addEventListener("click", () => toggleAssetPanel());
assetPanelClose.addEventListener("click", () => closeAssetPanel());
assetBackdrop.addEventListener("click", () => closeAssetPanel());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isAssetPanelOpen()) closeAssetPanel();
});

loadAssetsCatalog();
if (new URLSearchParams(window.location.search).get("openAssets") === "1") {
  openAssetPanel();
}

function getMapSelectionSummary() {
  const deskEl = document.querySelector(".desk.user-selected");
  const meetingWrap = document.querySelector(".desk-set.meeting-selected")?.closest(".meeting-room");
  if (deskEl) {
    const d = deskEl.dataset.desk_id;
    const r = deskEl.dataset.room;
    if (r) return "Seat " + d + " · Room " + r;
    return d ? "Seat " + d : "Seat selected";
  }
  if (meetingWrap) {
    const letter = meetingWrap.getAttribute("data-room");
    return letter ? "Room " + letter + " (whole space)" : "Meeting space";
  }
  return "";
}

function updateSelectionDock() {
  const dock = document.getElementById("selection-dock");
  const spaceEl = document.getElementById("selection-dock-space");
  const listEl = document.getElementById("selection-dock-assets");
  if (!dock || !spaceEl || !listEl) return;
  const show = nextFab.classList.contains("next-fab--visible");
  if (!show) {
    dock.classList.remove("selection-dock--visible");
    dock.setAttribute("aria-hidden", "true");
    spaceEl.textContent = "";
    listEl.innerHTML = "";
    return;
  }
  dock.classList.add("selection-dock--visible");
  dock.setAttribute("aria-hidden", "false");
  spaceEl.textContent = getMapSelectionSummary() || "—";
  const picked = assetsCatalog.filter((a) => selectedAssetIds.has(a.assetId) && isAssetSelectable(a));
  listEl.innerHTML = "";
  if (picked.length === 0) {
    const li = document.createElement("li");
    li.className = "selection-dock__asset selection-dock__asset--empty";
    li.textContent = "None";
    listEl.appendChild(li);
  } else {
    picked.forEach((a) => {
      const li = document.createElement("li");
      li.className = "selection-dock__asset";
      li.textContent = a.assetName;
      listEl.appendChild(li);
    });
  }
}

function updateNextFabVisibility() {
  const hasDesk = !!floorplan.querySelector(".desk.user-selected");
  const hasMeetingRoom = !!floorplan.querySelector(".desk-set.meeting-selected");
  const show = hasDesk || hasMeetingRoom;
  nextFab.classList.toggle("next-fab--visible", show);
  nextFab.setAttribute("aria-hidden", show ? "false" : "true");
  updateSelectionDock();
}

function currentSlotRangeIso() {
  const slot = window.getBookingSlot();
  if (!slot || !slot.date || !slot.startTime || !slot.endTime) return null;
  const start = new Date(slot.date + "T" + slot.startTime);
  const end = new Date(slot.date + "T" + slot.endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

async function fetchSlotAvailability() {
  const range = currentSlotRangeIso();
  if (!range) {
    occupiedDeskKeySet.clear();
    occupiedRoomSet.clear();
    occupiedAssetIds.clear();
    return;
  }
  const url = "/api/bookings/availability?start=" + encodeURIComponent(range.startIso) +
    "&end=" + encodeURIComponent(range.endIso);
  const urls = apiCandidates(url);
  let lastErr = null;
  let data = null;
  for (let i = 0; i < urls.length; i += 1) {
    try {
      const res = await fetch(urls[i], { credentials: "omit", headers: getSessionTokenHeader() });
      if (!res.ok) throw new Error("availability HTTP " + res.status);
      data = await res.json();
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!data) throw lastErr || new Error("availability request failed");
  occupiedDeskKeySet.clear();
  occupiedRoomSet.clear();
  occupiedAssetIds.clear();
  (Array.isArray(data.occupiedDeskKeys) ? data.occupiedDeskKeys : []).forEach(function (k) {
    occupiedDeskKeySet.add(String(k));
  });
  (Array.isArray(data.occupiedRooms) ? data.occupiedRooms : []).forEach(function (r) {
    occupiedRoomSet.add(String(r).toUpperCase());
  });
  (Array.isArray(data.occupiedAssetIds) ? data.occupiedAssetIds : []).forEach(function (id) {
    var n = Number(id);
    if (Number.isFinite(n)) occupiedAssetIds.add(n);
  });
}

async function hasOwnBookingOverlap(bookingStartIso, bookingFinishIso) {
  const start = new Date(bookingStartIso);
  const end = new Date(bookingFinishIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return false;

  const urls = apiCandidates("/api/bookings");
  let lastErr = null;
  for (let i = 0; i < urls.length; i += 1) {
    try {
      const res = await fetch(urls[i], { credentials: "include", headers: getSessionTokenHeader() });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const rows = await res.json();
      if (!Array.isArray(rows)) return false;
      for (let j = 0; j < rows.length; j += 1) {
        const row = rows[j];
        const status = String(row && row.status ? row.status : "").toLowerCase();
        if (status !== "confirmed" && status !== "pending") continue;
        const rowStart = new Date(row.bookingStart);
        const rowEnd = new Date(row.bookingFinish);
        if (Number.isNaN(rowStart.getTime()) || Number.isNaN(rowEnd.getTime())) continue;
        if (rowStart < end && rowEnd > start) return true;
      }
      return false;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) {
    console.warn("[map overlap check]", lastErr && lastErr.message ? lastErr.message : lastErr);
  }
  return false;
}

function applySlotAvailabilityToMap() {
  allDesks.forEach(function (desk) {
    var room = String(desk.getAttribute("data-room") || "").toUpperCase();
    var seat = String(desk.getAttribute("data-desk_id") || "");
    var occupied = room && seat && occupiedDeskKeySet.has(room + ":" + seat);
    if (occupied) {
      desk.classList.add("unavailable");
      desk.setAttribute("data-bookable", "false");
      desk.classList.remove("user-selected");
    } else {
      desk.classList.remove("unavailable");
      desk.removeAttribute("data-bookable");
    }
  });
  floorplan.querySelectorAll(".meeting-room").forEach(function (roomEl) {
    var room = String(roomEl.getAttribute("data-room") || "").toUpperCase();
    var occupied = occupiedRoomSet.has(room);
    roomEl.classList.toggle("meeting-unavailable", occupied);
    var hit = roomEl.querySelector(".meeting-hit");
    if (hit) hit.classList.toggle("meeting-hit--disabled", occupied);
    if (occupied) {
      var selected = roomEl.querySelector(".desk-set.meeting-selected");
      if (selected) selected.classList.remove("meeting-selected");
    }
  });
  updateNextFabVisibility();
}

let availabilityReloadTimer = null;
function scheduleAvailabilityRefresh() {
  if (availabilityReloadTimer) clearTimeout(availabilityReloadTimer);
  availabilityReloadTimer = setTimeout(function () {
    fetchSlotAvailability()
      .then(function () {
        applySlotAvailabilityToMap();
        renderAssetList();
      })
      .catch(function (e) {
        console.warn("[map availability]", e && e.message ? e.message : e);
      });
  }, 120);
}

const todayMidnight = new Date();
todayMidnight.setHours(0, 0, 0, 0);

const parseTimeStr = (s) => {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
};

const formatTimeStr = (totalMins) => {
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
};

function formatDateDDMMYYYY(dateLike) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear());
  return day + "/" + month + "/" + year;
}

const ensureEndAfterStart = () => {
  const sm = parseTimeStr(timeStartInput.value);
  if (sm === null) return;
  const maxM = 23 * 60 + 59;
  let em = parseTimeStr(timeEndInput.value);
  if (em === null) em = sm + 60;
  if (em <= sm) em = sm + 60;
  em = Math.min(em, maxM);
  if (em <= sm) em = Math.min(sm + 15, maxM);
  if (em <= sm) em = maxM;
  timeEndInput.value = formatTimeStr(em);
  scheduleAvailabilityRefresh();
};

const datePicker = flatpickr("#booking-date", {
  dateFormat: "Y-m-d",
  altInput: true,
  altFormat: "d/m/Y",
  allowInput: false,
  disableMobile: true,
  weekNumbers: false,
  defaultDate: todayMidnight,
  minDate: todayMidnight,
  onChange: function () {
    scheduleAvailabilityRefresh();
  },
});

(function applyDateFromQuery() {
  const raw = new URLSearchParams(window.location.search).get("date");
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return;
  const parts = raw.split("-").map(Number);
  const parsed = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
  if (Number.isNaN(parsed.getTime()) || parsed < todayMidnight) return;
  datePicker.setDate(parsed, false);
})();

(function applyTimeRangeFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const start = params.get("start");
  const end = params.get("end");
  if (start && /^\d{2}:\d{2}$/.test(start)) {
    timeStartInput.value = start;
  }
  if (end && /^\d{2}:\d{2}$/.test(end)) {
    timeEndInput.value = end;
  }
})();

timeStartInput.addEventListener("change", ensureEndAfterStart);
timeEndInput.addEventListener("change", () => {
  const sm = parseTimeStr(timeStartInput.value);
  const em = parseTimeStr(timeEndInput.value);
  if (sm !== null && em !== null && em <= sm) ensureEndAfterStart();
  scheduleAvailabilityRefresh();
});

ensureEndAfterStart();

window.getBookingSlot = () => ({
  date: datePicker.selectedDates[0]
    ? datePicker.formatDate(datePicker.selectedDates[0], "Y-m-d")
    : null,
  startTime: timeStartInput.value || null,
  endTime: timeEndInput.value || null,
});

nextFab.addEventListener("click", async () => {
  const deskEl = document.querySelector(".desk.user-selected");
  const meetingWrap = document.querySelector(".desk-set.meeting-selected")?.closest(".meeting-room");
  const payload = {
    ...window.getBookingSlot(),
    deskId: deskEl ? deskEl.dataset.desk_id || null : null,
    room: deskEl ? deskEl.dataset.room || null : meetingWrap ? meetingWrap.getAttribute("data-room") : null,
    selectedAssets: getSelectedAssetsPayload(),
  };
  const date = payload.date;
  const startTime = payload.startTime;
  const endTime = payload.endTime;
  if (!date || !startTime || !endTime || (!payload.deskId && !payload.room)) {
    showMapNotice("Pick date, start/end time, and a desk or room first.", true);
    return;
  }
  const bookingStart = new Date(date + "T" + startTime);
  const bookingFinish = new Date(date + "T" + endTime);
  if (Number.isNaN(bookingStart.getTime()) || Number.isNaN(bookingFinish.getTime())) {
    showMapNotice("Invalid booking date/time.", true);
    return;
  }
  if (bookingFinish <= bookingStart) {
    showMapNotice("Finish time must be after start time.", true);
    return;
  }
  const body = {
    bookingStart: bookingStart.toISOString(),
    bookingFinish: bookingFinish.toISOString(),
    status: "Confirmed",
    deskId: payload.deskId,
    room: payload.room,
    selectedAssets: payload.selectedAssets,
  };
  const ownOverlap = await hasOwnBookingOverlap(body.bookingStart, body.bookingFinish);
  if (ownOverlap) {
    showMapNotice("You have another booking in this date/time.", true);
    return;
  }
  pendingBookingBody = body;
  if (confirmDate) confirmDate.textContent = formatDateDDMMYYYY(date);
  if (confirmTime) confirmTime.textContent = startTime + " to " + endTime;
  if (confirmSpace) {
    if (payload.deskId && payload.room) confirmSpace.textContent = "Room " + payload.room + " · Seat " + payload.deskId;
    else if (payload.room) confirmSpace.textContent = "Room " + payload.room + " (whole room)";
    else confirmSpace.textContent = "Seat selected";
  }
  if (confirmAssets) {
    confirmAssets.textContent = payload.selectedAssets.length
      ? payload.selectedAssets.map(function (a) { return a.assetName; }).join(", ")
      : "None";
  }
  if (bookingConfirm) bookingConfirm.classList.add("is-open");
});

async function submitBookingPayload(body) {
  const urls = apiCandidates("/api/bookings");
  if (confirmSubmit) confirmSubmit.disabled = true;
  let lastErr = null;
  for (let i = 0; i < urls.length; i += 1) {
    try {
      const res = await fetch(urls[i], {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getSessionTokenHeader() },
        credentials: "include",
        body: JSON.stringify(body),
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
      if (bookingConfirm) bookingConfirm.classList.remove("is-open");
      if (bookingSuccess) bookingSuccess.classList.add("is-open");
      setTimeout(function () {
        if (window.location.protocol === "file:") {
          window.location.href = "../../index.html";
        } else {
          window.location.href = "/index.html";
        }
      }, 1600);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  if (confirmSubmit) confirmSubmit.disabled = false;
  showMapNotice((lastErr && lastErr.message) || "Could not create booking.", true);
}

const xmlns = "http://www.w3.org/2000/svg";
const xlinkns = "http://www.w3.org/1999/xlink";

const ZOOM_MIN = 1;
const ZOOM_MAX = 2.5;
let zoom = 1;
let translateX = 0;
let translateY = 0;
let startX = 0;
let startY = 0;

let suppressNextMapClick = false;
const MAP_PAN_MOVE_THRESHOLD_SQ = 36;
let mapPanPointerStart = null;
let mapPanDragging = false;
let mapTouchPanStart = null;
let mapTouchPanDragging = false;

const setTransform = () => {
  floorplan.setAttributeNS(null, "transform", "scale(" + zoom + ") translate(" + translateX + " " + translateY + ")");
};

floorplan.addEventListener(
  "wheel",
  (evt) => {
    evt.preventDefault();
    const factor = evt.deltaY > 0 ? 0.92 : 1.08;
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor));
    setTransform();
  },
  { passive: false }
);

const isOutsideMapPan = (el) =>
  el &&
  (el.closest(".asset-panel") ||
    el.closest(".top-bar") ||
    el.closest(".next-fab") ||
    el.closest(".selection-dock") ||
    el.closest(".flatpickr-calendar"));

floorplan.addEventListener("mousedown", (evt) => {
  if (evt.button !== 0) return;
  suppressNextMapClick = false;
  mapPanPointerStart = { x: evt.clientX, y: evt.clientY };
  mapPanDragging = false;
  floorplan.classList.add("active");
  startX = evt.clientX - translateX;
  startY = evt.clientY - translateY;
  document.addEventListener("mousemove", handlePanning);
});

document.addEventListener("mouseup", () => {
  if (mapPanDragging) suppressNextMapClick = true;
  mapPanPointerStart = null;
  mapPanDragging = false;
  floorplan.classList.remove("active");
  document.removeEventListener("mousemove", handlePanning);
});

const handlePanning = (evt) => {
  if (!floorplan.classList.contains("active")) return;
  if (!mapPanDragging) {
    if (!mapPanPointerStart) return;
    const dx = evt.clientX - mapPanPointerStart.x;
    const dy = evt.clientY - mapPanPointerStart.y;
    if (dx * dx + dy * dy < MAP_PAN_MOVE_THRESHOLD_SQ) return;
    mapPanDragging = true;
    startX = evt.clientX - translateX;
    startY = evt.clientY - translateY;
  }
  translateX = evt.clientX - startX;
  translateY = evt.clientY - startY;
  setTransform();
};

document.addEventListener(
  "touchstart",
  (evt) => {
    const t = evt.target;
    if (isOutsideMapPan(t)) return;
    if (evt.touches.length !== 1) return;
    suppressNextMapClick = false;
    const touchobj = evt.touches[0];
    mapTouchPanStart = { x: touchobj.clientX, y: touchobj.clientY };
    mapTouchPanDragging = false;
    floorplan.classList.add("touching");
    startX = touchobj.clientX - translateX;
    startY = touchobj.clientY - translateY;
    document.addEventListener("touchmove", handleTouchPanning, { passive: false });
  },
  { passive: true }
);

function endTouchPan() {
  if (mapTouchPanDragging) suppressNextMapClick = true;
  mapTouchPanStart = null;
  mapTouchPanDragging = false;
  document.removeEventListener("touchmove", handleTouchPanning);
  floorplan.classList.remove("touching");
}

document.addEventListener("touchend", endTouchPan);
document.addEventListener("touchcancel", endTouchPan);

const handleTouchPanning = (evt) => {
  if (evt.touches.length !== 1) return;
  const touchobj = evt.touches[0];
  if (!mapTouchPanDragging) {
    if (!mapTouchPanStart) return;
    const dx = touchobj.clientX - mapTouchPanStart.x;
    const dy = touchobj.clientY - mapTouchPanStart.y;
    if (dx * dx + dy * dy < MAP_PAN_MOVE_THRESHOLD_SQ) return;
    mapTouchPanDragging = true;
    startX = touchobj.clientX - translateX;
    startY = touchobj.clientY - translateY;
  }
  evt.preventDefault();
  translateX = touchobj.clientX - startX;
  translateY = touchobj.clientY - startY;
  setTransform();
};

let allDesks = [];

const CLUSTER_TEMPLATE = [
  { def: "desk_type3", deskId: null },
  { def: "desk_type3", deskId: null, transform: "translate(-8 -199) rotate(120)" },
  { def: "desk_type3", deskId: null, transform: "translate(169 -106) rotate(-120)" },
];

function buildCircularClusters(room, idPrefix, roomCenterX, roomCenterY, radius) {
  const sets = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 3;
    const circleX = roomCenterX + radius * Math.cos(angle);
    const circleY = roomCenterY + radius * Math.sin(angle);
    const startNum = i * 3 + 1;
    const desks = CLUSTER_TEMPLATE.map((d, j) => ({
      ...d,
      deskId: idPrefix + (startNum + j),
    }));
    sets.push({
      id: room + "-set-" + (i + 1),
      circleX,
      circleY,
      room,
      desks,
    });
  }
  return sets;
}

const ROOM_ORIGIN = { x: 30, y: 30 };
const ROOM_W = 500;
const ROOM_H = 500;
const CORRIDOR_H = 50;
const BOTTOM_ROW_Y = ROOM_ORIGIN.y + ROOM_H + CORRIDOR_H;
const BOTTOM_ROOM_H = ROOM_H;
const BOTTOM_ROOM_W = ROOM_W;

const ROOM_LETTERS_TOP = ["A", "B", "C", "D"];
const TOP_ROOM_RECTS = ROOM_LETTERS_TOP.map((letter, i) => ({
  letter,
  x: ROOM_ORIGIN.x + i * ROOM_W,
  y: ROOM_ORIGIN.y,
  w: ROOM_W,
  h: ROOM_H,
}));

const E_RECT = {
  letter: "E",
  x: ROOM_ORIGIN.x,
  y: BOTTOM_ROW_Y,
  w: BOTTOM_ROOM_W,
  h: BOTTOM_ROOM_H,
};

const roomCenter = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

const CLUSTER_RADIUS = 162;
const floorplanData = TOP_ROOM_RECTS.flatMap((r) => {
  const c = roomCenter(r);
  return buildCircularClusters(r.letter, r.letter, c.x, c.y, CLUSTER_RADIUS);
}).concat((() => {
  const c = roomCenter(E_RECT);
  return buildCircularClusters("E", "E", c.x, c.y, CLUSTER_RADIUS);
})());

const CLUSTER_SCALE = 0.58;

const UNAVAILABLE_DESK_IDS = new Set();
const UNAVAILABLE_MEETING_LETTERS = new Set();

const addDesk = (data) => {
  const useDesk = document.createElementNS(xmlns, "use");
  useDesk.setAttributeNS(xlinkns, "xlink:href", "#" + data.def);
  useDesk.classList.add("desk");
  if (data.className) useDesk.classList.add(data.className);
  if (data.deskId) useDesk.setAttribute("data-desk_id", data.deskId);
  if (data.room) useDesk.setAttribute("data-room", data.room);
  if (data.bookable === false) useDesk.setAttribute("data-bookable", "false");
  if (data.transform) useDesk.setAttribute("transform", data.transform);
  return useDesk;
};

const addDeskSet = (data) => {
  const deskSet = document.createElementNS(xmlns, "g");
  deskSet.classList.add("desk-set");
  if (data.id) deskSet.setAttribute("data-desk_set_id", data.id);

  data.desks.forEach((desk) => {
    const cell = document.createElementNS(xmlns, "g");
    cell.classList.add("desk-cell");
    if (desk.transform) cell.setAttribute("transform", desk.transform);

    const booked = desk.deskId && UNAVAILABLE_DESK_IDS.has(desk.deskId);
    const newDesk = addDesk({
      def: desk.def,
      deskId: desk.deskId,
      room: data.room,
      className: booked ? "unavailable" : desk.className,
      bookable: booked ? false : desk.bookable,
    });
    cell.appendChild(newDesk);

    const label = document.createElementNS(xmlns, "text");
    label.setAttribute("x", "52");
    label.setAttribute("y", "-42");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "middle");
    label.setAttribute("class", "seat-label");
    label.textContent = desk.deskId || "";
    cell.appendChild(label);

    deskSet.appendChild(cell);
    allDesks.push(newDesk);
  });

  floorplan.appendChild(deskSet);

  const bbox = deskSet.getBBox();
  const s = CLUSTER_SCALE;
  let tx;
  let ty;
  if (bbox.width > 0 && bbox.height > 0) {
    const cxLocal = bbox.x + bbox.width / 2;
    const cyLocal = bbox.y + bbox.height / 2;
    tx = data.circleX - s * cxLocal;
    ty = data.circleY - s * cyLocal;
  } else {
    tx = data.circleX;
    ty = data.circleY;
  }
  deskSet.setAttribute("transform", "translate(" + tx + " " + ty + ") scale(" + s + ")");
};

floorplanData.forEach((deskSet) => addDeskSet(deskSet));

const MEETING_LETTERS = ["F", "G", "H"];
const MEETING_RECTS = MEETING_LETTERS.map((letter, i) => ({
  letter,
  x: ROOM_ORIGIN.x + (i + 1) * BOTTOM_ROOM_W,
  y: BOTTOM_ROW_Y,
  w: BOTTOM_ROOM_W,
  h: BOTTOM_ROOM_H,
}));

const clearAll = () => {
  allDesks.forEach((desk) => desk.classList.remove("user-selected"));
  floorplan.querySelectorAll(".meeting-room .desk-set.meeting-selected").forEach((el) => {
    el.classList.remove("meeting-selected");
  });
  updateNextFabVisibility();
};

const handleMeetingRoomClick = (evt) => {
  if (suppressNextMapClick) {
    suppressNextMapClick = false;
    return;
  }
  const room = evt.currentTarget.closest(".meeting-room");
  if (room && room.classList.contains("meeting-unavailable")) return;
  evt.stopPropagation();
  clearAll();
  const furniture = evt.currentTarget.parentNode;
  furniture.classList.add("meeting-selected");
  updateNextFabVisibility();
};

function buildMeetingRoom(rect) {
  const letter = rect.letter;
  const roomUnavailable = UNAVAILABLE_MEETING_LETTERS.has(letter);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const g = document.createElementNS(xmlns, "g");
  g.setAttribute("class", roomUnavailable ? "meeting-room meeting-unavailable" : "meeting-room");
  g.setAttribute("data-room", letter);

  const furniture = document.createElementNS(xmlns, "g");
  furniture.classList.add("desk-set");

  const tableW = 290;
  const tableH = 158;
  const table = document.createElementNS(xmlns, "rect");
  table.setAttribute("x", cx - tableW / 2);
  table.setAttribute("y", cy - tableH / 2);
  table.setAttribute("width", tableW);
  table.setAttribute("height", tableH);
  table.setAttribute("rx", 8);
  table.setAttribute("class", "table");
  furniture.appendChild(table);

  const seatR = 22;
  const halfW = tableW / 2;
  const halfH = tableH / 2;
  const edgeGap = 8;
  const inset = 22;

  const linspace = (a, b, n) => {
    if (n <= 1) return [(a + b) / 2];
    const out = [];
    for (let i = 0; i < n; i += 1) out.push(a + ((b - a) * i) / (n - 1));
    return out;
  };

  const rowPack = 0.72;
  const rowLeft = cx + (cx - halfW + inset - cx) * rowPack;
  const rowRight = cx + (cx + halfW - inset - cx) * rowPack;
  const colXs = linspace(rowLeft, rowRight, 4);
  const topY = cy - halfH - edgeGap;
  const botY = cy + halfH + edgeGap;
  const leftX = cx - halfW - edgeGap;

  const seatSlots = [];
  let n = 1;
  colXs.forEach((x) => seatSlots.push({ x, y: topY, seatNo: n++ }));
  colXs.forEach((x) => seatSlots.push({ x, y: botY, seatNo: n++ }));
  seatSlots.push({ x: leftX, y: cy, seatNo: 10 });

  let minX = cx - halfW;
  let maxX = cx + halfW;
  let minY = cy - halfH;
  let maxY = cy + halfH;
  const grow = (x, y, r) => {
    minX = Math.min(minX, x - r);
    maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r);
    maxY = Math.max(maxY, y + r);
  };

  seatSlots.forEach(({ x: sx, y: sy, seatNo }) => {
    const idStr = String(seatNo);
    grow(sx, sy, seatR);
    const circle = document.createElementNS(xmlns, "circle");
    circle.setAttribute("cx", sx);
    circle.setAttribute("cy", sy);
    circle.setAttribute("r", seatR);
    circle.setAttribute("class", roomUnavailable ? "desk unavailable" : "desk");
    circle.setAttribute("data-desk_id", idStr);
    circle.setAttribute("data-room", letter);
    if (roomUnavailable) circle.setAttribute("data-bookable", "false");
    furniture.appendChild(circle);
  });

  const hitPad = 16;
  const hit = document.createElementNS(xmlns, "rect");
  hit.setAttribute("x", minX - hitPad);
  hit.setAttribute("y", minY - hitPad);
  hit.setAttribute("width", maxX - minX + 2 * hitPad);
  hit.setAttribute("height", maxY - minY + 2 * hitPad);
  hit.setAttribute("rx", 18);
  hit.setAttribute("class", roomUnavailable ? "meeting-hit meeting-hit--disabled" : "meeting-hit");
  if (!roomUnavailable) hit.addEventListener("click", handleMeetingRoomClick);
  furniture.appendChild(hit);

  g.appendChild(furniture);
  floorplan.appendChild(g);
}

MEETING_RECTS.forEach((r) => buildMeetingRoom(r));

const handleClick = (evt) => {
  if (suppressNextMapClick) {
    suppressNextMapClick = false;
    return;
  }
  if (evt.currentTarget.getAttribute("data-bookable") === "false") return;
  evt.stopPropagation();
  clearAll();
  evt.currentTarget.classList.add("user-selected");
  updateNextFabVisibility();
};

const setListeners = () => {
  allDesks.forEach((desk) => {
    if (desk.dataset.bookable !== "false") {
      desk.addEventListener("click", handleClick);
    }
  });
};

setListeners();
updateNextFabVisibility();
setTransform();
scheduleAvailabilityRefresh();
