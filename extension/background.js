// ============================================================
// background.js — Service Worker
//
// ONLY activates when a Google Meet tab is open and active.
// Automatically pauses all processing when Meet is closed/switched.
// ============================================================

const WS_URL       = "ws://localhost:3001"; // → wss://your-backend.onrender.com in prod
const MEET_PATTERN = "https://meet.google.com/*";
const MEET_ORIGIN  = "meet.google.com";

let socket            = null;
let reconnectDelay    = 1000;
let reconnectTimer    = null;
let isMeetActive      = false;   // ← master guard flag
let activeMeetTabId   = null;
let lastChunkSentIndex = 0;

// ══════════════════════════════════════════════════════════
// 1.  Meet Tab Detection
//     Watch tab create / update / activate / close events
//     to keep isMeetActive accurate at all times.
// ══════════════════════════════════════════════════════════

// Check ALL open tabs on startup (extension reload / Chrome restart)
async function checkForMeetTab() {
  const tabs = await chrome.tabs.query({ url: MEET_PATTERN });
  if (tabs.length > 0) {
    onMeetOpened(tabs[0].id);
  } else {
    onMeetClosed();
  }
}

function onMeetOpened(tabId) {
  if (isMeetActive && tabId === activeMeetTabId) return; // already tracking
  console.log(`[MeetSense] ✅ Meet tab detected (tab ${tabId}). Activating.`);
  isMeetActive    = true;
  activeMeetTabId = tabId;
  lastChunkSentIndex = 0; // reset pointer for new session
  connectWebSocket();
  broadcastToPanel({ type: "MEET_STATUS", active: true });
}

function onMeetClosed() {
  if (!isMeetActive) return; // already inactive
  console.log("[MeetSense] ❌ Meet tab gone. Pausing all processing.");
  isMeetActive    = false;
  activeMeetTabId = null;
  disconnectWebSocket();
  broadcastToPanel({ type: "MEET_STATUS", active: false });
}

// Tab opened or URL changed
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;

  const url = tab.url || "";
  if (url.includes(MEET_ORIGIN) && url.includes("/")) {
    onMeetOpened(tabId);
  } else if (tabId === activeMeetTabId) {
    // User navigated away from Meet in the same tab
    onMeetClosed();
  }
});

// Tab closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeMeetTabId) {
    onMeetClosed();
  }
});

// Tab switched — only matters if we want to show status,
// not required to pause processing (Meet still open in background)
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  const url = tab.url || tab.pendingUrl || "";
  if (url.includes(MEET_ORIGIN)) {
    onMeetOpened(tabId);
  }
});

// ══════════════════════════════════════════════════════════
// 2.  WebSocket Manager
// ══════════════════════════════════════════════════════════

function connectWebSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN ||
                 socket.readyState === WebSocket.CONNECTING)) return;

  clearTimeout(reconnectTimer);
  console.log("[MeetSense] Connecting WebSocket…");

  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    console.log("[MeetSense] WebSocket connected.");
    reconnectDelay = 1000;
    broadcastToPanel({ type: "WS_STATUS", status: "connected" });
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "PONG":
          break;
        case "INSIGHTS_UPDATE":
          broadcastToPanel({ type: "INSIGHTS_UPDATE", payload: data.payload });
          break;
        case "INSIGHTS_ERROR":
          broadcastToPanel({ type: "INSIGHTS_ERROR", message: data.message || "AI processing failed." });
          break;
        case "SUMMARY_RESULT":
          broadcastToPanel({ type: "SUMMARY_RESULT", payload: data.payload });
          break;
        case "SUMMARY_ERROR":
          broadcastToPanel({ type: "SUMMARY_ERROR", message: data.message || "Summary generation failed." });
          break;
      }
    } catch (e) {
      console.warn("[MeetSense] Bad WS message:", e);
    }
  };

  socket.onclose = () => {
    console.warn("[MeetSense] WebSocket closed.");
    broadcastToPanel({ type: "WS_STATUS", status: "disconnected" });

    if (isMeetActive) {
      const currentDelay = reconnectDelay;
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      reconnectTimer = setTimeout(() => {
        connectWebSocket();
      }, currentDelay);
    }
  };

  socket.onerror = () => {
    // onclose fires right after onerror — handled there
  };
}

function disconnectWebSocket() {
  clearTimeout(reconnectTimer);
  if (socket) {
    socket.onclose = null; // prevent reconnect loop
    socket.close();
    socket = null;
  }
  broadcastToPanel({ type: "WS_STATUS", status: "disconnected" });
}

// ══════════════════════════════════════════════════════════
// 3.  TRACK B — 12-second chunk sender
//     Only runs when Meet is open AND WS is live
// ══════════════════════════════════════════════════════════

