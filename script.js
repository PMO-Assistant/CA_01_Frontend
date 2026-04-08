// -----------------------------------------------------------------------------
// Client auth UX & kiosk storage
// What: sessionStorage gate flag, localStorage for phone-scanner poll id/secret, idle timing.
// Why:  httpOnly cookie holds the real session; these only steer routing and pairing. NFC UIDs
//       are not stored here (XSS). See docs/SECURITY.md.
// -----------------------------------------------------------------------------
const CARD_LOGIN_KEY = "hotDeskCardLoggedIn";
/** Set before redirect to home so tryRestoreSessionFromCookie can retry once if the cookie is not readable yet. */
const HOT_DESK_FRESH_NFC_LOGIN = "hotDeskFreshNfcLogin";
const LS_KIOSK_PHONE_SCANNER = "hotDeskKioskPhoneScanner";

function loadKioskPhoneScannerCreds() {
  try {
    var raw = localStorage.getItem(LS_KIOSK_PHONE_SCANNER);
    if (!raw) return null;
    var j = JSON.parse(raw);
    if (j && j.id && j.pollSecret) {
      return { id: String(j.id), pollSecret: String(j.pollSecret) };
    }
  } catch (_) {}
  return null;
}

function saveKioskPhoneScannerCreds(phoneScanner) {
  if (!phoneScanner || !phoneScanner.id || !phoneScanner.pollSecret) return;
  try {
    localStorage.setItem(
      LS_KIOSK_PHONE_SCANNER,
      JSON.stringify({ id: phoneScanner.id, pollSecret: phoneScanner.pollSecret })
    );
  } catch (_) {}
}

/** No user activity: warn then sign out (temporary coursework setting — 30h). */
const SESSION_CLIENT_IDLE_LIMIT_MS = 30 * 60 * 60 * 1000;
const SESSION_CLIENT_WARN_COUNTDOWN_SEC = 10;
const SESSION_CLIENT_IDLE_WARN_MS =
  SESSION_CLIENT_IDLE_LIMIT_MS - SESSION_CLIENT_WARN_COUNTDOWN_SEC * 1000;

function redirectSignInToApp() {
  try {
    var p = new URLSearchParams(window.location.search);
    var r = p.get("return");
    if (r) {
      var u = new URL(r, window.location.origin);
      if (u.origin === window.location.origin) {
        window.location.replace(u.pathname + u.search + u.hash);
        return;
      }
    }
  } catch (_) {}
  try {
    window.location.replace(new URL("../../index.html", window.location.href).href);
  } catch (_) {
    window.location.replace("/index.html");
  }
}

function frontendAssetUrl(pathFromFrontendRoot) {
  var p = String(pathFromFrontendRoot || "").replace(/^\//, "");
  try {
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || "";
      if (src.indexOf("script.js") !== -1) {
        return new URL(p, new URL(".", src)).href;
      }
    }
  } catch (_) {}
  try {
    return new URL(p, window.location.href).href;
  } catch (_) {
    return p;
  }
}

/** First name is "Enos" (case-insensitive) — only then we show Enos Pinheiro.jpg. */
function isLoggedInUserEnos(name) {
  var t = String(name || "").trim();
  if (!t) return false;
  var first = t.split(/\s+/)[0];
  return first.toLowerCase() === "enos";
}

function updateWelcomeUserName(name) {
  const n = String(name || "").trim();
  if (!n) return;
  document.querySelectorAll(".username-bold").forEach(function (el) {
    el.textContent = n;
  });
  const profileH2 = document.querySelector(".profile-panel .profile-text h2");
  if (profileH2) profileH2.textContent = n;

  const profileImg = document.querySelector(".profile-panel .profile-image-wrap img");
  if (profileImg) {
    const enos = isLoggedInUserEnos(n);
    profileImg.src = frontendAssetUrl(
      enos ? "Components/Profile Pictures/Enos Pinheiro.jpg" : "Components/avatar-placeholder.svg"
    );
    profileImg.alt = enos ? n + " profile photo" : "";
  }
}

// -----------------------------------------------------------------------------
// HTTP helpers: API base URLs and JSON fetch
// What: Ordered candidate origins; credential-aware list prefers same origin on :4000.
// Why:  Session cookies must not be sent to the wrong host; Live Server uses hostname:4000.
// -----------------------------------------------------------------------------
/** Avoid https://your-tunnel.ngrok.app:4000 — public hostnames are not served on 4000 from the phone. */
function hotDeskTrySameHostPort4000(hostname) {
  if (!hostname) return false;
  const h = String(hostname).toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") return true;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(h)) return true;
  return false;
}

function hotDeskApiUrlCandidates(path) {
  const out = [];
  const seen = Object.create(null);
  function push(u) {
    if (!u || seen[u]) return;
    seen[u] = true;
    out.push(u);
  }

  var apiBase = "";
  if (typeof window.HOT_DESK_API === "string" && window.HOT_DESK_API.trim()) {
    apiBase = window.HOT_DESK_API.trim().replace(/\/$/, "");
  }

  if (typeof window !== "undefined" && window.location && window.location.protocol !== "file:") {
    try {
      const page = new URL(window.location.href);
      const pageOrigin = page.origin;
      const onBackendPort = page.port === "4000";
      const onDevSplitUi = page.port === "3000";
      const onSameOriginAsConfiguredApi = apiBase && pageOrigin === apiBase;
      const httpsTunnel =
        page.protocol === "https:" &&
        (/ngrok/i.test(page.hostname) || page.hostname.endsWith(".localhost"));
      if (
        onBackendPort ||
        onDevSplitUi ||
        onSameOriginAsConfiguredApi ||
        httpsTunnel
      ) {
        push(pageOrigin + path);
      }
    } catch (_) {}
  }

  if (apiBase) {
    push(apiBase + path);
  }

  if (typeof window !== "undefined" && window.location && window.location.protocol !== "file:") {
    try {
      const u = new URL(window.location.href);
      const host = u.hostname;
      if (host && hotDeskTrySameHostPort4000(host)) {
        const proto = u.protocol === "https:" ? "https" : "http";
        push(proto + "://" + host + ":4000" + path);
      }
    } catch (_) {}
  }
  push("http://localhost:4000" + path);
  return out;
}

function hotDeskApiUrlCandidatesWithCredentials(path) {
  var apiBase = "";
  if (typeof window.HOT_DESK_API === "string" && window.HOT_DESK_API.trim()) {
    apiBase = window.HOT_DESK_API.trim().replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && window.location && window.location.protocol !== "file:") {
    try {
      var page2 = new URL(window.location.href);
      var pageOrigin = page2.origin;
      var onBackendPort = page2.port === "4000";
      var onDevSplitUi = page2.port === "3000";
      var onSameOriginAsConfiguredApi = apiBase && pageOrigin === apiBase;
      var httpsTunnel =
        page2.protocol === "https:" &&
        (/ngrok/i.test(page2.hostname) || page2.hostname.endsWith(".localhost"));
      if (
        onBackendPort ||
        onDevSplitUi ||
        onSameOriginAsConfiguredApi ||
        httpsTunnel
      ) {
        return [pageOrigin + path];
      }
    } catch (_) {}
  }
  return hotDeskApiUrlCandidates(path);
}

function hotDeskApiJsonSimple(method, path, body) {
  const urls = hotDeskApiUrlCandidatesWithCredentials(path);
  let lastErr = null;
  let sawNetworkFailure = false;
  return (async function () {
    for (let i = 0; i < urls.length; i += 1) {
      try {
        const res = await fetch(urls[i], {
          method,
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data && data.error) || "HTTP " + res.status);
        return data;
      } catch (e) {
        lastErr = e;
        const msg = e && e.message ? String(e.message) : "";
        if (
          msg === "Failed to fetch" ||
          /NetworkError|load failed|CONNECTION_REFUSED|connection refused/i.test(msg)
        ) {
          sawNetworkFailure = true;
        }
      }
    }
    if (sawNetworkFailure) {
      throw new Error(
        "Could not reach the API on port 4000. Start the backend: cd Backend && npm run dev"
      );
    }
    throw lastErr || new Error("Request failed");
  })();
}

/** Shared secret with Backend appsettings HOT_DESK_NFC_BRIDGE_KEY for /api/nfc-open/* poll + push. */
function hotDeskNfcBridgeKey() {
  return typeof window.HOT_DESK_NFC_BRIDGE_KEY === "string" ? window.HOT_DESK_NFC_BRIDGE_KEY.trim() : "";
}

function shouldAutoDevBrowserSession() {
  if (window.HOT_DESK_AUTO_DEV_SESSION === false) return false;
  try {
    const h = (window.location.hostname || "").toLowerCase();
    if (h !== "localhost" && h !== "127.0.0.1" && h !== "[::1]") return false;
    return window.location.port === "4000";
  } catch (_) {
    return false;
  }
}

/**
 * @param {{ clearStaleGateFlag?: boolean }} [options]
 *        When true (dashboard load), remove CARD_LOGIN_KEY if session cannot be restored so we
 *        do not show a logged-in UI without a cookie (avoids 401 on /api/me/*).
 */
