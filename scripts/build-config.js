const fs = require("fs");
const path = require("path");

const inferredVercelOrigin = (function () {
  const prod = (process.env.VERCEL_PROJECT_PRODUCTION_URL || "").trim();
  if (prod) return "https://" + prod.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  const preview = (process.env.VERCEL_URL || "").trim();
  if (preview) return "https://" + preview.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  return "";
})();
const publicOrigin = (process.env.HOT_DESK_PUBLIC_ORIGIN || inferredVercelOrigin || "").trim().replace(/\/$/, "");
const apiBase = (process.env.HOT_DESK_API || "https://cabackend.herokuapp.com").trim().replace(/\/$/, "");
const autoDevSession = (process.env.HOT_DESK_AUTO_DEV_SESSION || "0").trim() === "1";

const outFile = path.join(__dirname, "..", "hot-desk-config.js");
const content =
  "/**\n" +
  " * Generated at build time from environment variables.\n" +
  " * HOT_DESK_PUBLIC_ORIGIN, HOT_DESK_API, HOT_DESK_AUTO_DEV_SESSION\n" +
  " */\n" +
  `window.HOT_DESK_PUBLIC_ORIGIN = ${JSON.stringify(publicOrigin)};\n` +
  `window.HOT_DESK_API = ${JSON.stringify(apiBase)};\n` +
  `window.HOT_DESK_AUTO_DEV_SESSION = ${autoDevSession ? "true" : "false"};\n`;

fs.writeFileSync(outFile, content, "utf8");
console.log("[build-config] wrote Frontend/hot-desk-config.js");
console.log("[build-config] HOT_DESK_PUBLIC_ORIGIN =", publicOrigin || "(empty)");
console.log("[build-config] HOT_DESK_API =", apiBase);