async function sendChunkToBackend() {
  // ── Master guard: do nothing if Meet isn't open ──
  if (!isMeetActive) {
    console.log("[MeetSense] Meet not active — skipping chunk cycle.");
    return;
  }

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.warn("[MeetSense] WS not ready — skipping chunk cycle.");
    return;
  }

  const result    = await chrome.storage.local.get(["transcriptLog"]);
  const log       = result.transcriptLog || [];
  const newChunks = log.slice(lastChunkSentIndex);

  if (newChunks.length === 0) return;

  const contextText = newChunks.map(c => c.text).join(" ");
  if (contextText.trim().length < 20) return; // silence guard

  lastChunkSentIndex = log.length;

  console.log(`[MeetSense] Sending ${newChunks.length} new chunks.`);
  socket.send(JSON.stringify({
    type: "PROCESS_CHUNK",
    text: contextText,
    chunkCount: newChunks.length,
    timestamp: Date.now()
  }));

  broadcastToPanel({ type: "PROCESSING_INDICATOR", active: true });
}

// ══════════════════════════════════════════════════════════
// 4.  TRACK C — Manual Summary
// ══════════════════════════════════════════════════════════

async function sendSummaryRequest() {
  if (!isMeetActive) {
    broadcastToPanel({ type: "SUMMARY_ERROR", message: "No active Meet session." });
    return;
  }

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    broadcastToPanel({ type: "SUMMARY_ERROR", message: "Not connected to backend." });
    return;
  }

  const result = await chrome.storage.local.get(["transcriptLog"]);
  const log    = result.transcriptLog || [];

  if (log.length === 0) {
    broadcastToPanel({ type: "SUMMARY_ERROR", message: "No transcript to summarize yet." });
    return;
  }

  const fullTranscript = log.map(c => c.text).join(" ");
  broadcastToPanel({ type: "SUMMARY_LOADING", active: true });

  socket.send(JSON.stringify({
    type: "GENERATE_SUMMARY",
    fullTranscript,
    timestamp: Date.now()
  }));
}

// ══════════════════════════════════════════════════════════
// 5.  Message Router
// ══════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case "CONTENT_SCRIPT_READY":
      // Content script injected — confirm Meet is active
      if (activeMeetTabId !== null) {
        lastChunkSentIndex = 0;
        console.log("[MeetSense] Content script ready. Chunk pointer reset.");
      }
      break;

    case "NEW_CAPTION":
      if (isMeetActive)
        broadcastToPanel({ type: "CAPTION_DISPLAY", payload: msg.payload });
      break;

    case "CAPTIONS_MISSING":
      if (isMeetActive)
        broadcastToPanel({ type: "CAPTIONS_MISSING" });
      break;

    case "TRIGGER_SUMMARY":
      sendSummaryRequest();
      break;

    case "CLEAR_SESSION":
      chrome.storage.local.set({ transcriptLog: [] });
      lastChunkSentIndex = 0;
      broadcastToPanel({ type: "SESSION_CLEARED" });
      break;

    case "GET_MEET_STATUS":
      // Let side panel query current state on open
      broadcastToPanel({ type: "MEET_STATUS", active: isMeetActive });
      broadcastToPanel({
        type: "WS_STATUS",
        status: socket?.readyState === WebSocket.OPEN ? "connected" : "disconnected"
      });
      break;
  }
});

// ══════════════════════════════════════════════════════════
// 6.  Alarms — 12s chunk + 24s keepalive
// ══════════════════════════════════════════════════════════

chrome.alarms.create("chunkProcessor", { periodInMinutes: 1.0 }); // 1 minute
chrome.alarms.create("keepAlive",      { periodInMinutes: 0.4 }); // 24 seconds

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "chunkProcessor") {
    sendChunkToBackend(); // guard is inside — no-op if Meet not active
  }

  if (alarm.name === "keepAlive") {
    if (isMeetActive && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "PING" }));
    }
    // Re-check if a Meet tab exists (catches edge cases after browser restart)
    if (!isMeetActive) checkForMeetTab();
  }
});

// ══════════════════════════════════════════════════════════
// 7.  Extension icon click → open side panel
// ══════════════════════════════════════════════════════════

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
  // Also send current state immediately so panel shows correct status
  setTimeout(() => {
    broadcastToPanel({ type: "MEET_STATUS", active: isMeetActive });
    broadcastToPanel({
      type: "WS_STATUS",
      status: socket?.readyState === WebSocket.OPEN ? "connected" : "disconnected"
    });
  }, 300);
});

// ══════════════════════════════════════════════════════════
// 8.  Helper
// ══════════════════════════════════════════════════════════

function broadcastToPanel(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

// ── Boot: scan for existing Meet tabs on service worker start ──
checkForMeetTab();