async function tryRestoreSessionFromCookie(options) {
  const clearStale = !!(options && options.clearStaleGateFlag);
  try {
    const urls = hotDeskApiUrlCandidatesWithCredentials("/api/auth/session");
    const gateEl = document.getElementById("card-login-gate");
    const allowDevBootstrap = !gateEl && shouldAutoDevBrowserSession();
    const body = allowDevBootstrap
      ? JSON.stringify({ devBootstrap: true })
      : JSON.stringify({});

    const fetchOpts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body,
    };
    let res = await fetch(urls[0], fetchOpts);
    if (res.status === 401 && sessionStorage.getItem(HOT_DESK_FRESH_NFC_LOGIN) === "1") {
      await new Promise(function (r) {
        setTimeout(r, 250);
      });
      res = await fetch(urls[0], fetchOpts);
    }
    try {
      sessionStorage.removeItem(HOT_DESK_FRESH_NFC_LOGIN);
    } catch (_) {}
    if (res.ok) {
      const me = await res.json().catch(function () {
        return null;
      });
      if (me && me.name) {
        sessionStorage.setItem(CARD_LOGIN_KEY, "1");
        updateWelcomeUserName(me.name);
      }
      return;
    }
    if (res.status === 401 && clearStale) {
      try {
        sessionStorage.removeItem(CARD_LOGIN_KEY);
      } catch (_) {}
    }
  } catch (_) {
    if (clearStale) {
      try {
        sessionStorage.removeItem(CARD_LOGIN_KEY);
      } catch (_e) {}
    }
  }
}

async function authLogoutAllUrls() {
  const urls = hotDeskApiUrlCandidatesWithCredentials("/api/auth/logout");
  if (!urls.length) return;
  await fetch(urls[0], { method: "POST", credentials: "include" });
}

// -----------------------------------------------------------------------------
// Phone pairing: QR must use a reachable origin (LAN / public), not localhost on the phone
// What: HOT_DESK_PUBLIC_ORIGIN, ?ngrok= / ?publicOrigin= on this page, localStorage, WebRTC LAN guess.
// Why:  Mobile devices cannot open the PC’s localhost; QR must use LAN URL or one tunnel (e.g. ngrok → :4000).
// -----------------------------------------------------------------------------
const HOT_DESK_PUBLIC_ORIGIN_KEY = "hotDeskPublicOrigin";

