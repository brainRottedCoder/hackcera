// ============================================================
// background.js — Service Worker (v3 — Auto-Transcription + History)
//
// Manages two transcription sources:
//   TRACK A: Web Speech API transcription from contentScript
//   TRACK B: Tab-captured audio chunks from offscreen doc
//            → sent to backend for Whisper STT
//
// Auto-saves meeting data to chrome.storage.local on session
// end so users can browse past meetings in the History page.
// ============================================================

const MEET_PATTERN = "https://meet.google.com/*";
const MEET_ORIGIN = "meet.google.com";
const MAX_HISTORY = 50;

let socket = null;
let reconnectDelay = 1000;
let reconnectTimer = null;
let isMeetActive = false;
let activeMeetTabId = null;
let lastChunkSentIndex = 0;
let offscreenDocActive = false;
let tabCaptureActive = false;
let sessionStartTime = null;
let sessionInsights = { tasks: [], decisions: [], risks: [] };
let sessionSummary = null;

// ── Pause-driven chunking debounce ──
// Prevents hammering the backend when the speaker produces
// multiple rapid isFinal events in quick succession.
let chunkDebounceTimer = null;
const CHUNK_DEBOUNCE_MS = 800;

// ══════════════════════════════════════════════════════════
// 1.  Meet Tab Detection
// ══════════════════════════════════════════════════════════

async function checkForMeetTab() {
  const tabs = await chrome.tabs.query({ url: MEET_PATTERN });
  if (tabs.length > 0) {
    onMeetOpened(tabs[0].id);
  } else {
    onMeetClosed();
  }
}

function onMeetOpened(tabId) {
  if (isMeetActive && tabId === activeMeetTabId) return;
  console.log(`[MeetSense] ✅ Meet tab detected (tab ${tabId}). Activating.`);
  isMeetActive = true;
  activeMeetTabId = tabId;
  lastChunkSentIndex = 0;
  sessionStartTime = Date.now();
  sessionInsights = { tasks: [], decisions: [], risks: [] };
  sessionSummary = null;
  connectWebSocket();
  startTabCapture(tabId);
  broadcastToPanel({ type: "MEET_STATUS", active: true });
}

async function onMeetClosed() {
  if (!isMeetActive) return;
  console.log("[MeetSense] ❌ Meet tab gone. Stopping all processing.");

  // Auto-save the meeting before tearing down
  await saveMeetingToHistory();

  isMeetActive = false;
  activeMeetTabId = null;
  sessionStartTime = null;
  sessionInsights = { tasks: [], decisions: [], risks: [] };
  sessionSummary = null;
  stopTabCapture();
  disconnectWebSocket();
  broadcastToPanel({ type: "MEET_STATUS", active: false });
  broadcastToPanel({ type: "MEETING_SAVED" });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  const url = tab.url || "";
  if (url.includes(MEET_ORIGIN) && url.includes("/")) {
    onMeetOpened(tabId);
  } else if (tabId === activeMeetTabId) {
    onMeetClosed();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeMeetTabId) onMeetClosed();
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  const url = tab.url || tab.pendingUrl || "";
  if (url.includes(MEET_ORIGIN)) onMeetOpened(tabId);
});

// ══════════════════════════════════════════════════════════
// 2.  Meeting History Storage
//     Saves transcript, insights, and summary to
//     chrome.storage.local when a meeting ends.
// ══════════════════════════════════════════════════════════

async function saveMeetingToHistory() {
  const result = await chrome.storage.local.get(["transcriptLog"]);
  const transcriptLog = result.transcriptLog || [];

  const finalTranscript = transcriptLog.filter((c) => c.isFinal);

  // Don't save empty meetings
  if (finalTranscript.length === 0 && sessionInsights.tasks.length === 0) {
    console.log("[MeetSense] Skipping save — no transcript or insights.");
    return;
  }

  const meetingId = `meeting_${sessionStartTime || Date.now()}`;
  const endTime = Date.now();
  const durationMs = sessionStartTime ? endTime - sessionStartTime : 0;

  const meeting = {
    id: meetingId,
    startTime: sessionStartTime || endTime,
    endTime,
    durationMs,
    transcript: finalTranscript,
    transcriptText: finalTranscript.map((c) => c.text).join(" "),
    tasks: sessionInsights.tasks,
    decisions: sessionInsights.decisions,
    risks: sessionInsights.risks,
    summary: sessionSummary,
  };

  const historyResult = await chrome.storage.local.get(["meetingHistory"]);
  const history = historyResult.meetingHistory || [];

  // Check if we already saved this meeting (dedup by id)
  const existingIdx = history.findIndex((m) => m.id === meetingId);
  if (existingIdx !== -1) {
    history[existingIdx] = meeting;
  } else {
    history.unshift(meeting);
  }

  // Cap at MAX_HISTORY
  if (history.length > MAX_HISTORY) {
    history.splice(MAX_HISTORY);
  }

  await chrome.storage.local.set({ meetingHistory: history });
  console.log(`[MeetSense] Meeting saved to history: ${meetingId} (${finalTranscript.length} lines, ${sessionInsights.tasks.length} tasks)`);

  // Clear the current session transcript log
  await chrome.storage.local.set({ transcriptLog: [] });
  lastChunkSentIndex = 0;
}

