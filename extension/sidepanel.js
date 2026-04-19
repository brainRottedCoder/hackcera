// ============================================================
// sidepanel.js — UI Logic
//
// Listens to messages from background.js and updates DOM.
// Handles: Live transcript, AI insights, manual summary button.
// ============================================================

// ── State ──
let allTasks     = [];  // deduplicated accumulated task list
let lastSummary  = null; // last generated summary for export
let transcriptCount = 0;

// ── DOM refs ──
const transcriptFeed   = document.getElementById("transcript-feed");
const transcriptCount_ = document.getElementById("transcript-count");
const taskTbody        = document.getElementById("task-tbody");
const decisionsList    = document.getElementById("decisions-list");
const risksList        = document.getElementById("risks-list");
const processingDot    = document.getElementById("processing-dot");
const captionsBanner   = document.getElementById("captions-banner");
const wsBadge          = document.getElementById("ws-indicator");
const wsLabel          = document.getElementById("ws-label");
const btnSummary       = document.getElementById("btn-summary");
const btnSummaryLabel  = document.getElementById("btn-summary-label");
const summaryOutput    = document.getElementById("summary-output");
const summaryError     = document.getElementById("summary-error");
const btnCopy          = document.getElementById("btn-copy");
const btnClear         = document.getElementById("btn-clear");

// ──────────────────────────────────────────
// 1. Message listener from background.js
// ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {

    case "CAPTION_DISPLAY":
      appendTranscript(msg.payload.text);
      break;

    case "INSIGHTS_UPDATE":
      processingDot.classList.add("hidden");
      updateInsights(msg.payload);
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
      showSummaryError(msg.message);
      break;

    case "CAPTIONS_MISSING":
      captionsBanner.classList.remove("hidden");
      break;

    case "WS_STATUS":
      updateWSBadge(msg.status);
      break;

    case "SESSION_CLEARED":
      resetUI();
      break;
  }
});

// ──────────────────────────────────────────
// 2. Live Transcript
// ──────────────────────────────────────────
function appendTranscript(text) {
  // Remove empty state placeholder
  const empty = transcriptFeed.querySelector(".empty-state");
  if (empty) empty.remove();

  transcriptCount++;
  transcriptCount_.textContent = `${transcriptCount} lines`;

  const line = document.createElement("p");
  line.className = "transcript-line";
  line.textContent = text;

  transcriptFeed.appendChild(line);

  // Auto-scroll to bottom
  transcriptFeed.scrollTop = transcriptFeed.scrollHeight;

  // Cap displayed lines to 100 to keep DOM light (storage has full log)
  const lines = transcriptFeed.querySelectorAll(".transcript-line");
  if (lines.length > 100) lines[0].remove();
}

// ──────────────────────────────────────────
// 3. AI Insights Update (every 12s from backend)
// ──────────────────────────────────────────
function updateInsights({ tasks, decisions, risks }) {
  if (tasks?.length)     updateTasks(tasks);
  if (decisions?.length) updateList(decisionsList, decisions, "decision-item");
  if (risks?.length)     updateList(risksList, risks, "risk-item");
}