function isLoopbackHostname(hostname) {
  const h = String(hostname || "").toLowerCase();
  return !h || h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

function readConfiguredPublicOrigin() {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("publicOrigin") || params.get("ngrok") || params.get("tunnel");
    if (raw && String(raw).trim()) {
      let o = String(raw).trim().replace(/\/$/, "");
      if (!/^https?:\/\//i.test(o)) o = "https://" + o.replace(/^\/+/, "");
      void new URL(o);
      try {
        sessionStorage.setItem(HOT_DESK_PUBLIC_ORIGIN_KEY, o);
        if (params.get("rememberNgrok") === "1" || params.get("rememberTunnel") === "1") {
          localStorage.setItem(HOT_DESK_PUBLIC_ORIGIN_KEY, o);
        }
      } catch (_e) {}
      return o;
    }
  } catch (_e) {}

  if (typeof window.HOT_DESK_PUBLIC_ORIGIN === "string" && window.HOT_DESK_PUBLIC_ORIGIN.trim()) {
    return window.HOT_DESK_PUBLIC_ORIGIN.trim().replace(/\/$/, "");
  }
  try {
    const s = sessionStorage.getItem(HOT_DESK_PUBLIC_ORIGIN_KEY);
    if (s && s.trim()) return s.trim().replace(/\/$/, "");
    const ls = localStorage.getItem(HOT_DESK_PUBLIC_ORIGIN_KEY);
    if (ls && ls.trim()) return ls.trim().replace(/\/$/, "");
  } catch (_e) {}
  return "";
}

function tryGuessLanOriginViaWebRTC(pageHref) {
  return new Promise(function (resolve) {
    const Conn =
      window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
    if (!Conn) return resolve("");

    let ref;
    try {
      ref = new URL(pageHref);
    } catch (_) {
      return resolve("");
    }

    let settled = false;
    const pc = new Conn({ iceServers: [] });
    const finish = function (origin) {
      if (settled) return;
      settled = true;
      try {
        pc.close();
      } catch (_) {}
      resolve(origin || "");
    };

    const t = setTimeout(function () {
      finish("");
    }, 2600);

    pc.onicecandidate = function (e) {
      const candi = e && e.candidate && e.candidate.candidate;
      if (!candi) return;
      const m = /([0-9]{1,3}(\.[0-9]{1,3}){3})/.exec(candi);
      if (!m) return;
      const ip = m[1];
      if (!ip || ip.indexOf("127.") === 0) return;
      clearTimeout(t);
      var origin = ref.port
        ? ref.protocol + "//" + ip + ":" + ref.port
        : ref.protocol + "//" + ip;
      try {
        sessionStorage.setItem(HOT_DESK_PUBLIC_ORIGIN_KEY, origin);
      } catch (_) {}
      finish(origin);
    };

    try {
      pc.createDataChannel("");
    } catch (_) {
      clearTimeout(t);
      return finish("");
    }

    pc.createOffer()
      .then(function (offer) {
        return pc.setLocalDescription(offer);
      })
      .catch(function () {
        clearTimeout(t);
        finish("");
      });
  });
}

function resolvePairingFrontendOrigin() {
  const configured = readConfiguredPublicOrigin();
  if (configured) return Promise.resolve(configured);

  try {
    const ref = new URL(window.location.href);
    if (!isLoopbackHostname(ref.hostname)) {
      return Promise.resolve(ref.origin);
    }
    return tryGuessLanOriginViaWebRTC(window.location.href).then(function (guessed) {
      if (guessed) return guessed.replace(/\/$/, "");
      return ref.origin;
    });
  } catch (_) {
    return Promise.resolve(window.location.origin);
  }
}

// -----------------------------------------------------------------------------
// Sign-in gate (NFC + phone pairing)
// What: Web NFC; optional open bridge (static phone URL + HOT_DESK_NFC_BRIDGE_KEY); legacy QR pairing
//       + linked-phone poll; dashboard “pair another phone”; dev-login on localhost.
// Why:  One kiosk surface; phone can push tag reads through /api/nfc-open/* when configured.
// -----------------------------------------------------------------------------
function setupCardLoginGate(options) {
  options = options || {};
  const autoPair = options.autoPair === true;

  const gate = document.getElementById("card-login-gate");
  const scanBtn = document.getElementById("card-scan-btn");
  const statusEl = document.getElementById("card-login-nfc-status");
  const pairPhoneBtn = document.getElementById("card-pair-phone-btn");
  const pairPanel = document.getElementById("card-login-pair-panel");
  const pairUrlA = document.getElementById("card-login-pair-url");
  const pairQrEl = document.getElementById("card-login-pair-qr");
  const pairStatusEl = document.getElementById("card-login-pair-status");
  const pairCancelBtn = document.getElementById("card-pair-cancel-btn");

  function clearPairingQr() {
    if (pairQrEl) pairQrEl.innerHTML = "";
  }

  function renderPairingQr(href) {
    clearPairingQr();
    if (!pairQrEl || !href) return;
    if (typeof window.QRCode === "function") {
      try {
        new window.QRCode(pairQrEl, {
          text: href,
          width: 200,
          height: 200,
          colorDark: "#111827",
          colorLight: "#ffffff",
          correctLevel:
            window.QRCode.CorrectLevel && window.QRCode.CorrectLevel.M != null
              ? window.QRCode.CorrectLevel.M
              : 0,
        });
        return;
      } catch (_) {}
    }
    var img = document.createElement("img");
    img.alt = "QR code — open pairing page on your phone";
    img.width = 200;
    img.height = 200;
    img.loading = "eager";
    img.src =
      "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" + encodeURIComponent(href);
    pairQrEl.appendChild(img);
  }
  if (!gate || !scanBtn) return;

  const pairNewPhoneBtn = document.getElementById("card-pair-new-phone-btn");
  const pairInstrEl = gate.querySelector(".card-login-pair-instructions");
  const defaultPairInstructions = pairInstrEl ? pairInstrEl.textContent : "";

  const gateTitleEl = gate.querySelector(".card-login-title");
  const gateSubtitleEl = gate.querySelector(".card-login-subtitle");
  const defaultGateTitle = gateTitleEl ? gateTitleEl.textContent : "";
  const defaultGateSubtitle = gateSubtitleEl ? gateSubtitleEl.textContent : "";

  var pairPollTimer = null;
  var activePairingId = null;
  var persistentPollAbort = null;
  var openBridgePollAbort = null;
  var nfcGateScanAbort = null;

  function stopNfcGateScan() {
    if (!nfcGateScanAbort) return;
    try {
      nfcGateScanAbort.abort();
    } catch (_) {}
    nfcGateScanAbort = null;
  }

  function setGateCopyForDashboardPairing(on) {
    if (!gateTitleEl || !gateSubtitleEl) return;
    if (on) {
      gateTitleEl.textContent = "Phone NFC pairing";
      gateSubtitleEl.textContent =
        "Scan the QR code below with your Android phone on the same Wi‑Fi, then scan your badge on that page.";
    } else {
      gateTitleEl.textContent = defaultGateTitle;
      gateSubtitleEl.textContent = defaultGateSubtitle;
    }
  }

  function stopPairPolling() {
    if (pairPollTimer) {
      clearInterval(pairPollTimer);
      pairPollTimer = null;
    }
    activePairingId = null;
  }

  function stopPersistentPhoneScannerPoll() {
    if (persistentPollAbort) {
      try {
        persistentPollAbort.abort();
      } catch (_) {}
      persistentPollAbort = null;
    }
  }

  function stopOpenBridgePoll() {
    if (openBridgePollAbort) {
      try {
        openBridgePollAbort.abort();
      } catch (_) {}
      openBridgePollAbort = null;
    }
  }

  async function startOpenBridgePoll() {
    var key = hotDeskNfcBridgeKey();
    if (!key) return;
    stopOpenBridgePoll();
    var ac = new AbortController();
    openBridgePollAbort = ac;
    var bridgeWaitCycles = 0;
    var bridgeNetWarned = false;

    while (!ac.signal.aborted) {
      if (sessionStorage.getItem(CARD_LOGIN_KEY) === "1") {
        stopOpenBridgePoll();
        return;
      }
      var urls = hotDeskApiUrlCandidatesWithCredentials("/api/nfc-open/poll");
      var data = null;
      var res = null;
      for (var ui = 0; ui < urls.length; ui++) {
        try {
          res = await fetch(urls[ui], {
            method: "GET",
            credentials: "include",
            signal: ac.signal,
            headers: { "X-Hot-Desk-Nfc-Key": key },
          });
          data = await res.json().catch(function () {
            return {};
          });
          break;
        } catch (e) {
          if (e && e.name === "AbortError") return;
          res = null;
          data = null;
        }
      }
      if (ac.signal.aborted) return;
      if (res && res.status === 403) {
        setNfcStatus(
          "NFC bridge key rejected — set window.HOT_DESK_NFC_BRIDGE_KEY in hot-desk-config.js to match Backend HOT_DESK_NFC_BRIDGE_KEY.",
          true
        );
        return;
      }
      if (res && res.status === 404) {
        setNfcStatus(
          "Phone bridge is disabled. Use direct NFC on this device, or open the QR page on your phone and scan there.",
          true
        );
        return;
      }
      if (!res) {
        if (!bridgeNetWarned) {
          bridgeNetWarned = true;
          setNfcStatus("Cannot reach the API for NFC bridge — check npm run dev / backend on :4000.", true);
        }
        await new Promise(function (r) {
          setTimeout(r, 2000);
        });
        continue;
      }
      bridgeNetWarned = false;
      if (!res.ok) {
        await new Promise(function (r) {
          setTimeout(r, 1500);
        });
        continue;
      }
      if (data && data.nfcToken) {
        try {
          setNfcStatus("Card received — signing in…", false);
          var authBridge = await hotDeskApiJsonSimple("POST", "/api/auth/nfc", { nfcUid: data.nfcToken });
          applyPairingLoginAfterAuth(authBridge, {
            nfcToken: data.nfcToken,
            nfcPayload: data.nfcPayload,
          });
          return;
        } catch (errBridge) {
          var msgBr = (errBridge && errBridge.message) || "Card not registered or inactive.";
          setNfcStatus(msgBr, true);
          if (pairStatusEl) {
            pairStatusEl.textContent = "Waiting for another card from your phone…";
          }
        }
      } else {
        bridgeWaitCycles += 1;
        if (bridgeWaitCycles === 1 || bridgeWaitCycles % 3 === 0) {
          var hb =
            "NFC bridge active — waiting for a badge scan on the phone (page /pages/nfc-pair).";
          setNfcStatus(hb, false);
          if (pairStatusEl && pairPanel && !pairPanel.hidden) {
            pairStatusEl.textContent = hb;
          }
        }
      }
    }
  }

  async function startPersistentPhoneScannerPoll() {
    stopPersistentPhoneScannerPoll();
    var creds = loadKioskPhoneScannerCreds();
    if (!creds) return;
    var ac = new AbortController();
    persistentPollAbort = ac;

    while (!ac.signal.aborted) {
      creds = loadKioskPhoneScannerCreds();
      if (!creds) break;
      var pollPath =
        "/api/nfc-scanner/channels/" +
        encodeURIComponent(creds.id) +
        "/poll?secret=" +
        encodeURIComponent(creds.pollSecret);
      var urls = hotDeskApiUrlCandidatesWithCredentials(pollPath);
      var data = null;
      var res = null;
      for (var ui = 0; ui < urls.length; ui++) {
        try {
          res = await fetch(urls[ui], { credentials: "include", signal: ac.signal });
          data = await res.json().catch(function () {
            return {};
          });
          break;
        } catch (e) {
          if (e && e.name === "AbortError") return;
          res = null;
          data = null;
        }
      }
      if (ac.signal.aborted) return;
      if (!res) {
        await new Promise(function (r) {
          setTimeout(r, 2000);
        });
        continue;
      }
      if (res.status === 403) {
        try {
          localStorage.removeItem(LS_KIOSK_PHONE_SCANNER);
        } catch (_) {}
        if (pairStatusEl) pairStatusEl.textContent = "";
        setNfcStatus(
          "Phone link is no longer valid — tap “Use phone to scan card” to show a new QR code.",
          true
        );
        return;
      }
      if (res.status === 503) {
        try {
          localStorage.removeItem(LS_KIOSK_PHONE_SCANNER);
        } catch (_) {}
        setNfcStatus(
          (data && data.error) ||
            "The API database is not fully migrated. From Backend run: npx prisma migrate deploy",
          true
        );
        return;
      }
      if (!res.ok) {
        await new Promise(function (r) {
          setTimeout(r, 1500);
        });
        continue;
      }
      if (data && data.nfcToken) {
        try {
          var auth = await hotDeskApiJsonSimple("POST", "/api/auth/nfc", { nfcUid: data.nfcToken });
          applyPairingLoginAfterAuth(auth, {
            nfcToken: data.nfcToken,
            nfcPayload: data.nfcPayload,
          });
          return;
        } catch (err) {
          var msg = (err && err.message) || "Card not registered or inactive.";
          setNfcStatus(msg, true);
          if (pairStatusEl) {
            pairStatusEl.textContent = "Waiting for another card from your phone…";
          }
        }
      }
    }
  }

  function setNfcStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.classList.toggle("is-error", !!isError);
  }

  function lockScreen() {
    stopNfcGateScan();
    gate.classList.remove("card-login-gate--pairing-from-dashboard");
    setGateCopyForDashboardPairing(false);
    gate.hidden = false;
    gate.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-card-gated");
  }

  function unlockScreen() {
    stopNfcGateScan();
    stopPairPolling();
    stopPersistentPhoneScannerPoll();
    stopOpenBridgePoll();
    gate.classList.remove("card-login-gate--pairing-from-dashboard");
    setGateCopyForDashboardPairing(false);
    document.body.classList.remove("is-card-gated");
    redirectSignInToApp();
  }

  function reopenGateForPhonePairing() {
    if (!gate.hidden) return;
    gate.classList.add("card-login-gate--pairing-from-dashboard");
    setGateCopyForDashboardPairing(true);
    setNfcStatus("");
    gate.hidden = false;
    gate.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-card-gated");
  }

  function isDevLocalhost() {
    const h = location.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "";
  }

  function nfcReadableIdFromMessage(message) {
    if (!message || !message.records || !message.records.length) return "";
    try {
      const dec = new TextDecoder();
      for (let i = 0; i < message.records.length; i += 1) {
        const rec = message.records[i];
        if (rec.recordType === "text" && rec.data) {
          const buf = rec.data.buffer ? new Uint8Array(rec.data.buffer) : new Uint8Array(rec.data);
          if (buf.length < 2) continue;
          const langLen = buf[0] & 0x3f;
          const textBytes = buf.slice(1 + langLen);
          return dec.decode(textBytes).trim();
        }
        if (rec.recordType === "url" && rec.data) {
          const u = dec.decode(rec.data);
          if (u) return String(u).trim();
        }
      }
    } catch (_) {}
    return "";
  }

  function finalizeNfcGateSuccess(_token, _serial, _fromRecords, auth) {
    sessionStorage.setItem(CARD_LOGIN_KEY, "1");
    setNfcStatus("");
    if (pairPanel) pairPanel.hidden = true;
    if (auth && auth.name) updateWelcomeUserName(auth.name);
    try {
      sessionStorage.setItem(HOT_DESK_FRESH_NFC_LOGIN, "1");
    } catch (_) {}
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
    unlockScreen();
  }

  function applyPairingLoginAfterAuth(auth, _st) {
    sessionStorage.setItem(CARD_LOGIN_KEY, "1");
    setNfcStatus("");
    if (pairPanel) pairPanel.hidden = true;
    if (pairPhoneBtn) pairPhoneBtn.hidden = false;
    if (scanBtn) scanBtn.hidden = false;
    if (auth && auth.name) updateWelcomeUserName(auth.name);
    try {
      sessionStorage.setItem(HOT_DESK_FRESH_NFC_LOGIN, "1");
    } catch (_) {}
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
    unlockScreen();
  }

  function pollPairingOnce(pairingId) {
    hotDeskApiJsonSimple("GET", "/api/nfc-pairing/sessions/" + encodeURIComponent(pairingId))
      .then(function (st) {
        if (!activePairingId || activePairingId !== pairingId) return;
        if (st.status === "completed") {
          stopPairPolling();
          if (pairStatusEl) pairStatusEl.textContent = "";
          const readBanner = document.getElementById("card-login-phone-read-banner");
          const readBody = document.getElementById("card-login-phone-read-body");
          const clipNote = document.getElementById("card-login-phone-read-clip");
          if (readBanner) readBanner.hidden = true;
          if (readBody) readBody.textContent = "";
          if (clipNote) clipNote.hidden = true;
          if (st.phoneScanner && st.phoneScanner.id && st.phoneScanner.pollSecret) {
            saveKioskPhoneScannerCreds(st.phoneScanner);
          }
          hotDeskApiJsonSimple("POST", "/api/auth/nfc", { nfcUid: st.nfcToken })
            .then(function (auth) {
              applyPairingLoginAfterAuth(auth, st);
            })
            .catch(function (err) {
              const msg = (err && err.message) || "Card not registered or inactive.";
              if (readBanner && readBody) {
                readBody.textContent = msg;
                readBanner.hidden = false;
                window.setTimeout(function () {
                  readBanner.hidden = true;
                  setNfcStatus(msg, true);
                }, 5000);
              } else {
                setNfcStatus(msg, true);
              }
            });
        } else if (st.status === "expired") {
          stopPairPolling();
          if (pairStatusEl) pairStatusEl.textContent = "This code expired. Start pairing again.";
        }
      })
      .catch(function () {});
  }

  const alreadyLoggedIn = sessionStorage.getItem(CARD_LOGIN_KEY) === "1";
  if (alreadyLoggedIn && !autoPair) {
    redirectSignInToApp();
    return;
  }
  if (alreadyLoggedIn && autoPair) {
    gate.hidden = false;
    gate.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-card-gated");
    gate.classList.add("card-login-gate--pairing-from-dashboard");
    setGateCopyForDashboardPairing(true);
    setNfcStatus("");
  } else {
    lockScreen();
  }

  if (!alreadyLoggedIn && typeof URLSearchParams === "function") {
    const dev = new URLSearchParams(location.search).get("devLogin");
    if (dev === "1" && isDevLocalhost()) {
      setNfcStatus("Dev login…");
      hotDeskApiJsonSimple("POST", "/api/auth/dev-login", {})
        .then(function (j) {
          sessionStorage.setItem(CARD_LOGIN_KEY, "1");
          updateWelcomeUserName((j && j.name) || "Enos Pinheiro");
          setNfcStatus("");
          try {
            sessionStorage.setItem(HOT_DESK_FRESH_NFC_LOGIN, "1");
          } catch (_) {}
          unlockScreen();
        })
        .catch(function (err) {
          setNfcStatus(
            (err && err.message) || "Dev login failed (allowed when NODE_ENV is not production).",
            true
          );
        });
      return;
    }
  }

  const hasNfc = typeof window !== "undefined" && "NDEFReader" in window;
  const secure = typeof window !== "undefined" && window.isSecureContext;

  if (!alreadyLoggedIn && (!hasNfc || !secure)) {
    var hint =
      "This device cannot scan NFC here. Use “Use phone to scan card” (backend must be running), or open this page over HTTPS on an Android phone. Plain http://192.168… only works for pairing if this browser can reach the API; scanning still needs HTTPS on the phone.";
    if (!hasNfc && secure) {
      hint =
        "Web NFC is not available in this browser. Use “Use phone to scan card” with your Android phone, or open this site in Chrome on Android (HTTPS).";
    }
    if (!secure) {
      hint =
        "Use “Use phone to scan card” below while the backend runs on your PC, or serve this page over HTTPS for on-device NFC.";
    }
    setNfcStatus(hint, false);
  }

  if (pairCancelBtn && pairPanel) {
    pairCancelBtn.addEventListener("click", function () {
      stopPairPolling();
      if (hotDeskNfcBridgeKey()) {
        stopPersistentPhoneScannerPoll();
      } else if (!loadKioskPhoneScannerCreds()) {
        stopPersistentPhoneScannerPoll();
      } else {
        startPersistentPhoneScannerPoll();
      }
      pairPanel.hidden = true;
      clearPairingQr();
      if (pairNewPhoneBtn) pairNewPhoneBtn.hidden = true;
      if (pairInstrEl) pairInstrEl.textContent = defaultPairInstructions;
      if (pairStatusEl) pairStatusEl.textContent = "";
      if (sessionStorage.getItem(CARD_LOGIN_KEY) === "1") {
        unlockScreen();
      }
    });
  }

  if (pairNewPhoneBtn) {
    pairNewPhoneBtn.addEventListener("click", function () {
      beginPhonePairingFlow({ forceNewQr: true });
    });
  }

  function beginPhonePairingFlow(flowOpts) {
    flowOpts = flowOpts || {};
    var forceNewQr = flowOpts.forceNewQr === true;

    stopNfcGateScan();

    if (forceNewQr) {
      try {
        localStorage.removeItem(LS_KIOSK_PHONE_SCANNER);
      } catch (_) {}
    }

    if (!hotDeskNfcBridgeKey() && !forceNewQr) {
      var existingCreds = loadKioskPhoneScannerCreds();
      if (existingCreds) {
        stopPairPolling();
        stopPersistentPhoneScannerPoll();
        setNfcStatus("");
        var readBannerEx = document.getElementById("card-login-phone-read-banner");
        if (readBannerEx) readBannerEx.hidden = true;
        var clipNoteEx = document.getElementById("card-login-phone-read-clip");
        if (clipNoteEx) clipNoteEx.hidden = true;
        pairPanel.hidden = false;
        clearPairingQr();
        if (pairUrlA) {
          pairUrlA.textContent = "";
          pairUrlA.removeAttribute("href");
        }
        if (pairInstrEl) {
          pairInstrEl.textContent =
            "Your phone is already linked. Open the scanner page on that phone (use the same link as the first QR — bookmark it), keep it open, tap Scan, and hold a badge. Use the button below only to connect a different phone.";
        }
        if (pairNewPhoneBtn) pairNewPhoneBtn.hidden = false;
        if (pairStatusEl) {
          pairStatusEl.textContent = "Waiting for a card from your linked phone — no QR needed.";
        }
        startPersistentPhoneScannerPoll();
        return;
      }
    }

    stopPersistentPhoneScannerPoll();
    if (pairNewPhoneBtn) pairNewPhoneBtn.hidden = true;
    if (pairInstrEl) pairInstrEl.textContent = defaultPairInstructions;

    if (window.location.protocol === "file:") {
      setNfcStatus("Open this app from Live Server (http://…) so the pairing link and API work.", true);
      return;
    }

    setNfcStatus("");
    if (pairStatusEl) pairStatusEl.textContent = "Resolving address for your phone…";
    var readBannerReset = document.getElementById("card-login-phone-read-banner");
    if (readBannerReset) readBannerReset.hidden = true;
    var clipNoteReset = document.getElementById("card-login-phone-read-clip");
    if (clipNoteReset) clipNoteReset.hidden = true;
    pairPanel.hidden = false;
    clearPairingQr();

    if (hotDeskNfcBridgeKey()) {
      stopPairPolling();
      activePairingId = null;
      resolvePairingFrontendOrigin()
        .then(function (originForPhone) {
          var originForPhoneNorm = (originForPhone || window.location.origin).replace(/\/$/, "");
          var pairPageStatic = new URL("pages/nfc-pair/index.html", originForPhoneNorm + "/");
          pairUrlA.href = pairPageStatic.href;
          pairUrlA.textContent = pairPageStatic.href;
          renderPairingQr(pairPageStatic.href);
          if (pairStatusEl) {
            if (isLoopbackHostname(pairPageStatic.hostname)) {
              pairStatusEl.textContent =
                "This link is still localhost — your phone cannot open it. Use ngrok or HOT_DESK_PUBLIC_ORIGIN.";
            } else {
              pairStatusEl.textContent =
                "On your phone open this link and leave it open (NFC sends logins here — same URL every time).";
            }
          }
          if (window.lucide && typeof window.lucide.createIcons === "function") {
            window.lucide.createIcons();
          }
        })
        .catch(function (err) {
          if (pairStatusEl) {
            pairStatusEl.textContent =
              (err && err.message) || "Could not resolve a public URL for the QR code.";
          }
        });
      return;
    }

    resolvePairingFrontendOrigin()
      .then(function (originForPhone) {
        hotDeskApiJsonSimple("POST", "/api/nfc-pairing/sessions", {})
          .then(function (session) {
            stopPairPolling();
            activePairingId = session && session.id ? String(session.id) : "";
            if (!activePairingId) throw new Error("Could not create pairing session.");
            const originForPhoneNorm = (originForPhone || window.location.origin).replace(/\/$/, "");
            const pairPageStatic = new URL("pages/nfc-pair/index.html", originForPhoneNorm + "/");
            pairPageStatic.searchParams.set("pairing", activePairingId);
            pairUrlA.href = pairPageStatic.href;
            pairUrlA.textContent = pairPageStatic.href;
            renderPairingQr(pairPageStatic.href);
            if (pairStatusEl) {
              if (isLoopbackHostname(pairPageStatic.hostname)) {
                pairStatusEl.textContent =
                  "This link is still localhost — your phone cannot open it. Use ngrok or HOT_DESK_PUBLIC_ORIGIN.";
              } else {
                pairStatusEl.textContent =
                  "Open this on your phone, tap Scan, and hold the badge to log in on this desktop.";
              }
            }
            pollPairingOnce(activePairingId);
            pairPollTimer = setInterval(function () {
              if (!activePairingId) return;
              pollPairingOnce(activePairingId);
            }, 1500);
            if (window.lucide && typeof window.lucide.createIcons === "function") {
              window.lucide.createIcons();
            }
          })
          .catch(function (errCreate) {
            stopPairPolling();
            if (pairStatusEl) {
              pairStatusEl.textContent =
                (errCreate && errCreate.message) || "Could not create a pairing session.";
            }
          });
      })
      .catch(function (err) {
        stopPairPolling();
        if (pairStatusEl) {
          pairStatusEl.textContent =
            (err && err.message) || "Could not resolve a public URL for the QR code.";
        }
      });
  }

  if (pairPhoneBtn && pairPanel && pairUrlA) {
    pairPhoneBtn.addEventListener("click", function () {
      reopenGateForPhonePairing();
      beginPhonePairingFlow();
    });
  }

  scanBtn.addEventListener("click", function () {
    if (sessionStorage.getItem(CARD_LOGIN_KEY) === "1") {
      unlockScreen();
      return;
    }

    setNfcStatus("");

    if (!hasNfc || !secure) {
      setNfcStatus(
        !secure
          ? "Open this app over HTTPS (or localhost) so this device can use NFC — or use “Use phone to scan card”."
          : "Web NFC is not available in this browser — use “Use phone to scan card”.",
        true
      );
      return;
    }

    stopNfcGateScan();
    var ac = new AbortController();
    nfcGateScanAbort = ac;

    setNfcStatus("Ready — hold your card to the device now…");

    var ndef = new window.NDEFReader();
    ndef.addEventListener(
      "reading",
      function (ev) {
        nfcGateScanAbort = null;
        var serial = ev.serialNumber || "";
        var fromRecords = nfcReadableIdFromMessage(ev.message);
        var token = String(fromRecords || serial || "").trim();
        if (!token) token = "nfc-" + String(Date.now());
        setNfcStatus("Verifying card…");
        hotDeskApiJsonSimple("POST", "/api/auth/nfc", { nfcUid: token })
          .then(function (auth) {
            finalizeNfcGateSuccess(token, serial, fromRecords, auth);
          })
          .catch(function (err) {
            setNfcStatus((err && err.message) || "Card not registered or inactive.", true);
          });
      },
      { once: true }
    );

    ndef.addEventListener(
      "readingerror",
      function () {
        nfcGateScanAbort = null;
        setNfcStatus("Could not read the tag — try again.", true);
      },
      { once: true }
    );

    var scanPromise;
    try {
      scanPromise = ndef.scan({ signal: ac.signal });
    } catch (_) {
      scanPromise = ndef.scan();
    }
    Promise.resolve(scanPromise)
      .then(function () {})
      .catch(function (err) {
        if (err && err.name === "AbortError") return;
        nfcGateScanAbort = null;
        var msg = (err && err.message) || "";
        if (/invalidstate|already been started|busy/i.test(msg)) {
          setNfcStatus("NFC was still busy — tap the card again to start a fresh scan.", true);
          return;
        }
        setNfcStatus(msg || "NFC could not start. Allow NFC permission if prompted.", true);
      });
  });

  if (autoPair) {
    window.setTimeout(function () {
      beginPhonePairingFlow();
    }, 0);
  }
  window.setTimeout(function () {
    if (hotDeskNfcBridgeKey()) return;
    if (!loadKioskPhoneScannerCreds()) return;
    setNfcStatus(
      "Linked phone — on your phone open the scanner page and tap Scan. You do not need “Use phone to scan card” each time.",
      false
    );
    startPersistentPhoneScannerPoll();
  }, 0);

  if (!alreadyLoggedIn && hotDeskNfcBridgeKey()) {
    window.setTimeout(function () {
      setNfcStatus(
        "Phone NFC bridge: tap “Use phone to scan card” for the QR, or leave this page open — scans from the phone page complete login here.",
        false
      );
      startOpenBridgePoll();
    }, 0);
  }

  return function hotDeskRestartLinkedPhonePoll() {
    stopNfcGateScan();
    if (sessionStorage.getItem(CARD_LOGIN_KEY) === "1") return;
    if (hotDeskNfcBridgeKey()) {
      setNfcStatus(
        "Phone NFC bridge — open /pages/nfc-pair on your phone and leave it running.",
        false
      );
      startOpenBridgePoll();
      return;
    }
    if (!loadKioskPhoneScannerCreds()) return;
    setNfcStatus(
      "Linked phone — on your phone open the scanner page and tap Scan.",
      false
    );
    startPersistentPhoneScannerPoll();
  };
}