async function deleteMeetingFromHistory(meetingId) {
  const result = await chrome.storage.local.get(["meetingHistory"]);
  const history = result.meetingHistory || [];
  const filtered = history.filter((m) => m.id !== meetingId);
  await chrome.storage.local.set({ meetingHistory: filtered });
  console.log(`[MeetSense] Deleted meeting: ${meetingId}`);
}

async function clearAllHistory() {
  await chrome.storage.local.set({ meetingHistory: [] });
  console.log("[MeetSense] All meeting history cleared.");
}

// ══════════════════════════════════════════════════════════
// 3.  Tab Audio Capture (TRACK B)
// ══════════════════════════════════════════════════════════

async function startTabCapture(tabId) {
  try {
    await ensureOffscreenDocument();

    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId,
    });

    chrome.runtime.sendMessage({
      type: "START_TAB_CAPTURE",
      streamId,
    });

    tabCaptureActive = true;
    console.log("[MeetSense] Tab capture initiated for tab", tabId);
  } catch (err) {
    console.warn("[MeetSense] Tab capture failed:", err.message);
    tabCaptureActive = false;
    broadcastToPanel({
      type: "TAB_CAPTURE_STATUS",
      active: false,
      error: err.message,
    });
  }
}

function stopTabCapture() {
  if (!tabCaptureActive) return;
  chrome.runtime.sendMessage({ type: "STOP_TAB_CAPTURE" }).catch(() => {});
  tabCaptureActive = false;
  console.log("[MeetSense] Tab capture stopped.");
}

async function ensureOffscreenDocument() {
  if (offscreenDocActive) return;

  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL("offscreen.html")],
  });

  if (existingContexts.length > 0) {
    offscreenDocActive = true;
    return;
  }

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["MEDIA_RECORDER"],
    justification:
      "Recording meeting audio from the active Google Meet tab for speech-to-text transcription.",
  });

  offscreenDocActive = true;
  console.log("[MeetSense] Offscreen document created.");
}

// ══════════════════════════════════════════════════════════
// 4.  WebSocket Manager
// ══════════════════════════════════════════════════════════

async function connectWebSocket() {
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING)
  )
    return;

  clearTimeout(reconnectTimer);
  console.log("[MeetSense] Connecting WebSocket…");

  // Dynamic URL: reads from config.js (storage → deployment URL → localhost)
  const wsUrl = await getBackendUrl();
  console.log("[MeetSense] Backend URL:", wsUrl);
  socket = new WebSocket(wsUrl);

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
          // Accumulate insights for the session
          mergeSessionInsights(data.payload);
          broadcastToPanel({
            type: "INSIGHTS_UPDATE",
            payload: data.payload,
          });
          break;
        case "INSIGHTS_ERROR":
          broadcastToPanel({
            type: "INSIGHTS_ERROR",
            message: data.message || "AI processing failed.",
          });
          break;
        case "TRANSCRIPTION_RESULT":
          broadcastToPanel({
            type: "TRANSCRIPTION_RESULT",
            payload: data.payload,
          });
          break;
        case "SUMMARY_RESULT":
          // Save the summary for session persistence
          sessionSummary = data.payload;
          broadcastToPanel({
            type: "SUMMARY_RESULT",
            payload: data.payload,
          });
          break;
        case "SUMMARY_ERROR":
          broadcastToPanel({
            type: "SUMMARY_ERROR",
            message: data.message || "Summary generation failed.",
          });
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
      reconnectTimer = setTimeout(() => connectWebSocket(), currentDelay);
    }
  };

  socket.onerror = () => {};
}

