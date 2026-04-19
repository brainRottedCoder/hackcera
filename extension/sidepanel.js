// ============================================================
// sidepanel.js — UI Logic (v2 — Auto-Transcription)
//
// Handles: Live transcription (interim + final),
// AI insights, manual summary, tab capture status.
// ============================================================

let allTasks = [];
let lastSummary = null;
let transcriptCount = 0;
let meetActive = false;
let currentInterimEl = null;

const transcriptFeed = document.getElementById("transcript-feed");
const transcriptCount_ = document.getElementById("transcript-count");
const taskTbody = document.getElementById("task-tbody");
const decisionsList = document.getElementById("decisions-list");
const risksList = document.getElementById("risks-list");
const processingDot = document.getElementById("processing-dot");
const wsBadge = document.getElementById("ws-indicator");
const wsLabel = document.getElementById("ws-label");
const btnSummary = document.getElementById("btn-summary");
const btnSummaryLabel = document.getElementById("btn-summary-label");
const summaryOutput = document.getElementById("summary-output");
const summaryError = document.getElementById("summary-error");
const btnCopy = document.getElementById("btn-copy");
const btnCopyMd = document.getElementById("btn-copy-md");
const btnSaveMeeting = document.getElementById("btn-save-meeting");
const btnClear = document.getElementById("btn-clear");
const btnHistory = document.getElementById("btn-history");
const speechBanner = document.getElementById("speech-banner");
const speechBannerIcon = document.getElementById("speech-banner-icon");
const speechBannerText = document.getElementById("speech-banner-text");
const tabcaptureBanner = document.getElementById("tabcapture-banner");
const tabcaptureBannerText = document.getElementById("tabcapture-banner-text");
const micDeniedBanner = document.getElementById("mic-denied-banner");
const speechApiBanner = document.getElementById("speech-api-banner");

// ──────────────────────────────────────────
// 1. Message listener from background.js
// ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case "MEET_STATUS":
      updateMeetStatus(msg.active);
      break;

    case "TRANSCRIPTION_DISPLAY":
      if (meetActive) appendTranscription(msg.payload);
      break;

    case "TRANSCRIPTION_RESULT":
      if (msg.payload?.text) appendTranscription(msg.payload);
      break;

    case "SPEECH_STATUS":
      updateSpeechBanner(msg.status, msg.error);
      break;

    case "SPEECH_API_NOT_SUPPORTED":
      speechApiBanner.classList.remove("hidden");
      speechBanner.classList.add("hidden");
      break;

    case "TAB_CAPTURE_STATUS":
      updateTabCaptureBanner(msg.active, msg.error);
      break;

    case "INSIGHTS_UPDATE":
      processingDot.classList.add("hidden");
      updateInsights(msg.payload);
      break;

    case "INSIGHTS_ERROR":
      processingDot.classList.add("hidden");
      showInsightsError(msg.message || "AI processing failed.");
      break;

    case "PROCESSING_INDICATOR":
      processingDot.classList.toggle("hidden", !msg.active);
      break;

    case "SUMMARY_LOADING":
      setSummaryLoading(true);
      break;

    case "SUMMARY_RESULT":
      setSummaryLoading(false);
      renderSummary(msg.payload);
      break;

    case "SUMMARY_ERROR":
      setSummaryLoading(false);
      showSummaryError(msg.message || "Unknown error occurred.");
      break;

    case "WS_STATUS":
      updateWSBadge(msg.status);
      break;

    case "SESSION_CLEARED":
      resetUI();
      break;

    case "MEETING_SAVED":
      showSaveToast();
      break;
  }
});

chrome.runtime.sendMessage({ type: "GET_MEET_STATUS" });