// -----------------------------------------------------------------------------
// Dashboard (homepage only): widgets and lifecycle
// What: New-booking map link (?date), news carousel (touch + keyboard + autoplay), weekly progress,
//       overview mini-calendar, Dublin weather (Open-Meteo), idle warning + /api/auth/activity,
//       today-total desk clock, finish-session logout.
// Why:  Runs when #card-login-gate is absent; keeps sign-in versus app concerns separate.
// -----------------------------------------------------------------------------
function setupNewBookingMapLink() {
  const link = document.getElementById("overview-new-booking-link");
  if (!link) return;
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const dateStr = y + "-" + m + "-" + day;
  try {
    const target = new URL("pages/map/index.html", window.location.href);
    target.searchParams.set("date", dateStr);
    link.href = target.href;
  } catch (_) {
    link.href = "./pages/map/index.html?date=" + dateStr;
  }
}

/** Timer only while clocked in — display is always "total worked today" (local calendar). */
let sessionTimerId = null;
/** Latest rows from GET /api/me/clock-punch (desk clock in/out). */
let lastClockPunchRows = [];
/** Matches GET /api/me/clock/state working (open DeskClockIn, no clock out). */
let clockStateWorking = false;
/** From GET /api/me/clock/state — sent with clock-in so the API can bind the desk booking even if time-window matching is tight. */
let clockSuggestedBookingId = null;
let overviewCenterDate = null;
let overviewRefs = null;
let isOverviewAnimating = false;
/** @type {any[]|null} Loaded from /api/bookings; null before first fetch completes */
let overviewBookingsCache = null;

