// -----------------------------------------------------------------------------
// Admin SPA (rooms, employees, tags, seats, assets)
// What: CRUD tables against /api/admin/*; modal edits; reload after mutations.
// Why:  Operational UI without raw SQL; matches backend admin routes.
// -----------------------------------------------------------------------------
(function () {
  const statusEl = document.getElementById("admin-status");
  const roomsBody = document.getElementById("rooms-table-body");
  const usersBody = document.getElementById("users-table-body");
  const tagsBody = document.getElementById("tags-table-body");
  const seatsBody = document.getElementById("seats-table-body");
  const assetsBody = document.getElementById("assets-table-body");
  const roomsEmpty = document.getElementById("rooms-empty");
  const usersEmpty = document.getElementById("users-empty");
  const tagsEmpty = document.getElementById("tags-empty");
  const seatsEmpty = document.getElementById("seats-empty");
  const assetsEmpty = document.getElementById("assets-empty");
  const seatRoomSelect = document.getElementById("seat-room");
  const tagEmployeeSelect = document.getElementById("tag-employee");

  let rooms = [];
  let users = [];
  let tags = [];
  let seats = [];
  let assets = [];

  const TAG_STATUS_OPTIONS = ["Available", "Active", "Inactive", "Lost", "Out of Date"];

  document.getElementById("btn-back").addEventListener("click", () => {
    if (window.history.length > 1) window.history.back();
    else window.location.href = "/index.html";
  });

  function setStatus(msg, isError) {
    statusEl.textContent = msg || "";
    statusEl.style.color = isError ? "#b91c1c" : "#374151";
  }

  function refreshPage() {
    window.location.reload();
  }

  function makeEl(tag, text) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function makeActionButton(lucideName, title, onClick, className) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = title;
    btn.setAttribute("aria-label", title);
    if (className) btn.className = className;
    const icon = document.createElement("i");
    icon.setAttribute("data-lucide", lucideName);
    icon.setAttribute("aria-hidden", "true");
    btn.appendChild(icon);
    btn.addEventListener("click", onClick);
    return btn;
  }

  function initAdminModal() {
    const root = document.getElementById("admin-modal");
    const titleEl = document.getElementById("admin-modal-title");
    const bodyEl = document.getElementById("admin-modal-body");
    const btnCancel = document.getElementById("admin-modal-cancel");
    const btnSave = document.getElementById("admin-modal-save");
    let saveHandler = null;

    function onDocKey(e) {
      if (e.key === "Escape") close();
    }

    function close() {
      root.hidden = true;
      bodyEl.innerHTML = "";
      saveHandler = null;
      document.removeEventListener("keydown", onDocKey);
    }

    function open(opts) {
      titleEl.textContent = opts.title || "Edit";
      bodyEl.innerHTML = "";
      if (typeof opts.render === "function") opts.render(bodyEl);
      saveHandler = opts.onSave || null;
      root.hidden = false;
      document.addEventListener("keydown", onDocKey);
    }

    btnCancel.addEventListener("click", close);
    root.querySelectorAll("[data-admin-modal-dismiss]").forEach((el) => {
      el.addEventListener("click", close);
    });
    btnSave.addEventListener("click", async () => {
      if (!saveHandler) return;
      try {
        await saveHandler();
        close();
      } catch (err) {
        setStatus(err.message, true);
      }
    });

    return { open, close };
  }

  const adminModal = initAdminModal();

  function modalLabeledRow(labelText, controlEl) {
    const row = makeEl("div");
    row.className = "admin-modal__field";
    const lab = makeEl("label");
    lab.textContent = labelText;
    row.appendChild(lab);
    row.appendChild(controlEl);
    return row;
  }

  function modalCheckboxRow(text, checked, id) {
    const row = makeEl("div");
    row.className = "admin-modal__check";
    const inp = makeEl("input");
    inp.type = "checkbox";
    inp.className = "admin-checkbox";
    inp.checked = !!checked;
    if (id) inp.id = id;
    row.appendChild(inp);
    row.appendChild(makeEl("span", text));
    return { row, input: inp };
  }

  function inputDateYmd(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  }

  function normalizeSpaces(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isReasonableLabel(value) {
    return /^[A-Za-z0-9][A-Za-z0-9 .,'()\-_/]{1,79}$/.test(value);
  }

  async function apiJson(method, path, body) {
    const urls = [];
    const apiBase =
      typeof window.HOT_DESK_API === "string" && window.HOT_DESK_API.trim()
        ? window.HOT_DESK_API.trim().replace(/\/$/, "")
        : "";
    let onlyApiOrigin = false;
    if (window.location.protocol !== "file:") {
      try {
        const page = new URL(window.location.href);
        const pageOrigin = page.origin;
        const onBackendPort = page.port === "4000";
        const onSameOriginAsConfiguredApi = apiBase && pageOrigin === apiBase;
        if (onBackendPort || onSameOriginAsConfiguredApi) {
          urls.push(pageOrigin + path);
          onlyApiOrigin = true;
        }
      } catch (_) {}
    }
    if (!onlyApiOrigin) {
      if (apiBase) urls.push(apiBase + path);
      if (window.location.protocol !== "file:") urls.push(path);
      urls.push("http://localhost:4000" + path);
    }

    const tried = [];
    let lastErr = null;
    for (let i = 0; i < urls.length; i += 1) {
      const url = urls[i];
      if (tried.indexOf(url) !== -1) continue;
      tried.push(url);
      try {
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (res.status === 204) return null;
        const data = await res.json();
        if (!res.ok) throw new Error(data && data.error ? data.error : "HTTP " + res.status);
        return data;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Request failed");
  }

  function renderRoomOptions() {
    seatRoomSelect.innerHTML = "";
    rooms.forEach((room) => {
      const opt = makeEl("option");
      opt.value = String(room.roomId);
      opt.textContent = "Room " + room.roomName + " (floor " + room.floor + ")";
      seatRoomSelect.appendChild(opt);
    });
  }

  function renderTagEmployeeOptions() {
    tagEmployeeSelect.innerHTML = "";
    const sortedUsers = [...users].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    sortedUsers.forEach((u) => {
      const opt = makeEl("option");
      opt.value = String(u.empId);
      opt.textContent = u.name + " (#" + u.empId + ")" + (u.isActive ? "" : " [inactive]");
      tagEmployeeSelect.appendChild(opt);
    });
  }

  async function toggleRoomActive(room, checked) {
    try {
      await apiJson("PATCH", "/api/admin/rooms/" + room.roomId, { isActive: checked });
      refreshPage();
    } catch (e) {
      setStatus(e.message, true);
    }
  }

  function renderRooms() {
    roomsBody.innerHTML = "";
    roomsEmpty.textContent = rooms.length ? "" : "No rooms yet.";
    rooms.forEach((r) => {
      const tr = makeEl("tr");
      tr.appendChild(makeEl("td", String(r.roomId)));
      tr.appendChild(makeEl("td", r.roomName));
      tr.appendChild(makeEl("td", String(r.floor)));
      tr.appendChild(makeEl("td", r.bookable ? "Yes" : "No"));

      const activeTd = makeEl("td");
      const activeCb = makeEl("input");
      activeCb.type = "checkbox";
      activeCb.className = "admin-checkbox";
      activeCb.checked = !!r.isActive;
      activeCb.addEventListener("change", () => toggleRoomActive(r, activeCb.checked));
      activeTd.appendChild(activeCb);
      tr.appendChild(activeTd);

      roomsBody.appendChild(tr);
    });
  }

  async function toggleUserActive(user, checked) {
    try {
      await apiJson("PATCH", "/api/admin/employees/" + user.empId, { isActive: checked });
      await reloadAll();
    } catch (e) {
      setStatus(e.message, true);
    }
  }

  async function toggleSeatActive(seat, checked) {
    try {
      await apiJson("PATCH", "/api/admin/seats/" + seat.deskId, { isActive: checked });
      await reloadAll();
    } catch (e) {
      setStatus(e.message, true);
    }
  }

  function renderUsers() {
    usersBody.innerHTML = "";
    usersEmpty.textContent = users.length ? "" : "No users yet.";
    users.forEach((u) => {
      const tr = makeEl("tr");
      tr.appendChild(makeEl("td", String(u.empId)));
      tr.appendChild(makeEl("td", u.name));

      const activeTd = makeEl("td");
      const activeCb = makeEl("input");
      activeCb.type = "checkbox";
      activeCb.className = "admin-checkbox";
      activeCb.checked = !!u.isActive;
      activeCb.addEventListener("change", () => toggleUserActive(u, activeCb.checked));
      activeTd.appendChild(activeCb);
      tr.appendChild(activeTd);

      const actionsTd = makeEl("td");
      const actions = makeEl("div");
      actions.className = "admin-actions";
      actions.appendChild(
        makeActionButton("square-pen", "Edit user", () => {
          adminModal.open({
            title: "Edit user #" + u.empId,
            render(body) {
              const nameInp = makeEl("input");
              nameInp.type = "text";
              nameInp.id = "admin-edit-user-name";
              nameInp.value = u.name;
              body.appendChild(modalLabeledRow("Name", nameInp));
              const { row: activeRow, input: activeInp } = modalCheckboxRow(
                "Active",
                u.isActive,
                "admin-edit-user-active"
              );
              body.appendChild(activeRow);
            },
            async onSave() {
              const nameInp = document.getElementById("admin-edit-user-name");
              const activeInp = document.getElementById("admin-edit-user-active");
              const name = normalizeSpaces(nameInp.value);
              if (name.length < 2 || name.length > 60) {
                throw new Error("Name must be 2–60 characters.");
              }
              if (!isReasonableLabel(name)) throw new Error("Name contains invalid characters.");
              await apiJson("PATCH", "/api/admin/employees/" + u.empId, {
                name,
                isActive: activeInp.checked,
              });
              setStatus("User updated.");
              await reloadAll();
            },
          });
        })
      );
      actions.appendChild(
        makeActionButton("trash-2", "Delete user", async () => {
          if (!confirm("Delete user " + u.name + "?")) return;
          try {
            await apiJson("DELETE", "/api/admin/employees/" + u.empId);
            refreshPage();
          } catch (e) {
            setStatus(e.message, true);
          }
        }, "danger")
      );
      actionsTd.appendChild(actions);
      tr.appendChild(actionsTd);
      usersBody.appendChild(tr);
    });
  }

  function renderSeats() {
    seatsBody.innerHTML = "";
    seatsEmpty.textContent = seats.length ? "" : "No seats yet.";
    seats.forEach((s) => {
      const tr = makeEl("tr");
      tr.appendChild(makeEl("td", String(s.deskId)));
      tr.appendChild(makeEl("td", s.room && s.room.roomName ? s.room.roomName : "-"));
      tr.appendChild(makeEl("td", String(s.room && Number.isFinite(s.room.floor) ? s.room.floor : "-")));

      const activeTd = makeEl("td");
      const activeCb = makeEl("input");
      activeCb.type = "checkbox";
      activeCb.className = "admin-checkbox";
      activeCb.checked = !!s.isActive;
      activeCb.addEventListener("change", () => toggleSeatActive(s, activeCb.checked));
      activeTd.appendChild(activeCb);
      tr.appendChild(activeTd);

      const actionsTd = makeEl("td");
      const actions = makeEl("div");
      actions.className = "admin-actions";
      actions.appendChild(
        makeActionButton("square-pen", "Edit seat", () => {
          adminModal.open({
            title: "Edit seat #" + s.deskId,
            render(body) {
              const sel = makeEl("select");
              sel.id = "admin-edit-seat-room";
              rooms.forEach((r) => {
                const o = makeEl("option");
                o.value = String(r.roomId);
                o.textContent = r.roomName + " (floor " + r.floor + ")";
                if (s.room && r.roomId === s.room.roomId) o.selected = true;
                sel.appendChild(o);
              });
              body.appendChild(modalLabeledRow("Room", sel));
              const { row: activeRow, input: activeInp } = modalCheckboxRow(
                "Active",
                s.isActive,
                "admin-edit-seat-active"
              );
              body.appendChild(activeRow);
            },
            async onSave() {
              const roomId = Number(document.getElementById("admin-edit-seat-room").value);
              const isActive = document.getElementById("admin-edit-seat-active").checked;
              if (!Number.isFinite(roomId)) throw new Error("Select a room.");
              await apiJson("PATCH", "/api/admin/seats/" + s.deskId, { roomId, isActive });
              setStatus("Seat updated.");
              await reloadAll();
            },
          });
        })
      );
      actions.appendChild(
        makeActionButton("trash-2", "Delete seat", async () => {
          if (!confirm("Delete seat #" + s.deskId + "?")) return;
          try {
            await apiJson("DELETE", "/api/admin/seats/" + s.deskId);
            refreshPage();
          } catch (e) {
            setStatus(e.message, true);
          }
        }, "danger")
      );
      actionsTd.appendChild(actions);
      tr.appendChild(actionsTd);
      seatsBody.appendChild(tr);
    });
  }

  function formatDateOnly(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "-";
    return (
      String(d.getDate()).padStart(2, "0") +
      "/" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "/" +
      String(d.getFullYear())
    );
  }

  function renderTags() {
    tagsBody.innerHTML = "";
    tagsEmpty.textContent = tags.length ? "" : "No tags yet.";
    tags.forEach((t) => {
      const tr = makeEl("tr");
      tr.appendChild(makeEl("td", String(t.tagId)));
      const employeeName = t.employee && t.employee.name ? t.employee.name : "Unknown";
      tr.appendChild(makeEl("td", employeeName + " (#" + String(t.empId) + ")"));
      tr.appendChild(makeEl("td", t.nfcUid || "—"));
      tr.appendChild(makeEl("td", formatDateOnly(t.startDate)));
      tr.appendChild(makeEl("td", formatDateOnly(t.expiryDate)));
      tr.appendChild(makeEl("td", t.status || "Available"));

      const actionsTd = makeEl("td");
      const actions = makeEl("div");
      actions.className = "admin-actions";
      actions.appendChild(
        makeActionButton("square-pen", "Edit tag", () => {
          adminModal.open({
            title: "Edit tag #" + t.tagId,
            render(body) {
              const sel = makeEl("select");
              sel.id = "admin-edit-tag-emp";
              const sortedUsers = [...users].sort((a, b) =>
                String(a.name).localeCompare(String(b.name))
              );
              sortedUsers.forEach((usr) => {
                const o = makeEl("option");
                o.value = String(usr.empId);
                o.textContent = usr.name + " (#" + usr.empId + ")" + (usr.isActive ? "" : " [inactive]");
                if (Number(usr.empId) === Number(t.empId)) o.selected = true;
                sel.appendChild(o);
              });
              body.appendChild(modalLabeledRow("Employee", sel));

              const startInp = makeEl("input");
              startInp.type = "date";
              startInp.id = "admin-edit-tag-start";
              startInp.value = inputDateYmd(t.startDate);
              body.appendChild(modalLabeledRow("Start date", startInp));

              const expInp = makeEl("input");
              expInp.type = "date";
              expInp.id = "admin-edit-tag-exp";
              expInp.value = inputDateYmd(t.expiryDate);
              body.appendChild(modalLabeledRow("Expiry date", expInp));

              const nfcInp = makeEl("input");
              nfcInp.type = "text";
              nfcInp.id = "admin-edit-tag-nfc";
              nfcInp.maxLength = 80;
              nfcInp.placeholder = "Optional — hex UID from reader";
              nfcInp.value = t.nfcUid || "";
              body.appendChild(modalLabeledRow("NFC UID", nfcInp));

              const stSel = makeEl("select");
              stSel.id = "admin-edit-tag-status";
              TAG_STATUS_OPTIONS.forEach((st) => {
                const o = makeEl("option");
                o.value = st;
                o.textContent = st;
                if ((t.status || "Available") === st) o.selected = true;
                stSel.appendChild(o);
              });
              body.appendChild(modalLabeledRow("Status", stSel));
            },
            async onSave() {
              const empId = Number(document.getElementById("admin-edit-tag-emp").value);
              const startDate = document.getElementById("admin-edit-tag-start").value;
              const expiryDate = document.getElementById("admin-edit-tag-exp").value;
              const nfcRaw = normalizeSpaces(document.getElementById("admin-edit-tag-nfc").value);
              const status = document.getElementById("admin-edit-tag-status").value;
              if (!Number.isFinite(empId) || empId < 1) throw new Error("Select a valid employee.");
              if (!startDate || !expiryDate) throw new Error("Start and expiry dates are required.");
              if (!TAG_STATUS_OPTIONS.includes(status)) throw new Error("Invalid status.");
              await apiJson("PATCH", "/api/admin/tags/" + t.tagId, {
                empId,
                startDate,
                expiryDate,
                status,
                nfcUid: nfcRaw === "" ? null : nfcRaw.toLowerCase(),
              });
              setStatus("Tag updated.");
              await reloadAll();
            },
          });
        })
      );
      actions.appendChild(
        makeActionButton("trash-2", "Delete tag", async () => {
          if (!confirm("Delete tag #" + t.tagId + "?")) return;
          try {
            await apiJson("DELETE", "/api/admin/tags/" + t.tagId);
            refreshPage();
          } catch (e) {
            setStatus(e.message, true);
          }
        }, "danger")
      );
      actionsTd.appendChild(actions);
      tr.appendChild(actionsTd);
      tagsBody.appendChild(tr);
    });
  }

  function renderAssets() {
    assetsBody.innerHTML = "";
    assetsEmpty.textContent = assets.length ? "" : "No assets yet.";
    assets.forEach((a) => {
      const tr = makeEl("tr");
      tr.appendChild(makeEl("td", String(a.assetId)));
      tr.appendChild(makeEl("td", a.assetName));
      tr.appendChild(makeEl("td", a.assetType));
      tr.appendChild(makeEl("td", a.status || "Available"));

      const actionsTd = makeEl("td");
      const actions = makeEl("div");
      actions.className = "admin-actions";
      actions.appendChild(
        makeActionButton("square-pen", "Edit asset", () => {
          adminModal.open({
            title: "Edit asset #" + a.assetId,
            render(body) {
              const nameInp = makeEl("input");
              nameInp.type = "text";
              nameInp.id = "admin-edit-asset-name";
              nameInp.value = a.assetName;
              body.appendChild(modalLabeledRow("Name", nameInp));
              const typeInp = makeEl("input");
              typeInp.type = "text";
              typeInp.id = "admin-edit-asset-type";
              typeInp.value = a.assetType;
              body.appendChild(modalLabeledRow("Type", typeInp));
              const stInp = makeEl("input");
              stInp.type = "text";
              stInp.id = "admin-edit-asset-status";
              stInp.value = a.status || "Available";
              body.appendChild(modalLabeledRow("Status", stInp));
            },
            async onSave() {
              const assetName = normalizeSpaces(document.getElementById("admin-edit-asset-name").value);
              const assetType = normalizeSpaces(document.getElementById("admin-edit-asset-type").value);
              const status = normalizeSpaces(document.getElementById("admin-edit-asset-status").value);
              if (!assetName || !assetType) throw new Error("Name and type are required.");
              if (!isReasonableLabel(assetName) || !isReasonableLabel(assetType)) {
                throw new Error("Name/type contain invalid characters.");
              }
              if (status && !isReasonableLabel(status)) {
                throw new Error("Status contains invalid characters.");
              }
              await apiJson("PATCH", "/api/admin/assets/" + a.assetId, {
                assetName,
                assetType,
                status: status || "Available",
              });
              setStatus("Asset updated.");
              await reloadAll();
            },
          });
        })
      );
      actions.appendChild(
        makeActionButton("trash-2", "Delete asset", async () => {
          if (!confirm("Delete asset " + a.assetName + "?")) return;
          try {
            await apiJson("DELETE", "/api/admin/assets/" + a.assetId);
            refreshPage();
          } catch (e) {
            setStatus(e.message, true);
          }
        }, "danger")
      );
      actionsTd.appendChild(actions);
      tr.appendChild(actionsTd);
      assetsBody.appendChild(tr);
    });
  }

  async function reloadAll() {
    setStatus("Loading admin data...");
    try {
      const result = await Promise.all([
        apiJson("GET", "/api/admin/rooms"),
        apiJson("GET", "/api/admin/employees"),
        apiJson("GET", "/api/admin/tags"),
        apiJson("GET", "/api/admin/seats"),
        apiJson("GET", "/api/admin/assets"),
      ]);
      rooms = result[0] || [];
      users = result[1] || [];
      tags = result[2] || [];
      seats = result[3] || [];
      assets = result[4] || [];
      renderRoomOptions();
      renderTagEmployeeOptions();
      renderRooms();
      renderUsers();
      renderTags();
      renderSeats();
      renderAssets();
      if (window.lucide && typeof window.lucide.createIcons === "function") {
        window.lucide.createIcons();
      }
      setStatus("Admin data loaded.");
    } catch (e) {
      setStatus("Failed to load admin data: " + e.message, true);
    }
  }

  document.getElementById("user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("user-name");
    const name = normalizeSpaces(nameInput.value);
    const isActive = document.getElementById("user-active").checked;
    if (name.length < 2 || name.length > 60) {
      return setStatus("User name must be 2-60 characters.", true);
    }
    if (!isReasonableLabel(name)) {
      return setStatus("User name contains invalid characters.", true);
    }
    try {
      await apiJson("POST", "/api/admin/employees", { name, isActive });
      e.target.reset();
      document.getElementById("user-active").checked = true;
      refreshPage();
    } catch (err) {
      setStatus(err.message, true);
    }
  });

  document.getElementById("seat-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const roomId = Number(document.getElementById("seat-room").value);
    const isActive = document.getElementById("seat-active").checked;
    try {
      await apiJson("POST", "/api/admin/seats", {
        roomId,
        isActive,
      });
      document.getElementById("seat-active").checked = true;
      refreshPage();
    } catch (err) {
      setStatus(err.message, true);
    }
  });

  document.getElementById("tag-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const empId = Number(tagEmployeeSelect.value);
    const startDate = document.getElementById("tag-start").value;
    const expiryDate = document.getElementById("tag-expiry").value;
    const status = document.getElementById("tag-status").value;
    const nfcRaw = normalizeSpaces(document.getElementById("tag-nfc").value);
    if (!Number.isFinite(empId) || empId < 1) return setStatus("Select a valid employee.", true);
    if (!startDate || !expiryDate) return setStatus("Start and expiry dates are required.", true);
    const allowedTagStatuses = new Set(TAG_STATUS_OPTIONS);
    if (!allowedTagStatuses.has(status)) return setStatus("Choose a valid status.", true);
    try {
      await apiJson("POST", "/api/admin/tags", {
        empId,
        startDate,
        expiryDate,
        status,
        ...(nfcRaw ? { nfcUid: nfcRaw.toLowerCase() } : {}),
      });
      e.target.reset();
      document.getElementById("tag-status").value = "Active";
      refreshPage();
    } catch (err) {
      setStatus(err.message, true);
    }
  });

  document.getElementById("asset-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const assetName = normalizeSpaces(document.getElementById("asset-name").value);
    const assetType = normalizeSpaces(document.getElementById("asset-type").value);
    const status = normalizeSpaces(document.getElementById("asset-status").value);
    if (!assetName || !assetType) return setStatus("Asset name and type are required.", true);
    if (!isReasonableLabel(assetName) || !isReasonableLabel(assetType)) {
      return setStatus("Asset name/type contain invalid characters.", true);
    }
    if (status && !isReasonableLabel(status)) {
      return setStatus("Asset status contains invalid characters.", true);
    }
    try {
      await apiJson("POST", "/api/admin/assets", {
        assetName,
        assetType,
        status: status || "Available",
      });
      e.target.reset();
      refreshPage();
    } catch (err) {
      setStatus(err.message, true);
    }
  });

  reloadAll();
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
})();