// ──────────────────────────────────────────
// 2. Live Transcription Display
// ──────────────────────────────────────────
function appendTranscription(payload) {
  const { text, isFinal } = payload;
  if (!text) return;

  const empty = transcriptFeed.querySelector(".empty-state");
  if (empty) empty.remove();

  if (isFinal) {
    // Finalize any pending interim line
    if (currentInterimEl) {
      currentInterimEl.remove();
      currentInterimEl = null;
    }

    transcriptCount++;
    transcriptCount_.textContent = `${transcriptCount} lines`;

    const line = document.createElement("p");
    line.className = "transcript-line final";
    line.textContent = text;
    transcriptFeed.appendChild(line);

    const lines = transcriptFeed.querySelectorAll(".transcript-line");
    if (lines.length > 150) lines[0].remove();
  } else {
    // Interim — show live preview
    if (!currentInterimEl) {
      currentInterimEl = document.createElement("p");
      currentInterimEl.className = "transcript-line interim";
      transcriptFeed.appendChild(currentInterimEl);
    }
    currentInterimEl.textContent = text;
  }

  transcriptFeed.scrollTop = transcriptFeed.scrollHeight;
}

// ──────────────────────────────────────────
// 3. Speech Status Banner
// ──────────────────────────────────────────
function updateSpeechBanner(status, error) {
  speechBanner.classList.remove("listening", "error", "inactive");

  switch (status) {
    case "listening":
      speechBannerIcon.textContent = "🎤";
      speechBannerText.textContent = "Listening for speech…";
      speechBanner.classList.add("listening");
      micDeniedBanner.classList.add("hidden");
      break;

    case "mic-denied":
      speechBannerIcon.textContent = "🚫";
      speechBannerText.textContent = "Microphone access denied";
      speechBanner.classList.add("error");
      micDeniedBanner.classList.remove("hidden");
      break;

    case "error":
      speechBannerIcon.textContent = "⚠️";
      speechBannerText.textContent = error || "Transcription error";
      speechBanner.classList.add("error");
      break;

    default:
      break;
  }
}

function updateTabCaptureBanner(active, error) {
  if (active) {
    tabcaptureBanner.classList.remove("hidden");
    tabcaptureBannerText.textContent = "Tab audio captured for STT";
  } else if (error) {
    tabcaptureBanner.classList.remove("hidden");
    tabcaptureBannerText.textContent = `Tab capture: ${error}`;
  } else {
    tabcaptureBanner.classList.add("hidden");
  }
}

// ──────────────────────────────────────────
// 4. AI Insights Update
// ──────────────────────────────────────────
function updateInsights({ tasks, decisions, risks }) {
  if (tasks?.length) updateTasks(tasks);
  if (decisions?.length)
    updateList(decisionsList, decisions, "decision-item");
  if (risks?.length) updateList(risksList, risks, "risk-item");
}

function updateTasks(newTasks) {
  newTasks.forEach((newTask) => {
    const existing = allTasks.findIndex((t) => t.task === newTask.task);
    if (existing === -1) {
      allTasks.push({ ...newTask, status: "Pending" });
      addTaskRow(newTask);
    } else {
      allTasks[existing] = { ...allTasks[existing], ...newTask };
      const row = taskTbody.querySelector(
        `[data-task="${CSS.escape(newTask.task)}"]`
      );
      if (row) {
        row.querySelector(".cell-owner").textContent =
          newTask.owner || "Unassigned";
        row.querySelector(".cell-deadline").textContent =
          newTask.deadline || "TBD";
      }
    }
  });

  const emptyRow = taskTbody.querySelector(".empty-row");
  if (emptyRow && allTasks.length > 0) emptyRow.remove();
}

function addTaskRow(task) {
  const tr = document.createElement("tr");
  tr.dataset.task = task.task;
  tr.innerHTML = `
    <td class="cell-task">${sanitize(task.task)}</td>
    <td class="cell-owner">${sanitize(task.owner || "Unassigned")}</td>
    <td class="cell-deadline">${sanitize(task.deadline || "TBD")}</td>
    <td>
      <select class="status-select" aria-label="Task status for ${sanitize(task.task)}" onchange="cycleStatus(this)">
        <option value="Pending"     ${task.status === "Pending" ? "selected" : ""}>Pending</option>
        <option value="In Progress" ${task.status === "In Progress" ? "selected" : ""}>In Progress</option>
        <option value="Done"        ${task.status === "Done" ? "selected" : ""}>Done</option>
      </select>
    </td>`;
  taskTbody.appendChild(tr);
  tr.classList.add("row-flash");
  setTimeout(() => tr.classList.remove("row-flash"), 800);
}