async function refreshOverviewBookings() {
  try {
    const me = await hotDeskApiJsonSimple("GET", "/api/auth/me");
    const empId = me && Number(me.empId);
    if (!Number.isFinite(empId) || empId < 1) {
      overviewBookingsCache = [];
      return;
    }
    const data = await hotDeskApiJsonSimple(
      "GET",
      "/api/bookings?empId=" + encodeURIComponent(String(empId))
    );
    overviewBookingsCache = Array.isArray(data) ? data : [];
  } catch (_) {
    overviewBookingsCache = [];
  }
}

function overviewIsBookingActive(booking) {
  const s = String((booking && booking.status) || "")
    .trim()
    .toLowerCase();
  return s !== "cancelled" && s !== "canceled";
}

function overviewGetSpaceSummary(booking) {
  const rows = booking && Array.isArray(booking.bookingDesks) ? booking.bookingDesks : [];
  const WHOLE_ROOM_ONLY = new Set(["F", "G", "H"]);
  if (!rows.length) {
    return { kind: "desk", text: "Seat" };
  }
  if (rows.length > 1) {
    const roomName =
      rows[0] && rows[0].desk && rows[0].desk.room && rows[0].desk.room.roomName
        ? String(rows[0].desk.room.roomName)
        : "";
    return { kind: "room", text: roomName ? "Room " + roomName : "Whole room" };
  }
  const first = rows[0] && rows[0].desk ? rows[0].desk : null;
  const roomName = first && first.room && first.room.roomName ? String(first.room.roomName) : "";
  const roomKey = roomName.trim().toUpperCase();
  if (roomKey && WHOLE_ROOM_ONLY.has(roomKey)) {
    return { kind: "room", text: "Room " + roomName };
  }
  const deskId = first && Number.isFinite(first.deskId) ? Number(first.deskId) : null;
  if (deskId != null) {
    return {
      kind: "desk",
      text: roomName ? "Room " + roomName + " - Seat " + String(deskId) : "Seat " + String(deskId),
    };
  }
  return { kind: "room", text: roomName ? "Room " + roomName : "Whole room" };
}

function overviewFormatBookingTimeRange(booking) {
  const a = new Date(booking.bookingStart);
  const b = new Date(booking.bookingFinish);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "";
  const sh = String(a.getHours()).padStart(2, "0");
  const sm = String(a.getMinutes()).padStart(2, "0");
  const eh = String(b.getHours()).padStart(2, "0");
  const em = String(b.getMinutes()).padStart(2, "0");
  return sh + ":" + sm + " – " + eh + ":" + em;
}

function bookingsOverlappingCalendarDay(date) {
  if (!Array.isArray(overviewBookingsCache) || !overviewBookingsCache.length) return [];
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayEnd.getTime();
  return overviewBookingsCache
    .filter(overviewIsBookingActive)
    .filter(function (b) {
      const start = new Date(b.bookingStart);
      const end = new Date(b.bookingFinish);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
      return start.getTime() < dayEndMs && end.getTime() > dayStartMs;
    })
    .sort(function (a, b) {
      return new Date(a.bookingStart).getTime() - new Date(b.bookingStart).getTime();
    });
}

function setupNewsCarousel() {
  const root = document.querySelector("[data-news-carousel]");
  if (!root) return;

  const track = root.querySelector("[data-news-track]");
  const slides = root.querySelectorAll(".news-slide");
  const dotsWrap = root.querySelector("[data-news-dots]");
  const viewport = root.querySelector(".news-carousel-viewport");
  if (!track || slides.length === 0 || !dotsWrap) return;

  const n = slides.length;
  track.style.setProperty("--news-slides", String(n));

  dotsWrap.innerHTML = "";
  const dots = [];
  for (let i = 0; i < n; i++) {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "news-carousel-dot" + (i === 0 ? " is-active" : "");
    dot.setAttribute("role", "tab");
    dot.setAttribute("aria-label", "Story " + (i + 1) + " of " + n);
    dot.setAttribute("aria-selected", i === 0 ? "true" : "false");
    (function (idx) {
      dot.addEventListener("click", function () {
        go(idx);
        resetAutoplay();
      });
    })(i);
    dotsWrap.appendChild(dot);
    dots.push(dot);
  }

  let index = 0;
  let autoplayId = null;
  const autoplayMs = 7000;
  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function go(i) {
    index = ((i % n) + n) % n;
    const pct = (100 / n) * index;
    track.style.transform = "translateX(-" + pct + "%)";
    slides.forEach(function (el, j) {
      el.setAttribute("aria-hidden", j === index ? "false" : "true");
    });
    dots.forEach(function (dot, j) {
      dot.classList.toggle("is-active", j === index);
      dot.setAttribute("aria-selected", j === index ? "true" : "false");
    });
  }

  function next() {
    go(index + 1);
  }
  function prev() {
    go(index - 1);
  }

  function resetAutoplay() {
    if (prefersReducedMotion) return;
    if (autoplayId) {
      clearInterval(autoplayId);
      autoplayId = null;
    }
    autoplayId = setInterval(next, autoplayMs);
  }

  function stopAutoplay() {
    if (autoplayId) {
      clearInterval(autoplayId);
      autoplayId = null;
    }
  }

  root.setAttribute("tabindex", "0");
  root.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      prev();
      resetAutoplay();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      next();
      resetAutoplay();
    }
  });

  let touchStartX = null;
  let touchStartY = null;
  const touchEl = viewport || root;

  function resetTouch() {
    touchStartX = null;
    touchStartY = null;
  }

  touchEl.addEventListener(
    "touchstart",
    function (e) {
      if (e.touches.length !== 1) return;
      touchStartX = e.touches[0].screenX;
      touchStartY = e.touches[0].screenY;
    },
    { passive: true }
  );

  touchEl.addEventListener(
    "touchmove",
    function (e) {
      if (touchStartX == null || touchStartY == null) return;
      if (e.touches.length !== 1) return;
      const x = e.touches[0].screenX;
      const y = e.touches[0].screenY;
      const dx = Math.abs(x - touchStartX);
      const dy = Math.abs(y - touchStartY);
      if (dx > dy && dx > 6) {
        e.preventDefault();
      }
    },
    { passive: false }
  );

  touchEl.addEventListener(
    "touchend",
    function (e) {
      if (touchStartX == null) return;
      const t = e.changedTouches[0];
      const dx = t.screenX - touchStartX;
      resetTouch();
      if (Math.abs(dx) < 44) return;
      if (dx < 0) next();
      else prev();
      resetAutoplay();
    },
    { passive: true }
  );

  touchEl.addEventListener("touchcancel", resetTouch, { passive: true });

  root.addEventListener("mouseenter", stopAutoplay);
  root.addEventListener("mouseleave", resetAutoplay);

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stopAutoplay();
    else if (!prefersReducedMotion) resetAutoplay();
  });

  if (!prefersReducedMotion) resetAutoplay();

  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

