// ============================================================
// background.js — Service Worker
//
// Manages:
//   1. WebSocket connection to backend
//   2. 12-second scheduled chunk → backend (TRACK B)
//   3. Manual summary trigger routing (TRACK C)
//   4. Reconnection with exponential backoff
//   5. Keep-alive alarm to prevent MV3 service worker sleep
// ============================================================

const WS_URL = "ws://localhost:3001"; // change to wss://your-backend.onrender.com in production

let socket       = null;
let reconnectDelay = 1000; // start at 1s, caps at 30s
let lastChunkSentIndex = 0; // tracks how many chunks have been sent to avoid resending

// ── 1. WebSocket Connection Manager ──
function connectWebSocket() {
  if (socket && socket.readyState === WebSocket.OPEN) return;

  console.log("[MeetSense] Connecting to backend...");
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    console.log("[MeetSense] WebSocket connected.");
    reconnectDelay = 1000;
    broadcastToPanel({ type: "WS_STATUS", status: "connected" });
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      // Route response type to side panel
      if (data.type === "INSIGHTS_UPDATE") {
        broadcastToPanel({ type: "INSIGHTS_UPDATE", payload: data.payload });
      } else if (data.type === "SUMMARY_RESULT") {
        broadcastToPanel({ type: "SUMMARY_RESULT", payload: data.payload });
      }
    } catch (e) {
      console.warn("[MeetSense] Could not parse WS message:", e);
    }
  };

  socket.onclose = () => {
    console.warn("[MeetSense] WebSocket closed. Reconnecting in", reconnectDelay, "ms");
    broadcastToPanel({ type: "WS_STATUS", status: "disconnected" });
    setTimeout(connectWebSocket, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  };

  socket.onerror = (err) => {
    console.error("[MeetSense] WebSocket error:", err);
  };
}

// ── 2. Send message to side panel ──
function broadcastToPanel(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {
    // Side panel might not be open — ignore
  });
}

// ── 3. TRACK B — 12-second scheduled chunk processor ──
// Reads NEW chunks from storage since last send, ships to backend
async function sendChunkToBackend() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.warn("[MeetSense] WS not open — skipping chunk send.");
    return;
  }

  const result = await chrome.storage.local.get(["transcriptLog"]);
  const log = result.transcriptLog || [];

  // Only send chunks we haven't sent yet
  const newChunks = log.slice(lastChunkSentIndex);

  if (newChunks.length === 0) {
    console.log("[MeetSense] No new chunks to process.");
    return;
  }

  // Build text from new chunks only
  const contextText = newChunks.map(c => c.text).join(" ");

  // Guard: skip if essentially silence (< 20 chars)
  if (contextText.trim().length < 20) {
    return;
  }

  lastChunkSentIndex = log.length; // advance pointer

  console.log(`[MeetSense] Sending ${newChunks.length} new chunks to backend.`);

  socket.send(JSON.stringify({
    type: "PROCESS_CHUNK",
    text: contextText,
    chunkCount: newChunks.length,
    timestamp: Date.now()
  }));

  broadcastToPanel({ type: "PROCESSING_INDICATOR", active: true });
}

// ── 4. TRACK C — Manual Summary Trigger ──
async function sendSummaryRequest() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    broadcastToPanel({ type: "SUMMARY_ERROR", message: "Not connected to backend." });
    return;
  }

  const result = await chrome.storage.local.get(["transcriptLog"]);
  const log = result.transcriptLog || [];

  if (log.length === 0) {
    broadcastToPanel({ type: "SUMMARY_ERROR", message: "No transcript to summarize yet." });
    return;
  }

  // Send FULL transcript for summary (not just recent chunks)
  const fullTranscript = log.map(c => c.text).join(" ");

  console.log(`[MeetSense] Sending full transcript (${log.length} chunks) for summary.`);
  broadcastToPanel({ type: "SUMMARY_LOADING", active: true });

  socket.send(JSON.stringify({
    type: "GENERATE_SUMMARY",
    fullTranscript,
    timestamp: Date.now()
  }));
}

// ── 5. Message Router from content script / side panel ──
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case "CONTENT_SCRIPT_READY":
      console.log("[MeetSense] Content script connected. Resetting chunk pointer.");
      lastChunkSentIndex = 0;
      break;

    case "NEW_CAPTION":
      // Forward live caption to side panel for transcript display
      broadcastToPanel({ type: "CAPTION_DISPLAY", payload: msg.payload });
      break;

    case "CAPTIONS_MISSING":
      broadcastToPanel({ type: "CAPTIONS_MISSING" });
      break;

    case "TRIGGER_SUMMARY":
      // User clicked "Generate Summary" button in side panel
      sendSummaryRequest();
      break;

    case "CLEAR_SESSION":
      chrome.storage.local.set({ transcriptLog: [] });
      lastChunkSentIndex = 0;
      broadcastToPanel({ type: "SESSION_CLEARED" });
      break;
  }
});

// ── 6. chrome.alarms — 12-second chunk trigger + Keep-alive ──
// alarms API keeps the service worker alive (survives MV3 sleep)
chrome.alarms.create("chunkProcessor", { periodInMinutes: 0.2 }); // 0.2 min = 12 seconds
chrome.alarms.create("keepAlive",      { periodInMinutes: 0.4 }); // 24 second heartbeat

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "chunkProcessor") {
    sendChunkToBackend();
  }
  if (alarm.name === "keepAlive") {
    // Keep-alive: send WS ping to prevent server-side timeout
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "PING" }));
    }
    // Also attempt reconnect if disconnected
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      connectWebSocket();
    }
  }
});

// ── 7. Open side panel when user clicks extension icon ──
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// ── Initialize ──
connectWebSocket();
