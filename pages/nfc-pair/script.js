// -----------------------------------------------------------------------------
// Phone NFC: "open bridge" mode (preferred) OR legacy ?pairing= flow
// Bridge: one static URL, shared HOT_DESK_NFC_BRIDGE_KEY, continuous Web NFC → POST /api/nfc-open/push
// Legacy: kiosk QR with ?pairing= for localStorage-linked scanner (no bridge key configured)
// -----------------------------------------------------------------------------
(function () {
  function bridgeKeyTrimmed() {
    return typeof window.HOT_DESK_NFC_BRIDGE_KEY === "string"
      ? window.HOT_DESK_NFC_BRIDGE_KEY.trim()
      : "";
  }

  function tryApiOnSameHostPort4000(hostname) {
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
    let apiBase = "";
    if (typeof window.HOT_DESK_API === "string" && window.HOT_DESK_API.trim()) {
      apiBase = window.HOT_DESK_API.trim().replace(/\/$/, "");
    }
    if (typeof window !== "undefined" && window.location && window.location.protocol !== "file:") {
      try {
        const page = new URL(window.location.href);
        push(page.origin + path);
      } catch (_) {}
    }
    if (apiBase) push(apiBase + path);
    if (typeof window !== "undefined" && window.location && window.location.protocol !== "file:") {
      try {
        const u = new URL(window.location.href);
        const host = u.hostname;
        if (host && tryApiOnSameHostPort4000(host)) {
          const proto = u.protocol === "https:" ? "https" : "http";
          push(proto + "://" + host + ":4000" + path);
        }
      } catch (_) {}
    }
    push("http://localhost:4000" + path);
    return out;
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

  function pushNfcOpen(key, token, payloadStr) {
    const urls = hotDeskApiUrlCandidates("/api/nfc-open/push");
    let lastErr = null;
    let sawNetworkFailure = false;
    return (async function () {
      for (let i = 0; i < urls.length; i += 1) {
        try {
          const res = await fetch(urls[i], {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Hot-Desk-Nfc-Key": key,
            },
            credentials: "omit",
            body: JSON.stringify({ nfcToken: token, nfcPayload: payloadStr }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error((data && data.error) || "HTTP " + res.status);
          return;
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
        throw new Error("Could not reach the API. Is npm run dev running on your PC?");
      }
      throw lastErr || new Error("Request failed");
    })();
  }

  function initOpenBridgePage() {
    const key = bridgeKeyTrimmed();
    const titleEl = document.querySelector(".nfc-pair-title");
    const leadEl = document.getElementById("nfc-pair-lead");
    const scanBtn = document.getElementById("nfc-pair-scan-btn");
    const mainEl = document.querySelector(".nfc-pair-main");

    function setStatus(msg, isError) {
      var el = document.getElementById("nfc-pair-status");
      var text = msg == null ? "" : String(msg);
      if (!el) {
        try {
          window.alert(text || "(no status line)");
        } catch (_) {}
        return;
      }
      el.textContent = text;
      el.classList.toggle("is-error", !!isError);
      try {
        el.setAttribute("aria-live", "assertive");
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch (_) {}
      window.setTimeout(function () {
        try {
          el.setAttribute("aria-live", "polite");
        } catch (_) {}
      }, 500);
    }

    window.addEventListener("error", function (event) {
      var m = event && event.message ? event.message : "Unknown error";
      setStatus("Page error: " + m, true);
    });
    window.addEventListener("unhandledrejection", function (event) {
      var r = event && event.reason;
      var m = (r && r.message) || (typeof r === "string" ? r : r && String(r)) || "Unhandled error";
      setStatus("Error: " + m, true);
    });

    if (titleEl) titleEl.textContent = "Phone NFC bridge";
    if (leadEl) {
      leadEl.textContent =
        "Leave this page open. Each badge scan is sent to the PC sign-in screen (same shared secret as the backend). Tap once below if the browser requires it to turn NFC on.";
    }
    if (scanBtn) {
      scanBtn.textContent = "Start / resume NFC";
      scanBtn.style.display = "";
    }

    const hasNfcApi = typeof window.NDEFReader === "function";
    const secure = window.isSecureContext === true;
    if (!hasNfcApi || !secure) {
      if (mainEl) mainEl.classList.add("nfc-pair-blocked");
      setStatus(
        !secure
          ? "Use HTTPS (e.g. ngrok) or localhost — Web NFC needs a secure context."
          : "Use Google Chrome on Android with Web NFC.",
        true
      );
      if (scanBtn) {
        scanBtn.addEventListener("click", function () {
          window.alert(
            !secure
              ? "Open this page over HTTPS (ngrok) or localhost so Web NFC can run."
              : "Install Chrome on Android — this browser has no Web NFC."
          );
        });
      }
      return;
    }

    var scanAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
    var ndef = null;

    function armReader() {
      if (scanAbort) {
        try {
          scanAbort.abort();
        } catch (_) {}
      }
      scanAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
      var signal = scanAbort ? scanAbort.signal : undefined;

      try {
        ndef = new window.NDEFReader();
      } catch (e) {
        setStatus((e && e.message) || "Could not create NDEFReader.", true);
        return;
      }

      ndef.addEventListener("reading", function (ev) {
        const serial = ev.serialNumber || "";
        const fromRecords = nfcReadableIdFromMessage(ev.message);
        let token = String(fromRecords || serial || "").trim();
        if (!token) token = "nfc-" + String(Date.now());
        let payloadStr = null;
        try {
          payloadStr = JSON.stringify({ serial: serial, text: fromRecords });
        } catch (_) {}

        setStatus("Tag read — sending to kiosk…", false);
        pushNfcOpen(key, token, payloadStr)
          .then(function () {
            setStatus("Sent to kiosk. Scan the next badge when the login screen is waiting.", false);
          })
          .catch(function (err) {
            setStatus((err && err.message) || "Push failed.", true);
          });
      });

      ndef.addEventListener("readingerror", function () {
        setStatus("NFC read error — try the badge again.", true);
      });

      var p = signal ? ndef.scan({ signal: signal }) : ndef.scan();
      Promise.resolve(p).catch(function (err) {
        if (err && err.name === "AbortError") return;
        var msg = (err && (err.message || err.name)) || "NFC could not start.";
        setStatus(String(msg), true);
        if (/not allowed|permission|gesture|user/i.test(String(msg))) {
          setStatus(msg + " Tap “Start / resume NFC”.", true);
        }
      });
    }

    if (scanBtn) {
      scanBtn.addEventListener("click", function () {
        armReader();
        setStatus("NFC listening — hold badge on the back of the phone.", false);
      });
    }

    armReader();
    setStatus("Starting NFC… If nothing happens, tap “Start / resume NFC”.", false);
  }

  // --- Legacy pairing page (no bridge key): same as before ---
  const LS_PHONE_DEVICE = "hotDeskPhoneScannerDevice";

  function hotDeskApiJsonSimple(method, path, body) {
    const urls = hotDeskApiUrlCandidates(path);
    let lastErr = null;
    let sawNetworkFailure = false;
    return (async function () {
      for (let i = 0; i < urls.length; i += 1) {
        try {
          const res = await fetch(urls[i], {
            method,
            headers: { "Content-Type": "application/json" },
            credentials: "omit",
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
      if (sawNetworkFailure) throw new Error("Could not reach the API.");
      throw lastErr || new Error("Request failed");
    })();
  }

  function bindDirectLoginScanButton(scanBtn, setStatus) {
    var scanAbort = null;
    scanBtn.addEventListener("click", function (ev) {
      if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
      (async function () {
        if (scanAbort) {
          try {
            scanAbort.abort();
          } catch (_) {}
          scanAbort = null;
        }
        setStatus("Preparing NFC reader…", false);
        var ndef;
        try {
          ndef = new window.NDEFReader();
        } catch (e) {
          setStatus((e && e.message) || "Could not create NDEFReader.", true);
          return;
        }
        scanAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
        var signal = scanAbort ? scanAbort.signal : undefined;
        ndef.addEventListener(
          "reading",
          function (evr) {
            const serial = evr.serialNumber || "";
            const fromRecords = nfcReadableIdFromMessage(evr.message);
            let token = String(fromRecords || serial || "").trim();
            if (!token) token = "nfc-" + String(Date.now());
            setStatus("Tag read — signing in…", false);
            hotDeskApiJsonSimple("POST", "/api/auth/nfc", { nfcUid: token })
              .then(function () {
                setStatus("Login successful. You can go back to home.", false);
              })
              .catch(function (err) {
                setStatus((err && err.message) || "Card not registered or inactive.", true);
              });
          },
          { once: true }
        );
        ndef.addEventListener(
          "readingerror",
          function () {
            setStatus("Could not read this tag. Try again.", true);
          },
          { once: true }
        );
        try {
          if (signal) await ndef.scan({ signal: signal });
          else await ndef.scan();
          setStatus("NFC listening — hold badge to the back of the phone.", false);
        } catch (err) {
          if (err && err.name === "AbortError") return;
          setStatus((err && err.message) || "NFC could not start.", true);
        }
      })().catch(function (err) {
        setStatus((err && err.message) || "Unexpected error.", true);
      });
    });
  }

  function loadPhoneDeviceCreds() {
    try {
      const raw = localStorage.getItem(LS_PHONE_DEVICE);
      if (!raw) return null;
      const j = JSON.parse(raw);
      if (j && j.id && j.phoneSecret) {
        return { id: String(j.id), phoneSecret: String(j.phoneSecret) };
      }
    } catch (_) {}
    return null;
  }

  function savePhoneDeviceCreds(phoneScanner) {
    if (!phoneScanner || !phoneScanner.id || !phoneScanner.phoneSecret) return;
    try {
      localStorage.setItem(
        LS_PHONE_DEVICE,
        JSON.stringify({ id: phoneScanner.id, phoneSecret: phoneScanner.phoneSecret })
      );
    } catch (_) {}
  }

  function bindNfcScanButton(scanBtn, setStatus, mode, pairingId, deviceCreds) {
    var scanAbort = null;
    var waitTimer = null;

    function clearNfcWait() {
      if (waitTimer) {
        clearTimeout(waitTimer);
        waitTimer = null;
      }
    }

    scanBtn.addEventListener("click", function (ev) {
      if (ev && typeof ev.preventDefault === "function") ev.preventDefault();

      var run = async function () {
        if (scanAbort) {
          try {
            scanAbort.abort();
          } catch (_) {}
          scanAbort = null;
        }
        clearNfcWait();

        setStatus("Tapped — preparing NFC reader…", false);
        await new Promise(function (resolve) {
          requestAnimationFrame(function () {
            requestAnimationFrame(resolve);
          });
        });

        var ndef;
        try {
          ndef = new window.NDEFReader();
        } catch (e) {
          setStatus(
            (e && e.message) || "Could not create NDEFReader. Use Google Chrome on Android with https.",
            true
          );
          return;
        }

        scanAbort = typeof AbortController !== "undefined" ? new AbortController() : null;
        var signal = scanAbort ? scanAbort.signal : undefined;
        var sawRead = false;

        ndef.addEventListener(
          "reading",
          function (ev) {
            sawRead = true;
            clearNfcWait();
            if (scanAbort) {
              try {
                scanAbort.abort();
              } catch (_) {}
              scanAbort = null;
            }

            const serial = ev.serialNumber || "";
            const fromRecords = nfcReadableIdFromMessage(ev.message);
            let token = String(fromRecords || serial || "").trim();
            if (!token) token = "nfc-" + String(Date.now());
            let payloadStr = null;
            try {
              payloadStr = JSON.stringify({ serial: serial, text: fromRecords });
            } catch (_) {}

            setStatus("Tag read — sending to kiosk…", false);
            if (mode === "pairing" && pairingId) {
              hotDeskApiJsonSimple(
                "POST",
                "/api/nfc-pairing/sessions/" + encodeURIComponent(pairingId) + "/complete",
                {
                  nfcToken: token,
                  nfcPayload: payloadStr,
                }
              )
                .then(function (data) {
                  if (data && data.phoneScanner) {
                    savePhoneDeviceCreds(data.phoneScanner);
                  }
                  setStatus(
                    "Linked — saving on this phone… Next screen is scanner mode. Bookmark that page only if the address has no pairing= in it.",
                    false
                  );
                  try {
                    window.location.replace(window.location.pathname + (window.location.hash || ""));
                  } catch (_) {
                    window.location.href = window.location.pathname;
                  }
                })
                .catch(function (err) {
                  setStatus((err && err.message) || "Could not reach the server.", true);
                });
            } else if (mode === "scanner" && deviceCreds) {
              hotDeskApiJsonSimple("POST", "/api/nfc-scanner/push", {
                scannerId: deviceCreds.id,
                phoneSecret: deviceCreds.phoneSecret,
                nfcToken: token,
                nfcPayload: payloadStr,
              })
                .then(function () {
                  setStatus(
                    "Sent — when the login screen is waiting, scan the next badge the same way. No QR needed.",
                    false
                  );
                })
                .catch(function (err) {
                  const msg = (err && err.message) || "Could not reach the server.";
                  if (/forbidden|403/i.test(msg)) {
                    try {
                      localStorage.removeItem(LS_PHONE_DEVICE);
                    } catch (_) {}
                    setStatus(
                      "This phone needs to be linked again — open a fresh QR code from the kiosk once.",
                      true
                    );
                    scanBtn.disabled = true;
                  } else {
                    setStatus(msg, true);
                  }
                });
            }
          },
          { once: true }
        );

        ndef.addEventListener(
          "readingerror",
          function () {
            clearNfcWait();
            setStatus("Could not read this tag (try again, or the tag may not be NDEF).", true);
          },
          { once: true }
        );

        waitTimer = setTimeout(function () {
          if (!sawRead) {
            if (scanAbort) {
              try {
                scanAbort.abort();
              } catch (_) {}
              scanAbort = null;
            }
            setStatus(
              "No tag detected yet. Try again: wake the phone, tap Scan, hold the card on the back for several seconds.",
              true
            );
          }
        }, 45000);

        setStatus("NFC reader starting — hold your badge on the back. Accept any prompt.", false);

        try {
          if (signal) {
            await ndef.scan({ signal: signal });
          } else {
            await ndef.scan();
          }
        } catch (err) {
          clearNfcWait();
          if (err && err.name === "AbortError") return;
          var errMsg =
            (err && (err.message || err.name)) ||
            "NFC could not start. Use Chrome on Android, system NFC on, and this page over https.";
          setStatus(String(errMsg), true);
        }
      };

      run().catch(function (err) {
        var m =
          (err && err.message) ||
          (err && err.name) ||
          String(err) ||
          "Unexpected error. Try Chrome on Android over https.";
        setStatus(m, true);
        try {
          console.error("[nfc-pair]", err);
        } catch (_) {}
        try {
          window.alert(m);
        } catch (_) {}
      });
    });
  }

  function legacyPairingDomReady() {
    const params = new URLSearchParams(window.location.search);
    const pairingId = (params.get("pairing") || "").trim();
    const device = loadPhoneDeviceCreds();
    const leadEl = document.getElementById("nfc-pair-lead");
    const scanBtn = document.getElementById("nfc-pair-scan-btn");
    const mainEl = document.querySelector(".nfc-pair-main");
    const titleEl = document.querySelector(".nfc-pair-title");

    function setStatus(msg, isError) {
      var el = document.getElementById("nfc-pair-status");
      var text = msg == null ? "" : String(msg);
      if (!el) {
        try {
          window.alert(text || "NFC status (status line missing).");
        } catch (_) {}
        return;
      }
      el.textContent = text;
      el.classList.toggle("is-error", !!isError);
      try {
        el.setAttribute("aria-live", "assertive");
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch (_) {}
      window.setTimeout(function () {
        try {
          el.setAttribute("aria-live", "polite");
        } catch (_) {}
      }, 500);
    }

    window.addEventListener("error", function (event) {
      var m = event && event.message ? event.message : "Unknown script error";
      setStatus("Page error: " + m + " (see browser console).", true);
    });

    window.addEventListener("unhandledrejection", function (event) {
      var r = event && event.reason;
      var m =
        (r && r.message) ||
        (typeof r === "string" ? r : r && String(r)) ||
        "Unhandled promise error";
      setStatus("Error: " + m, true);
    });

    if (!scanBtn) {
      setStatus("Missing scan button on this page (check HTML).", true);
      return;
    }

    const hasNfcApi = typeof window.NDEFReader === "function";
    const secure = window.isSecureContext === true;
    const nfcOk = hasNfcApi && secure;

    if (!nfcOk) {
      if (mainEl) mainEl.classList.add("nfc-pair-blocked");
      if (leadEl) {
        leadEl.textContent =
          !secure
            ? "Web NFC needs HTTPS (e.g. your ngrok link) or localhost — not plain http:// on an IP address. Tap the button for details."
            : "Web NFC needs Google Chrome on Android. Tap the button for details (Samsung Internet and iOS Safari do not support NFC here).";
      }
      setStatus("Tap “Scan NFC badge” to see why scanning may be blocked on this device.", true);
      scanBtn.addEventListener("click", function explainNfcBlock() {
        var parts = [];
        if (!secure) {
          parts.push(
            "This page is not a “secure context”. Open the site with https:// (ngrok or similar), not http://192.168… — otherwise the NFC API is disabled."
          );
        }
        if (!hasNfcApi) {
          parts.push(
            "This browser has no Web NFC (NDEFReader). Install Chrome on Android and open this page there. In-app browsers and iPhone Safari cannot scan."
          );
        }
        var msg = parts.join(" ");
        setStatus(msg, true);
        try {
          window.alert(msg);
        } catch (_) {}
      });
      return;
    }

    if (!pairingId && device) {
      if (titleEl) titleEl.textContent = "Phone scanner";
      scanBtn.textContent = "Scan NFC badge";
      scanBtn.disabled = false;
      if (leadEl) {
        leadEl.textContent =
          "This phone is linked to the kiosk. Tap Scan whenever someone needs to log in — after logout, scan the next card here. No QR code.";
      }
      setStatus("Ready when the login screen is open on the kiosk.");
      bindNfcScanButton(scanBtn, setStatus, "scanner", null, device);
      return;
    }

    if (!pairingId) {
      if (titleEl) titleEl.textContent = "Scan card";
      scanBtn.textContent = "Scan NFC badge";
      scanBtn.disabled = false;
      if (leadEl) {
        leadEl.textContent =
          "Tap scan, hold your badge, and this page signs in directly using the backend API.";
      }
      setStatus("Ready to scan.");
      bindDirectLoginScanButton(scanBtn, setStatus);
      return;
    }

    scanBtn.textContent = "Scan NFC badge";
    scanBtn.disabled = false;
    bindNfcScanButton(scanBtn, setStatus, "pairing", pairingId, null);
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (bridgeKeyTrimmed()) {
      initOpenBridgePage();
      return;
    }
    legacyPairingDomReady();
  });
})();