function getWeekStartMonday(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const shift = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + shift);
  return d;
}

function addMinutesToWeekBuckets(buckets, startMs, endMs, weekStart, weekEnd) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
  const clipStart = Math.max(startMs, weekStart.getTime());
  const clipEnd = Math.min(endMs, weekEnd.getTime());
  if (clipEnd <= clipStart) return;

  let cursor = clipStart;
  while (cursor < clipEnd) {
    const current = new Date(cursor);
    const dayStart = new Date(current);
    dayStart.setHours(0, 0, 0, 0);
    const nextDayStart = new Date(dayStart);
    nextDayStart.setDate(nextDayStart.getDate() + 1);
    const segmentEnd = Math.min(clipEnd, nextDayStart.getTime());
    const day = dayStart.getDay();
    const weekdayIndex = day - 1; // Mon=0 ... Fri=4
    if (weekdayIndex >= 0 && weekdayIndex <= 4) {
      buckets[weekdayIndex] += (segmentEnd - cursor) / 60000;
    }
    cursor = segmentEnd;
  }
}

async function setupWeeklyProgress() {
  const items = document.querySelectorAll(".week-item");
  const totalElement = document.getElementById("weeklyTotal");
  const noteElement = document.getElementById("weeklyNote");
  if (items.length === 0 || !totalElement || !noteElement) return;

  const weekMinutes = [0, 0, 0, 0, 0];
  const weekStart = getWeekStartMonday(new Date());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  try {
    const data = await hotDeskApiJsonSimple("GET", "/api/me/clock-punch?limit=300");
    const rows = data && Array.isArray(data.clockIns) ? data.clockIns : [];
    rows.forEach(function (row) {
      const inMs = new Date(row && row.clockIn).getTime();
      const outMs = row && row.clockOut ? new Date(row.clockOut).getTime() : Date.now();
      addMinutesToWeekBuckets(weekMinutes, inMs, outMs, weekStart, weekEnd);
    });
    lastClockPunchRows = rows;
  } catch (_) {
    // Keep zeroed state if API is unavailable.
    lastClockPunchRows = [];
  }

  const dayHours = weekMinutes.map(function (mins) {
    return mins / 60;
  });
  const totalHours = dayHours.reduce(function (sum, h) {
    return sum + h;
  }, 0);

  items.forEach(function (item, index) {
    const hours = dayHours[index] || 0;
    const bar = item.querySelector(".bar span");
    if (bar) {
      const fill = Math.min((hours / 8) * 100, 100);
      bar.style.width = fill + "%";
    }
  });

  const weeklyTarget = 40;
  const completion = Math.round((totalHours / weeklyTarget) * 100);
  totalElement.textContent = totalHours.toFixed(1) + "h / " + weeklyTarget + "h";

  if (completion >= 100) {
    noteElement.textContent = "Great work. Weekly target reached.";
  } else {
    noteElement.textContent = completion + "% of weekly target complete.";
  }

  highlightToday(items);
  updateSessionClock();
}

/** Start time (ms) of the row with no clock-out, if any. */
function getOpenDeskClockInMs(rows) {
  const list = Array.isArray(rows) ? rows : [];
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    if (!row || row.clockIn == null || row.clockIn === "") continue;
    if (row.clockOut != null && row.clockOut !== "") continue;
    const t = new Date(row.clockIn).getTime();
    if (Number.isFinite(t)) return t;
  }
  return null;
}

/**
 * Desk time for the session clock: all completed intervals today (local midnight window) plus the live
 * open segment. Multiple clock-in/out rows per booking are summed. If the current open session started
 * before today's midnight, the live part uses full elapsed time so the counter does not jump to 0 at 00:00.
 */
function computeTodayWorkMs(rows, nowMs, isWorking) {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const d0 = dayStart.getTime();
  const d1 = dayEnd.getTime();

  let closedToday = 0;
  (Array.isArray(rows) ? rows : []).forEach(function (row) {
    if (!row) return;
    const hasOut = row.clockOut != null && row.clockOut !== "";
    if (!hasOut) return;
    const inMs = new Date(row.clockIn).getTime();
    if (!Number.isFinite(inMs)) return;
    const outMs = new Date(row.clockOut).getTime();
    if (!Number.isFinite(outMs)) return;
    const clipStart = Math.max(inMs, d0);
    const clipEnd = Math.min(outMs, d1);
    if (clipEnd > clipStart) closedToday += clipEnd - clipStart;
  });

  if (!isWorking) return closedToday;

  const openIn = getOpenDeskClockInMs(rows);
  if (openIn == null || !Number.isFinite(openIn)) return closedToday;

  if (openIn < d0) {
    return closedToday + (nowMs - openIn);
  }

  return closedToday + (nowMs - openIn);
}

async function refreshClockPunchCache() {
  try {
    const data = await hotDeskApiJsonSimple("GET", "/api/me/clock-punch?limit=300");
    lastClockPunchRows = data && Array.isArray(data.clockIns) ? data.clockIns : [];
  } catch (_) {
    lastClockPunchRows = [];
  }
}

function highlightToday(items) {
  items.forEach(function (it) {
    it.classList.remove("is-today");
  });
  const dayNumber = new Date().getDay();
  if (dayNumber < 1 || dayNumber > 5) return;

  const itemIndex = dayNumber - 1;
  const targetItem = items[itemIndex];
  if (targetItem) {
    targetItem.classList.add("is-today");
  }
}

function performAppLogoutRedirect() {
  authLogoutAllUrls().finally(function () {
    sessionStorage.removeItem(CARD_LOGIN_KEY);
    try {
      window.location.replace(new URL("pages/sign-in/index.html", window.location.href).href);
    } catch (_) {
      window.location.replace("pages/sign-in/index.html");
    }
  });
}

function setupExitButton() {
  const button = document.querySelector(".finish-session-btn");
  if (!button) return;

  button.addEventListener("click", function () {
    performAppLogoutRedirect();
  });
}

function setupSessionIdleMonitor() {
  const overlay = document.getElementById("session-idle-warning");
  const countEl = document.getElementById("session-idle-count");
  const stayBtn = document.getElementById("session-idle-stay");
  if (!overlay || !countEl || !stayBtn) return;

  var idleWarnTimer = null;
  var idleLogoutTimer = null;
  var countdownTick = null;
  var activityPingTimer = null;

  function clearIdleTimers() {
    if (idleWarnTimer) {
      clearTimeout(idleWarnTimer);
      idleWarnTimer = null;
    }
    if (idleLogoutTimer) {
      clearTimeout(idleLogoutTimer);
      idleLogoutTimer = null;
    }
    if (countdownTick) {
      clearInterval(countdownTick);
      countdownTick = null;
    }
  }

  function hideWarning() {
    overlay.hidden = true;
    if (countdownTick) {
      clearInterval(countdownTick);
      countdownTick = null;
    }
  }

  function showWarning() {
    overlay.hidden = false;
    var left = SESSION_CLIENT_WARN_COUNTDOWN_SEC;
    countEl.textContent = String(left);
    if (countdownTick) clearInterval(countdownTick);
    countdownTick = setInterval(function () {
      left -= 1;
      countEl.textContent = String(Math.max(0, left));
      if (left <= 0 && countdownTick) {
        clearInterval(countdownTick);
        countdownTick = null;
      }
    }, 1000);
    try {
      stayBtn.focus();
    } catch (_) {}
  }

  function sessionIdleLogout() {
    clearIdleTimers();
    hideWarning();
    performAppLogoutRedirect();
  }

  function armIdleTimers() {
    clearIdleTimers();
    hideWarning();
    idleWarnTimer = setTimeout(showWarning, SESSION_CLIENT_IDLE_WARN_MS);
    idleLogoutTimer = setTimeout(sessionIdleLogout, SESSION_CLIENT_IDLE_LIMIT_MS);
  }

  function pingActivityServer() {
    hotDeskApiJsonSimple("POST", "/api/auth/activity", {}).catch(function () {});
  }

  function bumpActivity() {
    armIdleTimers();
    if (activityPingTimer) clearTimeout(activityPingTimer);
    activityPingTimer = setTimeout(function () {
      activityPingTimer = null;
      pingActivityServer();
    }, 400);
  }

  ["pointerdown", "keydown", "touchstart", "wheel"].forEach(function (ev) {
    window.addEventListener(ev, bumpActivity, { passive: true, capture: true });
  });
  window.addEventListener("scroll", bumpActivity, { passive: true });
  document.addEventListener("click", bumpActivity, true);
  stayBtn.addEventListener("click", function () {
    bumpActivity();
  });

  pingActivityServer();
  armIdleTimers();
}