function disconnectWebSocket() {
  clearTimeout(reconnectTimer);
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
  broadcastToPanel({ type: "WS_STATUS", status: "disconnected" });
}

function mergeSessionInsights(payload) {
  if (!payload) return;
  const { tasks, decisions, risks } = payload;

  if (tasks?.length) {
    tasks.forEach((t) => {
      if (!sessionInsights.tasks.find((x) => x.task === t.task)) {
        sessionInsights.tasks.push(t);
      }
    });
  }
  if (decisions?.length) {
    decisions.forEach((d) => {
      if (!sessionInsights.decisions.includes(d)) {
        sessionInsights.decisions.push(d);
      }
    });
  }
  if (risks?.length) {
    risks.forEach((r) => {
      if (!sessionInsights.risks.includes(r)) {
        sessionInsights.risks.push(r);
      }
    });
  }
}

// ══════════════════════════════════════════════════════════
// 5.  TRACK A — Speech API Transcription Chunk Sender
// ══════════════════════════════════════════════════════════

async function sendTranscriptionToBackend() {
  if (!isMeetActive) return;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;

  const result = await chrome.storage.local.get(["transcriptLog"]);
  const log = result.transcriptLog || [];
  const newChunks = log.slice(lastChunkSentIndex).filter((c) => c.isFinal);

  if (newChunks.length === 0) return;

  const contextText = newChunks.map((c) => c.text).join(" ");
  if (contextText.trim().length < 20) return;

  lastChunkSentIndex = log.length;

  console.log(
    `[MeetSense] Sending ${newChunks.length} transcription chunks to backend.`
  );
  socket.send(
    JSON.stringify({
      type: "PROCESS_CHUNK",
      text: contextText,
      chunkCount: newChunks.length,
      timestamp: Date.now(),
    })
  );

  broadcastToPanel({ type: "PROCESSING_INDICATOR", active: true });
}

// ══════════════════════════════════════════════════════════
// 6.  TRACK B — Audio Chunk Forwarder
// ══════════════════════════════════════════════════════════

function forwardAudioChunk(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.warn("[MeetSense] Cannot forward audio — WS not open.");
    return;
  }

  socket.send(
    JSON.stringify({
      type: "AUDIO_CHUNK",
      audioBase64: payload.audioBase64,
      mimeType: payload.mimeType,
      timestamp: payload.timestamp,
    })
  );
}

// ══════════════════════════════════════════════════════════
// 7.  Manual Summary
// ══════════════════════════════════════════════════════════

async function sendSummaryRequest() {
  if (!isMeetActive) {
    broadcastToPanel({
      type: "SUMMARY_ERROR",
      message: "No active Meet session.",
    });
    return;
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    broadcastToPanel({
      type: "SUMMARY_ERROR",
      message: "Not connected to backend.",
    });
    return;
  }

  const result = await chrome.storage.local.get(["transcriptLog"]);
  const log = result.transcriptLog || [];

  if (log.length === 0) {
    broadcastToPanel({
      type: "SUMMARY_ERROR",
      message: "No transcript to summarize yet.",
    });
    return;
  }

  const fullTranscript = log
    .filter((c) => c.isFinal)
    .map((c) => c.text)
    .join(" ");
  broadcastToPanel({ type: "SUMMARY_LOADING", active: true });

  socket.send(
    JSON.stringify({
      type: "GENERATE_SUMMARY",
      fullTranscript,
      timestamp: Date.now(),
    })
  );
}