function updateList(el, items, className) {
  const empty = el.querySelector(".empty-state");
  if (empty) empty.remove();

  items.forEach((item) => {
    const existing = [...el.querySelectorAll("li")].find(
      (li) => li.dataset.key === item
    );
    if (existing) return;

    const li = document.createElement("li");
    li.className = className;
    li.dataset.key = item;
    li.textContent = item;
    el.appendChild(li);
  });
}

window.cycleStatus = function (select) {
  const taskText = select.closest("tr").dataset.task;
  const task = allTasks.find((t) => t.task === taskText);
  if (task) task.status = select.value;
};

// ──────────────────────────────────────────
// 5. Tab Switching (WAI-ARIA compliant)
// ──────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-selected", "false");
    });
    document
      .querySelectorAll(".tab-content")
      .forEach((c) => c.classList.add("hidden"));

    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    document
      .getElementById(`tab-${btn.dataset.tab}`)
      .classList.remove("hidden");
  });
});

// Keyboard navigation for tabs
document.querySelector(".tab-bar").addEventListener("keydown", (e) => {
  const tabs = [...document.querySelectorAll(".tab-btn")];
  const currentIndex = tabs.indexOf(document.activeElement);
  let newIndex;

  switch (e.key) {
    case "ArrowRight":
      newIndex = (currentIndex + 1) % tabs.length;
      break;
    case "ArrowLeft":
      newIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      break;
    case "Home":
      newIndex = 0;
      break;
    case "End":
      newIndex = tabs.length - 1;
      break;
    default:
      return;
  }

  e.preventDefault();
  tabs[newIndex].focus();
  tabs[newIndex].click();
});

// ──────────────────────────────────────────
// 6. Manual Summary Button
// ──────────────────────────────────────────
btnSummary.addEventListener("click", () => {
  summaryError.classList.add("hidden");
  chrome.runtime.sendMessage({ type: "TRIGGER_SUMMARY" });
});

function setSummaryLoading(loading) {
  btnSummary.disabled = loading;
  btnSummaryLabel.textContent = loading ? "Generating…" : "Generate Summary";
  document.getElementById("btn-summary-icon").textContent = loading
    ? "⏳"
    : "✨";
}

function renderSummary({ summary, tasks, decisions, risks }) {
  lastSummary = { summary, tasks, decisions, risks };

  document.getElementById("summary-text").textContent =
    summary || "No summary available.";

  renderSummaryList(
    "summary-tasks",
    tasks,
    (t) => `${t.task} → ${t.owner || "?"} by ${t.deadline || "TBD"}`
  );
  renderSummaryList("summary-decisions", decisions, (d) => d);
  renderSummaryList("summary-risks", risks, (r) => r);

  summaryOutput.classList.remove("hidden");
  summaryOutput.scrollIntoView({ behavior: "smooth" });
}

function renderSummaryList(elId, items, formatter) {
  const el = document.getElementById(elId);
  el.innerHTML = "";
  if (!items?.length) {
    el.innerHTML = "<li class='empty-state'>None recorded.</li>";
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = formatter(item);
    el.appendChild(li);
  });
}

function showSummaryError(message) {
  summaryError.textContent = `⚠️ ${message}`;
  summaryError.classList.remove("hidden");
}

// ──────────────────────────────────────────
// 7. Export + Clear
// ──────────────────────────────────────────
btnCopy.addEventListener("click", () => {
  if (!lastSummary) return;
  const json = JSON.stringify(lastSummary, null, 2);
  navigator.clipboard.writeText(json).then(() => {
    btnCopy.textContent = "✅ Copied!";
    setTimeout(() => (btnCopy.textContent = "📋 Copy JSON"), 2000);
  });
});

btnCopyMd.addEventListener("click", () => {
  if (!lastSummary) return;
  const md = summaryToMarkdown(lastSummary);
  navigator.clipboard.writeText(md).then(() => {
    btnCopyMd.textContent = "✅ Copied!";
    setTimeout(() => (btnCopyMd.textContent = "📝 Copy Markdown"), 2000);
  });
});