function setupMyStatusSwitcher() {
  const weatherPanel = document.getElementById("weatherPanel");
  const location = document.getElementById("msLocationText");
  const dateText = document.getElementById("msDateText");
  const mainValue = document.getElementById("msMainValue");
  const badge = document.getElementById("msStatusBadge");
  const feelsLike = document.getElementById("msFeelsLike");
  const precipitation = document.getElementById("msPrecipitation");
  if (
    !weatherPanel ||
    !location ||
    !dateText ||
    !mainValue ||
    !badge ||
    !feelsLike ||
    !precipitation
  ) return;

  const stateMap = {
    sunny: {
      badge: "Sunny"
    },
    "few-clouds": {
      badge: "Sunny with few clouds"
    },
    night: {
      badge: "Night"
    },
    raining: {
      badge: "Raining"
    },
    snowing: {
      badge: "Snowing"
    }
  };

  const weatherData = {
    location: "Dublin",
    date: formatWeatherDate(new Date()),
    temperature: "",
    feelsLike: "",
    precipitation: ""
  };

  const weatherClasses = [
    "is-weather-sunny",
    "is-weather-few-clouds",
    "is-weather-night",
    "is-weather-raining",
    "is-weather-snowing"
  ];

  function resetWeatherVisualOnly() {
    weatherPanel.classList.remove.apply(weatherPanel.classList, weatherClasses);
  }

  function showWeatherLoading() {
    weatherPanel.classList.remove("is-weather-error");
    weatherPanel.classList.add("is-weather-loading");
    weatherPanel.setAttribute("aria-busy", "true");
    resetWeatherVisualOnly();
    location.textContent = "Dublin";
    dateText.textContent = "…";
    mainValue.innerHTML =
      '<span class="temp-number">—</span><span class="temp-unit">°C</span>';
    badge.textContent = "Loading…";
    feelsLike.textContent = "…";
    precipitation.textContent = "…";
  }

  function renderWeatherError() {
    weatherPanel.classList.remove("is-weather-loading");
    weatherPanel.classList.add("is-weather-error");
    weatherPanel.setAttribute("aria-busy", "false");
    resetWeatherVisualOnly();
    location.textContent = "Dublin";
    dateText.textContent = formatWeatherDate(new Date());
    mainValue.innerHTML =
      '<span class="temp-number">—</span><span class="temp-unit">°C</span>';
    badge.textContent = "Couldn't load weather";
    feelsLike.textContent = "—";
    precipitation.textContent = "—";
  }

  function applyWeatherVisual(state) {
    weatherPanel.classList.remove.apply(weatherPanel.classList, weatherClasses);
    if (state === "sunny") {
      weatherPanel.classList.add("is-weather-sunny");
      return;
    }
    if (state === "few-clouds") {
      weatherPanel.classList.add("is-weather-few-clouds");
      return;
    }
    if (state === "night") {
      weatherPanel.classList.add("is-weather-night");
      return;
    }
    if (state === "raining") {
      weatherPanel.classList.add("is-weather-raining");
      return;
    }
    if (state === "snowing") {
      weatherPanel.classList.add("is-weather-snowing");
    }
  }

  function formatWeatherDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return formatDateDDMMYYYY(new Date());
    return formatDateDDMMYYYY(date);
  }

  function mapWeatherCodeToState(code, isDay) {
    if ([71, 73, 75, 77, 85, 86].includes(code)) return "snowing";
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)) return "raining";
    if (!isDay) return "night";
    if (code === 0) return "sunny";
    return "few-clouds";
  }

  function renderState(state) {
    weatherPanel.classList.remove("is-weather-loading", "is-weather-error");
    weatherPanel.setAttribute("aria-busy", "false");
    location.textContent = weatherData.location;
    dateText.textContent = weatherData.date;
    mainValue.innerHTML =
      '<span class="temp-number">' +
      weatherData.temperature +
      '</span><span class="temp-unit">°C</span>';
    badge.textContent = stateMap[state].badge;
    feelsLike.textContent = "Feels like " + weatherData.feelsLike + "°C";
    precipitation.textContent = "Precipitation " + weatherData.precipitation + " mm";
    applyWeatherVisual(state);
  }

  function setActiveState(state) {
    renderState(state);
  }

  function fetchDublinWeather() {
    const url =
      "https://api.open-meteo.com/v1/forecast?latitude=53.3498&longitude=-6.2603&current=temperature_2m,apparent_temperature,precipitation,weather_code,is_day&timezone=auto";
    fetch(url)
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Weather fetch failed");
        }
        return response.json();
      })
      .then(function (data) {
        if (!data || !data.current) {
          renderWeatherError();
          return;
        }
        const current = data.current;
        weatherData.location = "Dublin";
        weatherData.date = formatWeatherDate(current.time || new Date());
        weatherData.temperature = String(Math.round(Number(current.temperature_2m) || 0));
        weatherData.feelsLike = String(Math.round(Number(current.apparent_temperature) || 0));
        weatherData.precipitation = (Number(current.precipitation) || 0).toFixed(1);
        const state = mapWeatherCodeToState(
          Number(current.weather_code),
          Number(current.is_day) === 1
        );
        setActiveState(state);
      })
      .catch(function () {
        renderWeatherError();
      });
  }

  showWeatherLoading();
  fetchDublinWeather();
}

function setupOverviewCalendar() {
  const todayDateElement = document.getElementById("overviewTodayDate");
  const weekDaysElement = document.getElementById("overviewWeekDays");
  const weekDatesElement = document.getElementById("overviewWeekDates");
  const statusContainer = document.getElementById("overviewTodayStatus");
  const statusIcon = document.getElementById("todayStatusIcon");
  const statusText = document.getElementById("todayStatusText");
  const statusMeta = document.getElementById("todayStatusMeta");
  if (
    !todayDateElement ||
    !weekDaysElement ||
    !weekDatesElement ||
    !statusContainer ||
    !statusIcon ||
    !statusText ||
    !statusMeta
  ) return;

  overviewRefs = {
    todayDateElement: todayDateElement,
    weekDaysElement: weekDaysElement,
    weekDatesElement: weekDatesElement,
    statusContainer: statusContainer,
    statusIcon: statusIcon,
    statusText: statusText,
    statusMeta: statusMeta
  };

  overviewCenterDate = normalizeDate(new Date());
  renderOverviewCalendar();
}

function overviewDayAriaLabel(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "Day";
  try {
    return d.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  } catch (_) {
    return formatPrettyDate(d);
  }
}

function overviewDayButtonAriaLabel(date) {
  let label = overviewDayAriaLabel(date);
  const dayBookings = bookingsOverlappingCalendarDay(date);
  let bookHint = "";
  if (dayBookings.length === 1) bookHint = overviewFormatBookingTimeRange(dayBookings[0]);
  else if (dayBookings.length > 1) {
    bookHint =
      overviewFormatBookingTimeRange(dayBookings[0]) + " +" + String(dayBookings.length - 1);
  }
  if (bookHint) label += ", " + bookHint.replace(/\s+/g, " ").trim();
  return label;
}