// ══════════════════════════════════════════════════════════
// 8.  Message Router
// ══════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case "CONTENT_SCRIPT_READY":
      if (activeMeetTabId !== null) {
        lastChunkSentIndex = 0;
        console.log("[MeetSense] Content script ready. Chunk pointer reset.");
      }
      break;

    // ── Pause-driven chunking ──
    // Fired by contentScript.js right when a speaker finishes a sentence.
    // Debounced so rapid consecutive isFinal events don't flood the backend.
    case "SEND_CHUNK_NOW":
      if (!isMeetActive) break;
      clearTimeout(chunkDebounceTimer);
      chunkDebounceTimer = setTimeout(() => {
        sendTranscriptionToBackend();
      }, CHUNK_DEBOUNCE_MS);
      break;

    case "NEW_TRANSCRIPTION":
      if (isMeetActive) {
        broadcastToPanel({
          type: "TRANSCRIPTION_DISPLAY",
          payload: msg.payload,
        });
      }
      break;

    case "SPEECH_STATUS":
      broadcastToPanel({
        type: "SPEECH_STATUS",
        status: msg.status,
        error: msg.error,
      });
      break;

    case "SPEECH_API_NOT_SUPPORTED":
      broadcastToPanel({ type: "SPEECH_API_NOT_SUPPORTED" });
      break;

    case "AUDIO_CHUNK":
      forwardAudioChunk(msg.payload);
      break;

    case "TAB_CAPTURE_STARTED":
      console.log("[MeetSense] Tab capture confirmed started.");
      broadcastToPanel({ type: "TAB_CAPTURE_STATUS", active: true });
      break;

    case "TAB_CAPTURE_STOPPED":
      console.log("[MeetSense] Tab capture confirmed stopped.");
      break;

    case "TAB_CAPTURE_ERROR":
      console.error("[MeetSense] Tab capture error:", msg.error);
      broadcastToPanel({
        type: "TAB_CAPTURE_STATUS",
        active: false,
        error: msg.error,
      });
      break;

    case "TRIGGER_SUMMARY":
      sendSummaryRequest();
      break;

    case "SAVE_MEETING":
      saveMeetingToHistory().then(() => {
        broadcastToPanel({ type: "MEETING_SAVED" });
      });
      break;

    case "CLEAR_SESSION":
      chrome.storage.local.set({ transcriptLog: [] });
      lastChunkSentIndex = 0;
      sessionInsights = { tasks: [], decisions: [], risks: [] };
      sessionSummary = null;
      broadcastToPanel({ type: "SESSION_CLEARED" });
      chrome.tabs
        .sendMessage(activeMeetTabId, { type: "CLEAR_TRANSCRIPT" })
        .catch(() => {});
      break;

    case "DELETE_MEETING":
      deleteMeetingFromHistory(msg.meetingId).then(() => {
        broadcastToPanel({ type: "HISTORY_UPDATED" });
      });
      break;

    case "CLEAR_ALL_HISTORY":
      clearAllHistory().then(() => {
        broadcastToPanel({ type: "HISTORY_UPDATED" });
      });
      break;

    case "GET_MEET_STATUS":
      broadcastToPanel({
        type: "MEET_STATUS",
        active: isMeetActive,
      });
      broadcastToPanel({
        type: "WS_STATUS",
        status:
          socket?.readyState === WebSocket.OPEN ? "connected" : "disconnected",
      });
      broadcastToPanel({
        type: "TAB_CAPTURE_STATUS",
        active: tabCaptureActive,
      });
      break;
  }
});

// ══════════════════════════════════════════════════════════
// 9.  Alarms — periodic chunk sender + keepalive
// ══════════════════════════════════════════════════════════

// chunkProcessor alarm is now a FALLBACK only (every 30s).
// Primary triggering is pause-driven via SEND_CHUNK_NOW from contentScript.
chrome.alarms.create("chunkProcessor", { periodInMinutes: 0.5 });
chrome.alarms.create("keepAlive",      { periodInMinutes: 0.4 });

chrome.alarms.onAlarm.addListener((alarm) => {
  // Fallback chunk send — catches long continuous speech without pauses
  if (alarm.name === "chunkProcessor") {
    sendTranscriptionToBackend();
  }

  if (alarm.name === "keepAlive") {
    if (isMeetActive && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "PING" }));
    }
    if (!isMeetActive) checkForMeetTab();
  }
});

// ══════════════════════════════════════════════════════════
// 10. Extension icon click → open side panel
// ══════════════════════════════════════════════════════════

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
  setTimeout(() => {
    broadcastToPanel({ type: "MEET_STATUS", active: isMeetActive });
    broadcastToPanel({
      type: "WS_STATUS",
      status:
        socket?.readyState === WebSocket.OPEN ? "connected" : "disconnected",
    });
    broadcastToPanel({
      type: "TAB_CAPTURE_STATUS",
      active: tabCaptureActive,
    });
  }, 300);
});

// ══════════════════════════════════════════════════════════
// 11. Helper
// ══════════════════════════════════════════════════════════

function broadcastToPanel(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

// ── Boot ──
checkForMeetTab();