function updateTasks(newTasks) {
  newTasks.forEach(newTask => {
    const existing = allTasks.findIndex(t => t.task === newTask.task);
    if (existing === -1) {
      allTasks.push({ ...newTask, status: "Pending" });
      addTaskRow(newTask);
    } else {
      // Update existing row in place (no re-render flicker)
      allTasks[existing] = { ...allTasks[existing], ...newTask };
      const row = taskTbody.querySelector(`[data-task="${CSS.escape(newTask.task)}"]`);
      if (row) {
        row.querySelector(".cell-owner").textContent    = newTask.owner    || "Unassigned";
        row.querySelector(".cell-deadline").textContent = newTask.deadline || "TBD";
      }
    }
  });

  // Remove empty-row placeholder if tasks exist
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
      <select class="status-select" onchange="cycleStatus(this)">
        <option value="Pending"     ${task.status === "Pending"     ? "selected" : ""}>🔵 Pending</option>
        <option value="In Progress" ${task.status === "In Progress" ? "selected" : ""}>🟡 In Progress</option>
        <option value="Done"        ${task.status === "Done"        ? "selected" : ""}>🟢 Done</option>
      </select>
    </td>`;
  taskTbody.appendChild(tr);

  // Flash animation for new row
  tr.classList.add("row-flash");
  setTimeout(() => tr.classList.remove("row-flash"), 800);
}

function updateList(el, items, className) {
  const empty = el.querySelector(".empty-state");
  if (empty) empty.remove();

  items.forEach(item => {
    // Avoid duplicates
    const existing = [...el.querySelectorAll("li")].find(
      li => li.dataset.key === item
    );
    if (existing) return;

    const li = document.createElement("li");
    li.className = className;
    li.dataset.key = item;
    li.textContent = item;
    el.appendChild(li);
  });
}

// Status dropdown handler (inline)
window.cycleStatus = function(select) {
  const taskText = select.closest("tr").dataset.task;
  const task = allTasks.find(t => t.task === taskText);
  if (task) task.status = select.value;
};

// ──────────────────────────────────────────
// 4. Tab Switching
// ──────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));

    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove("hidden");
  });
});

// ──────────────────────────────────────────
// 5. Manual Summary Button — TRACK C
// ──────────────────────────────────────────
btnSummary.addEventListener("click", () => {
  summaryError.classList.add("hidden");
  chrome.runtime.sendMessage({ type: "TRIGGER_SUMMARY" });
});

function setSummaryLoading(loading) {
  btnSummary.disabled = loading;
  btnSummaryLabel.textContent = loading ? "Generating…" : "Generate Summary";
  document.getElementById("btn-summary-icon").textContent = loading ? "⏳" : "✨";
}

function renderSummary({ summary, tasks, decisions, risks }) {
  lastSummary = { summary, tasks, decisions, risks };

  document.getElementById("summary-text").textContent = summary || "No summary available.";

  renderSummaryList("summary-tasks",     tasks,     t => `${t.task} → ${t.owner || "?"} by ${t.deadline || "TBD"}`);
  renderSummaryList("summary-decisions", decisions, d => d);
  renderSummaryList("summary-risks",     risks,     r => r);

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
  items.forEach(item => {
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
// 6. Export + Clear
// ──────────────────────────────────────────
btnCopy.addEventListener("click", () => {
  if (!lastSummary) return;
  const json = JSON.stringify(lastSummary, null, 2);
  navigator.clipboard.writeText(json).then(() => {
    btnCopy.textContent = "✅ Copied!";
    setTimeout(() => (btnCopy.textContent = "📋 Copy JSON"), 2000);
  });
});

btnClear.addEventListener("click", () => {
  if (confirm("Clear all transcript and session data?")) {
    chrome.runtime.sendMessage({ type: "CLEAR_SESSION" });
  }
});

// ──────────────────────────────────────────
// 7. WebSocket Status Badge
// ──────────────────────────────────────────
function updateWSBadge(status) {
  wsBadge.className = `ws-badge ${status}`;
  wsLabel.textContent = status === "connected" ? "Live" : "Reconnecting…";
}

// ──────────────────────────────────────────
// 8. Helpers
// ──────────────────────────────────────────
function sanitize(str) {
  const div = document.createElement("div");
  div.textContent = str; // uses textContent → XSS safe
  return div.innerHTML;
}

function resetUI() {
  allTasks = [];
  lastSummary = null;
  transcriptCount = 0;
  transcriptFeed.innerHTML = `<p class="empty-state">Waiting for captions…</p>`;
  taskTbody.innerHTML = `<tr class="empty-row"><td colspan="4">No tasks extracted yet.</td></tr>`;
  decisionsList.innerHTML = `<li class="empty-state">No decisions captured yet.</li>`;
  risksList.innerHTML = `<li class="empty-state">No risks flagged yet.</li>`;
  summaryOutput.classList.add("hidden");
  transcriptCount_.textContent = "0 lines";
}