function renderOverviewCalendar() {
  if (!overviewRefs || !overviewCenterDate) return;

  const dates = getCenteredDates(overviewCenterDate);
  overviewRefs.todayDateElement.textContent = formatPrettyDate(overviewCenterDate);

  overviewRefs.weekDaysElement.innerHTML = dates
    .map(function (date, index) {
      const isCenter = index === 2;
      const label = overviewDayButtonAriaLabel(date);
      return (
        '<button type="button" class="overview-day-btn' +
        (isCenter ? " is-center" : "") +
        '" data-index="' +
        String(index) +
        '" aria-label="' +
        label.replace(/&/g, "&amp;").replace(/"/g, "&quot;") +
        '">' +
        getShortWeekday(date) +
        "</button>"
      );
    })
    .join("");

  overviewRefs.weekDatesElement.innerHTML = dates
    .map(function (date, index) {
      const isCenter = index === 2;
      const label = overviewDayButtonAriaLabel(date);
      return (
        '<button type="button" class="overview-date-btn' +
        (isCenter ? " is-center" : "") +
        '" data-index="' +
        String(index) +
        '" aria-label="' +
        label.replace(/&/g, "&amp;").replace(/"/g, "&quot;") +
        '">' +
        String(date.getDate()) +
        "</button>"
      );
    })
    .join("");

  updateOverviewTodayStatus(overviewCenterDate);
  bindOverviewRowClicks(dates);
}

function bindOverviewRowClicks(dates) {
  if (!overviewRefs) return;

  const bindRow = function (container) {
    container.querySelectorAll("button[data-index]").forEach(function (element) {
      element.addEventListener("click", function () {
        const index = Number(element.getAttribute("data-index"));
        if (Number.isNaN(index) || !dates[index]) return;
        const direction = index > 2 ? "next" : index < 2 ? "prev" : "none";
        transitionOverviewToDate(dates[index], direction);
      });
    });
  };
  bindRow(overviewRefs.weekDaysElement);
  bindRow(overviewRefs.weekDatesElement);
}

function transitionOverviewToDate(targetDate, direction) {
  if (!overviewRefs) return;
  if (isOverviewAnimating) return;

  const nextDate = normalizeDate(targetDate);
  if (direction === "none") {
    overviewCenterDate = nextDate;
    renderOverviewCalendar();
    return;
  }

  isOverviewAnimating = true;
  const inClass = direction === "next" ? "slide-in-right" : "slide-in-left";
  overviewCenterDate = nextDate;
  renderOverviewCalendar();

  const targets = [
    overviewRefs.todayDateElement,
    overviewRefs.weekDaysElement,
    overviewRefs.weekDatesElement,
    overviewRefs.statusContainer
  ];

  requestAnimationFrame(function () {
    targets.forEach(function (element) {
      element.classList.remove("slide-in-left", "slide-in-right");
      void element.offsetWidth;
      element.classList.add(inClass);
    });

    waitForAnimationEnd(overviewRefs.weekDatesElement, 260, function () {
      targets.forEach(function (element) {
        element.classList.remove(inClass);
      });
      isOverviewAnimating = false;
    });
  });
}

function waitForAnimationEnd(element, fallbackMs, callback) {
  if (!element) {
    setTimeout(callback, fallbackMs);
    return;
  }

  let done = false;

  function finish() {
    if (done) return;
    done = true;
    element.removeEventListener("animationend", onEnd);
    callback();
  }

  function onEnd(event) {
    if (event.target !== element) return;
    finish();
  }

  element.addEventListener("animationend", onEnd, { once: true });
  setTimeout(finish, fallbackMs);
}

function getCenteredDates(centerDate) {
  return [-2, -1, 0, 1, 2].map(function (offset) {
    const d = new Date(centerDate);
    d.setDate(centerDate.getDate() + offset);
    return normalizeDate(d);
  });
}

function getShortWeekday(date) {
  return date.toLocaleString("en-GB", { weekday: "short" }).replace(".", "");
}

function normalizeDate(date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  return d;
}

function formatDateDDMMYYYY(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear());
  return day + "/" + month + "/" + year;
}

function updateOverviewTodayStatus(date) {
  if (!overviewRefs) return;

  const status = getBookingStatusForDate(date);
  overviewRefs.statusText.textContent = status.text;
  overviewRefs.statusMeta.textContent = status.meta;
  const iconEl = overviewRefs.statusIcon;
  iconEl.className = "today-status-icon";
  iconEl.setAttribute("data-lucide", status.lucideIcon);
  // Lucide does not swap an existing SVG when only data-lucide changes; clear first so the
  // overview can go from "no booking" (first paint) to room/desk after bookings load.
  iconEl.replaceChildren();
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }

  overviewRefs.statusContainer.classList.remove("is-room", "is-desk", "is-none");
  overviewRefs.statusContainer.classList.add(status.className);
}

function getBookingStatusForDate(date) {
  const list = bookingsOverlappingCalendarDay(date);
  if (!list.length) {
    return {
      className: "is-none",
      text: "No reservation",
      meta: "No desk or room booked this day",
      lucideIcon: "calendar-x"
    };
  }

  const primary = list[0];
  const space = overviewGetSpaceSummary(primary);
  const timeRange = overviewFormatBookingTimeRange(primary);
  let meta = timeRange || "";
  if (list.length > 1) {
    meta = (meta ? meta + " · " : "") + String(list.length - 1) + " more booking" + (list.length === 2 ? "" : "s");
  }
  const statusNote = String(primary.status || "").trim();
  if (statusNote && statusNote.toLowerCase() !== "confirmed") {
    meta = meta ? meta + " · " + statusNote : statusNote;
  }

  const isRoom = space.kind === "room";
  return {
    className: isRoom ? "is-room" : "is-desk",
    text: space.text,
    meta: meta || "Booked",
    lucideIcon: isRoom ? "building-2" : "laptop"
  };
}

function formatPrettyDate(date) {
  return formatDateDDMMYYYY(date);
}

function startTodayClockTimer() {
  if (sessionTimerId) return;
  sessionTimerId = setInterval(updateSessionClock, 1000);
}

function stopTodayClockTimer() {
  if (sessionTimerId) {
    clearInterval(sessionTimerId);
    sessionTimerId = null;
  }
}

async function syncClockUiFromServer() {
  const button = document.getElementById("clockToggleBtn");
  const label = button && button.querySelector(".clock-label");
  if (!button || !label) return;

  try {
    const state = await hotDeskApiJsonSimple("GET", "/api/me/clock/state");
    const inSession = !!(state && state.inSession);
    const working = !!(state && state.working);
    clockStateWorking = working;
    if (state && state.suggestedBookingId != null && !Number.isNaN(Number(state.suggestedBookingId))) {
      const sid = Number(state.suggestedBookingId);
      clockSuggestedBookingId = sid > 0 ? sid : null;
    } else {
      clockSuggestedBookingId = null;
    }

    stopTodayClockTimer();
    await refreshClockPunchCache();

    if (inSession && working) {
      button.classList.add("is-clocked-in");
      button.setAttribute("aria-pressed", "true");
      label.textContent = "Clock Out";
      startTodayClockTimer();
    } else {
      button.classList.remove("is-clocked-in");
      button.setAttribute("aria-pressed", "false");
      label.textContent = "Clock In";
    }
    updateSessionClock();
  } catch (_) {
    clockSuggestedBookingId = null;
    updateSessionClock();
  }
}

function setupClockToggle() {
  const button = document.getElementById("clockToggleBtn");
  if (!button) return;

  const label = button.querySelector(".clock-label");
  if (!label) return;

  button.addEventListener("click", function () {
    const willClockIn = !button.classList.contains("is-clocked-in");
    const kind = willClockIn ? "clock_in" : "clock_out";
    const punchBody = { kind };
    if (willClockIn && clockSuggestedBookingId != null) {
      punchBody.bookingId = clockSuggestedBookingId;
    }

    hotDeskApiJsonSimple("POST", "/api/me/clock-punch", punchBody)
      .then(async function () {
        button.classList.toggle("is-clocked-in", willClockIn);
        button.setAttribute("aria-pressed", String(willClockIn));
        button.classList.remove("state-swipe");
        void button.offsetWidth;
        button.classList.add("state-swipe");

        clockStateWorking = !!willClockIn;
        if (willClockIn) {
          label.textContent = "Clock Out";
          startTodayClockTimer();
        } else {
          label.textContent = "Clock In";
          stopTodayClockTimer();
        }
        await setupWeeklyProgress();
        updateSessionClock();
      })
      .catch(function (err) {
        console.warn(err && err.message ? err.message : err);
      });
  });
}

function updateSessionClock() {
  const clockMain = document.getElementById("sessionClockMain");
  const clockSeconds = document.getElementById("sessionClockSeconds");
  const labelEl = document.querySelector(".weekly-panel .session-clock-label");
  if (!clockMain || !clockSeconds) return;

  const nowMs = Date.now();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const d0 = dayStart.getTime();
  const openIn = getOpenDeskClockInMs(lastClockPunchRows);
  const totalMs = computeTodayWorkMs(lastClockPunchRows, nowMs, clockStateWorking);
  const parts = formatDurationParts(totalMs);
  clockMain.textContent = parts.main;
  clockSeconds.textContent = parts.seconds;
  if (labelEl) {
    if (clockStateWorking && openIn != null && openIn < d0) {
      labelEl.textContent = "Session (live)";
    } else {
      labelEl.textContent = clockStateWorking ? "Today (live)" : "Today total";
    }
  }
}

function formatDurationParts(totalMs) {
  const totalSeconds = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return {
    main: String(hours).padStart(2, "0") + ":" + String(minutes).padStart(2, "0"),
    seconds: ":" + String(seconds).padStart(2, "0")
  };
}

// -----------------------------------------------------------------------------
// Entry
// What: If #card-login-gate exists → sign-in flow; else require gate flag then init dashboard.
// Why:  Same script on sign-in and index; one bundle for kiosk simplicity.
// -----------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async function () {
  const gate = document.getElementById("card-login-gate");

  if (gate) {
    await tryRestoreSessionFromCookie();
    const sp = typeof URLSearchParams !== "undefined" ? new URLSearchParams(location.search) : null;
    const autoPair = sp && sp.get("pair") === "1";
    if (sessionStorage.getItem(CARD_LOGIN_KEY) === "1" && !autoPair) {
      redirectSignInToApp();
      return;
    }
    const restartLinkedPhonePoll = setupCardLoginGate({ autoPair: autoPair });
    window.addEventListener("pageshow", function (ev) {
      if (!ev.persisted) return;
      if (typeof restartLinkedPhonePoll !== "function") return;
      restartLinkedPhonePoll();
    });
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
    return;
  }

  await tryRestoreSessionFromCookie({ clearStaleGateFlag: true });
  if (sessionStorage.getItem(CARD_LOGIN_KEY) !== "1") {
    try {
      const u = new URL("pages/sign-in/index.html", location.href);
      u.searchParams.set("return", location.pathname + location.search);
      window.location.replace(u.pathname + u.search);
    } catch (_) {
      window.location.replace(
        "pages/sign-in/index.html?return=" + encodeURIComponent(location.pathname + location.search)
      );
    }
    return;
  }

  setupNewBookingMapLink();
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
  await syncClockUiFromServer().catch(function () {
    updateSessionClock();
  });
  setupWeeklyProgress();
  await refreshOverviewBookings().catch(function (e) {
    console.warn(e && e.message ? e.message : e);
  });
  setupOverviewCalendar();
  setupMyStatusSwitcher();
  setupExitButton();
  setupSessionIdleMonitor();
  setupClockToggle();
  setupNewsCarousel();
});