function summaryToMarkdown(data) {
  let md = `# Meeting Summary\n\n`;
  md += `${data.summary || ""}\n\n`;
  if (data.tasks?.length) {
    md += `## Tasks\n`;
    data.tasks.forEach(
      (t) =>
        (md += `- [ ] **${t.task}** — ${t.owner || "Unassigned"} — ${t.deadline || "TBD"}\n`)
    );
    md += "\n";
  }
  if (data.decisions?.length) {
    md += `## Decisions\n`;
    data.decisions.forEach((d) => (md += `- ${d}\n"));
    md += "\n";
  }
  if (data.risks?.length) {
    md += `## Risks\n`;
    data.risks.forEach((r) => (md += `- ${r}\n`));
  }
  return md;
}

btnClear.addEventListener("click", () => {
  if (confirm("Clear all transcription and session data?")) {
    chrome.runtime.sendMessage({ type: "CLEAR_SESSION" });
  }
});

// ──────────────────────────────────────────
// 7b. Save Meeting + History Navigation
// ──────────────────────────────────────────
btnSaveMeeting.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "SAVE_MEETING" });
});

function showSaveToast() {
  let toast = document.getElementById("save-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "save-toast";
    toast.className = "save-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.textContent = "✅ Meeting saved to history!";
    document.body.appendChild(toast);
  }
  toast.classList.remove("hidden");
  toast.classList.add("show");
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.classList.add("hidden"), 300);
  }, 2500);
}

btnHistory.addEventListener("click", () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("history.html"),
  });
});

// ──────────────────────────────────────────
// 8. Meet Active / Inactive Status
// ──────────────────────────────────────────
function updateMeetStatus(active) {
  meetActive = active;

  let overlay = document.getElementById("meet-inactive-overlay");

  if (!active) {
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "meet-inactive-overlay";
      overlay.className = "meet-inactive-overlay";
      overlay.innerHTML = `
        <div class="meet-inactive-card">
          <div class="meet-inactive-icon">🎥</div>
          <h3>No Active Meet Session</h3>
          <p>Open <strong>Google Meet</strong> in this Chrome window and join a call to activate MeetSense AI.</p>
          <a href="https://meet.google.com/new" target="_blank" class="btn-primary" style="text-decoration:none;display:inline-block;margin-top:12px">
            ✨ Start a Meet
          </a>
        </div>`;
      document.body.appendChild(overlay);
    }
    overlay.classList.remove("hidden");
    btnSummary.disabled = true;
    updateWSBadge("disconnected");
  } else {
    if (overlay) overlay.classList.add("hidden");
    btnSummary.disabled = false;
  }
}

let insightsErrorTimer = null;

function showInsightsError(message) {
  let banner = document.getElementById("insights-error-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "insights-error-banner";
    banner.className = "error-banner";
    banner.setAttribute("role", "alert");
    const section = document.querySelector(
      '[aria-labelledby="insights-title"]'
    );
    if (section) section.insertBefore(banner, section.firstChild.nextSibling);
  }
  banner.textContent = `⚠️ ${message}`;
  banner.classList.remove("hidden");
  clearTimeout(insightsErrorTimer);
  insightsErrorTimer = setTimeout(
    () => banner.classList.add("hidden"),
    10000
  );
}

// ──────────────────────────────────────────
// 9. WebSocket Status Badge
// ──────────────────────────────────────────
function updateWSBadge(status) {
  wsBadge.className = `ws-badge ${status}`;
  wsLabel.textContent = status === "connected" ? "Live" : "Reconnecting…";
}

// ──────────────────────────────────────────
// 10. Helpers
// ──────────────────────────────────────────
function sanitize(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function resetUI() {
  allTasks = [];
  lastSummary = null;
  transcriptCount = 0;
  currentInterimEl = null;
  transcriptFeed.innerHTML = `<p class="empty-state">Waiting for speech…</p>`;
  taskTbody.innerHTML = `<tr class="empty-row"><td colspan="4">No tasks extracted yet.</td></tr>`;
  decisionsList.innerHTML = `<li class="empty-state">No decisions captured yet.</li>`;
  risksList.innerHTML = `<li class="empty-state">No risks flagged yet.</li>`;
  summaryOutput.classList.add("hidden");
  transcriptCount_.textContent = "0 lines";
}
