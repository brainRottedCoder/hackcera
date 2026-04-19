// ============================================================
// config.js — Extension Backend URL Configuration
//
// Single source of truth for the WebSocket backend URL.
// Priority:
//   1. chrome.storage.sync["backendUrl"]  (user-configured)
//   2. DEPLOYMENT_WS_URL constant         (set at build time)
//   3. ws://localhost:3001                 (local dev fallback)
//
// To point the extension at a deployed backend:
//   chrome.storage.sync.set({ backendUrl: "wss://your-app.railway.app" })
// ============================================================

// ── Switch between LOCAL dev and PRODUCTION ─────────────────
//
//  LOCAL DEV  (uses ws://localhost:3001):
//    const DEPLOYMENT_WS_URL = "";
//
//  PRODUCTION (uses the Render.com backend):
//    const DEPLOYMENT_WS_URL = "https://hackcera.onrender.com";
//
// ⬇ Change this one line to switch environments ⬇
const DEPLOYMENT_WS_URL = "";   // ← empty = localhost (dev mode)

const LOCAL_WS_URL = "ws://localhost:3001";

/**
 * Auto-corrects http/https to ws/wss for WebSocket usage.
 */
function normalizeWsUrl(url) {
  if (!url) return url;
  if (url.startsWith("http://")) return url.replace("http://", "ws://");
  if (url.startsWith("https://")) return url.replace("https://", "wss://");
  return url;
}

/**
 * Returns the WebSocket backend URL.
 * Checks chrome.storage.sync first so users can override without
 * reloading the extension.
 * @returns {Promise<string>}
 */
export async function getBackendUrl() {
  try {
    const result = await chrome.storage.sync.get(["backendUrl"]);
    if (result.backendUrl && result.backendUrl.trim()) {
      const url = normalizeWsUrl(result.backendUrl.trim());
      console.log("[Config] Using stored backend URL:", url);
      return url;
    }
  } catch (e) {
    // storage.sync unavailable (e.g. in tests)
  }

  if (DEPLOYMENT_WS_URL) {
    const url = normalizeWsUrl(DEPLOYMENT_WS_URL);
    console.log("[Config] Using deployment URL:", url);
    return url;
  }

  console.log("[Config] Using local dev URL:", LOCAL_WS_URL);
  return LOCAL_WS_URL;
}

/**
 * Persist a custom backend URL to chrome.storage.sync.
 * @param {string} url - e.g. "wss://meetsense-ai.railway.app"
 */
async function setBackendUrl(url) {
  await chrome.storage.sync.set({ backendUrl: url });
  console.log("[Config] Backend URL updated to:", url);
}
