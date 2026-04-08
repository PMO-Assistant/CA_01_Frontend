// -----------------------------------------------------------------------------
// Asset directory page
// What: Fetch /api/assets, group by type, status badges (available / booked / maintenance).
// Why:  Read-only inventory view; status keys drive CSS modifier classes for the list UI.
// -----------------------------------------------------------------------------
document.getElementById("btn-back").addEventListener("click", () => {
  if (window.history.length > 1) window.history.back();
  else window.location.href = "../../index.html";
});

const root = document.getElementById("assets-root");
const statusEl = document.getElementById("assets-status");
const slotInfoEl = document.createElement("p");
slotInfoEl.className = "assets-empty";
slotInfoEl.style.paddingTop = "6px";
slotInfoEl.style.paddingBottom = "12px";

function parseSlotFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const startRaw = params.get("start");
  const endRaw = params.get("end");
  if (!startRaw || !endRaw) return null;
  const start = new Date(startRaw);
  const end = new Date(endRaw);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
  return { start, end };
}

function formatSlotDateTime(d) {
  const dt = new Date(d);
  return (
    String(dt.getDate()).padStart(2, "0") +
    "/" +
    String(dt.getMonth() + 1).padStart(2, "0") +
    "/" +
    String(dt.getFullYear()) +
    " " +
    String(dt.getHours()).padStart(2, "0") +
    ":" +
    String(dt.getMinutes()).padStart(2, "0")
  );
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
        typeof statusRaw === "string" && statusRaw.trim() ? statusRaw.trim() : "Available";
      return {
        assetId: Number(row.assetId),
        assetName: row.assetName,
        assetType: row.assetType,
        status,
      };
    })
    .filter((row) => Number.isFinite(row.assetId));
}

function formatStatusTitle(raw) {
  const s = String(raw || "").trim();
  if (!s) return "Available";
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function effectiveStatusKey(a) {
  let raw = String(a.status || "").trim().toLowerCase();
  if (raw === "booked" || raw === "booking") raw = "unavailable";
  return raw || "available";
}

function getStatusLabel(a) {
  const raw = String(a.status || "").trim();
  const lower = raw.toLowerCase();
  if (lower === "booked" || lower === "booking") return "Unavailable";
  return formatStatusTitle(raw || "Available");
}

function getStatusBadgeKind(a) {
  const key = effectiveStatusKey(a);
  if (!key || key === "available") return "available";
  if (key === "broken" || key === "damaged" || key === "faulty") return "broken";
  if (key === "missing" || key === "lost") return "missing";
  if (
    key === "unavailable" ||
    key === "in use" ||
    key === "in-use" ||
    key === "out of service" ||
    key === "out-of-service"
  ) {
    return "unavailable";
  }
  if (key.includes("maintenance")) return "maintenance";
  return "neutral";
}

function isInactiveAssetRow(a) {
  return getStatusBadgeKind(a) !== "available";
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

async function fetchAssetsFromSqlApi() {
  const urls = [];
  if (typeof window.HOT_DESK_API === "string" && window.HOT_DESK_API.trim()) {
    urls.push(window.HOT_DESK_API.trim().replace(/\/$/, "") + "/api/assets");
  }
  if (window.location.protocol !== "file:") {
    urls.push("/api/assets");
  }
  urls.push("http://localhost:4000/api/assets");

  const tried = [];
  let lastErr = null;
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    if (tried.indexOf(url) !== -1) continue;
    tried.push(url);
    try {
      const res = await fetch(url, { credentials: "omit" });
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
        return rows;
      }
      if (rows.length === 0) {
        throw new Error("No valid Asset rows (need assetId, assetName, assetType)");
      }
      return rows;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Could not reach /api/assets");
}

async function fetchOccupiedAssetIdsForSlot(slot) {
  if (!slot) return new Set();
  const params = new URLSearchParams();
  params.set("start", slot.start.toISOString());
  params.set("end", slot.end.toISOString());
  const urls = [];
  if (typeof window.HOT_DESK_API === "string" && window.HOT_DESK_API.trim()) {
    urls.push(window.HOT_DESK_API.trim().replace(/\/$/, "") + "/api/bookings/availability?" + params.toString());
  }
  if (window.location.protocol !== "file:") {
    urls.push("/api/bookings/availability?" + params.toString());
  }
  urls.push("http://localhost:4000/api/bookings/availability?" + params.toString());

  const tried = [];
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    if (tried.indexOf(url) !== -1) continue;
    tried.push(url);
    try {
      const res = await fetch(url, { credentials: "omit" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const ids = new Set();
      const arr = data && Array.isArray(data.occupiedAssetIds) ? data.occupiedAssetIds : [];
      arr.forEach((id) => {
        const n = Number(id);
        if (Number.isFinite(n)) ids.add(n);
      });
      return ids;
    } catch (_) {}
  }
  return new Set();
}

function renderList(assets) {
  root.innerHTML = "";
  if (!assets.length) {
    root.innerHTML =
      '<p class="assets-empty">No assets in the list. If the API works but the database is empty, run <code>npx prisma db seed</code> in the Backend folder.</p>';
    return;
  }

  const byType = new Map();
  const sorted = [...assets].sort((a, b) => {
    const t = a.assetType.localeCompare(b.assetType);
    if (t !== 0) return t;
    return a.assetName.localeCompare(b.assetName);
  });
  sorted.forEach((a) => {
    if (!byType.has(a.assetType)) byType.set(a.assetType, []);
    byType.get(a.assetType).push(a);
  });

  byType.forEach((items, typeName) => {
    const section = document.createElement("section");
    section.className = "assets-group";
    const h2 = document.createElement("h2");
    h2.className = "assets-group__heading";
    const headingIcon = document.createElement("span");
    headingIcon.className = "assets-group__heading-icon";
    headingIcon.setAttribute("aria-hidden", "true");
    const headingIconI = document.createElement("i");
    headingIconI.setAttribute("data-lucide", iconNameForAssetType(typeName));
    headingIcon.appendChild(headingIconI);
    h2.appendChild(headingIcon);
    const headingText = document.createElement("span");
    headingText.textContent = typeName;
    h2.appendChild(headingText);
    section.appendChild(h2);
    const ul = document.createElement("ul");
    ul.className = "assets-group__list";
    items.forEach((a) => {
      const inactive = isInactiveAssetRow(a);
      const kind = getStatusBadgeKind(a);
      const li = document.createElement("li");
      li.className = "assets-group__row" + (inactive ? " assets-group__row--inactive" : "");
      const name = document.createElement("span");
      name.className = "assets-group__name";
      const nameIcon = document.createElement("span");
      nameIcon.className = "assets-group__name-icon";
      nameIcon.setAttribute("aria-hidden", "true");
      const nameIconI = document.createElement("i");
      nameIconI.setAttribute("data-lucide", iconNameForAssetType(a.assetType));
      nameIcon.appendChild(nameIconI);
      const nameText = document.createElement("span");
      nameText.textContent = a.assetName;
      name.appendChild(nameIcon);
      name.appendChild(nameText);
      const badge = document.createElement("span");
      badge.className = "assets-group__badge assets-group__badge--" + kind;
      badge.textContent = getStatusLabel(a);
      li.appendChild(name);
      li.appendChild(badge);
      ul.appendChild(li);
    });
    section.appendChild(ul);
    root.appendChild(section);
  });
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

(async function load() {
  statusEl.textContent = "Loading…";
  let rows = [];
  try {
    rows = await fetchAssetsFromSqlApi();
  } catch (e) {
    console.error("[list-of-assets] API:", e);
    statusEl.className = "assets-empty";
    statusEl.innerHTML =
      "Could not load assets from the server. Start the Backend API and open this page from the same origin, or set <code>window.HOT_DESK_API</code> to your API base URL.";
    return;
  }
  const slot = parseSlotFromQuery();
  if (slot) {
    const occupiedIds = await fetchOccupiedAssetIdsForSlot(slot);
    rows = rows.filter((a) => effectiveStatusKey(a) === "available" && !occupiedIds.has(a.assetId));
    slotInfoEl.textContent =
      "Available assets for " + formatSlotDateTime(slot.start) + " - " + formatSlotDateTime(slot.end);
    statusEl.insertAdjacentElement("afterend", slotInfoEl);
  }
  statusEl.remove();
  renderList(rows);
})();
