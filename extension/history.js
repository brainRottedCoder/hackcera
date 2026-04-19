// ============================================================
// history.js — Meeting History Page Logic
//
// Loads meeting history from chrome.storage.local, renders
// a searchable list, and provides a detail view for each
// meeting with full transcript, insights, and summary.
// ============================================================

let allMeetings = [];
let currentMeeting = null;

const listView = document.getElementById("list-view");
const detailView = document.getElementById("detail-view");
const emptyState = document.getElementById("empty-state");
const searchInput = document.getElementById("search-input");
const btnBack = document.getElementById("btn-back");
const btnClearAll = document.getElementById("btn-clear-all");
const btnDetailBack = document.getElementById("btn-detail-back");
const btnDeleteMeeting = document.getElementById("btn-delete-meeting");
const btnCopyTranscript = document.getElementById("btn-copy-transcript");
const btnCopyJson = document.getElementById("btn-copy-json");
const btnCopyMd = document.getElementById("btn-copy-md");

// ──────────────────────────────────────────
// 1. Load + Render Meeting List
// ──────────────────────────────────────────

async function loadHistory() {
  const result = await chrome.storage.local.get(["meetingHistory"]);
  allMeetings = result.meetingHistory || [];
  renderList(allMeetings);
}

function renderList(meetings) {
  // Clear existing cards (keep empty state)
  const existing = listView.querySelectorAll(".meeting-card");
  existing.forEach((el) => el.remove());

  if (meetings.length === 0) {
    emptyState.classList.remove("hidden");
    return;
  }

  emptyState.classList.add("hidden");

  meetings.forEach((meeting) => {
    const card = document.createElement("div");
    card.className = "meeting-card";
    card.setAttribute("role", "listitem");
    card.setAttribute("tabindex", "0");
    card.dataset.id = meeting.id;

    const dateStr = formatDate(meeting.startTime);
    const timeStr = formatTime(meeting.startTime);
    const duration = formatDuration(meeting.durationMs);
    const taskCount = meeting.tasks?.length || 0;
    const decisionCount = meeting.decisions?.length || 0;
    const riskCount = meeting.risks?.length || 0;
    const hasSummary = !!meeting.summary?.summary;
    const lineCount = meeting.transcript?.length || 0;

    card.innerHTML = `
      <div class="card-top">
        <div class="card-date">${dateStr}</div>
        <div class="card-time">${timeStr}</div>
      </div>
      <div class="card-preview">${meeting.transcriptText?.slice(0, 120) || "No transcript"}</div>
      <div class="card-meta">
        <span class="badge">${duration}</span>
        <span class="badge">${lineCount} lines</span>
        ${hasSummary ? '<span class="badge badge-accent">Summary</span>' : ""}
        ${taskCount > 0 ? `<span class="badge">${taskCount} tasks</span>` : ""}
        ${decisionCount > 0 ? `<span class="badge">${decisionCount} decisions</span>` : ""}
        ${riskCount > 0 ? `<span class="badge badge-risk">${riskCount} risks</span>` : ""}
      </div>`;

    card.addEventListener("click", () => openDetail(meeting.id));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openDetail(meeting.id);
      }
    });

    listView.appendChild(card);
  });
}

// ──────────────────────────────────────────
// 2. Search
// ──────────────────────────────────────────

searchInput.addEventListener("input", () => {
  const query = searchInput.value.toLowerCase().trim();
  if (!query) {
    renderList(allMeetings);
    return;
  }
  const filtered = allMeetings.filter((m) => {
    const text = (m.transcriptText || "").toLowerCase();
    const tasks = (m.tasks || []).map((t) => t.task?.toLowerCase()).join(" ");
    const decisions = (m.decisions || []).join(" ").toLowerCase();
    const risks = (m.risks || []).join(" ").toLowerCase();
    const summary = (m.summary?.summary || "").toLowerCase();
    return (
      text.includes(query) ||
      tasks.includes(query) ||
      decisions.includes(query) ||
      risks.includes(query) ||
      summary.includes(query)
    );
  });
  renderList(filtered);
});

// ──────────────────────────────────────────
// 3. Detail View
// ──────────────────────────────────────────

function openDetail(meetingId) {
  const meeting = allMeetings.find((m) => m.id === meetingId);
  if (!meeting) return;

  currentMeeting = meeting;

  document.getElementById("detail-date").textContent =
    `${formatDate(meeting.startTime)} at ${formatTime(meeting.startTime)}`;
  document.getElementById("detail-duration").textContent = formatDuration(
    meeting.durationMs
  );
  document.getElementById("detail-lines").textContent = `${meeting.transcript?.length || 0} lines`;

  // Summary
  const summarySection = document.getElementById("detail-summary-section");
  if (meeting.summary?.summary) {
    summarySection.classList.remove("hidden");
    document.getElementById("detail-summary-text").textContent =
      meeting.summary.summary;
  } else {
    summarySection.classList.add("hidden");
  }

  // Tasks
  const taskSection = document.getElementById("detail-tasks-section");
  const taskTbody = document.getElementById("detail-task-tbody");
  if (meeting.tasks?.length) {
    taskSection.classList.remove("hidden");
    taskTbody.innerHTML = meeting.tasks
      .map(
        (t) => `
      <tr>
        <td>${sanitize(t.task)}</td>
        <td>${sanitize(t.owner || "Unassigned")}</td>
        <td>${sanitize(t.deadline || "TBD")}</td>
        <td><span class="status-badge status-${(t.status || "pending").toLowerCase().replace(" ", "-")}">${sanitize(t.status || "Pending")}</span></td>
      </tr>`
      )
      .join("");
  } else {
    taskSection.classList.add("hidden");
  }

  // Decisions
  const decisionsSection = document.getElementById("detail-decisions-section");
  const decisionsList = document.getElementById("detail-decisions-list");
  if (meeting.decisions?.length) {
    decisionsSection.classList.remove("hidden");
    decisionsList.innerHTML = meeting.decisions
      .map((d) => `<li class="decision-item">${sanitize(d)}</li>`)
      .join("");
  } else {
    decisionsSection.classList.add("hidden");
  }

  // Risks
  const risksSection = document.getElementById("detail-risks-section");
  const risksList = document.getElementById("detail-risks-list");
  if (meeting.risks?.length) {
    risksSection.classList.remove("hidden");
    risksList.innerHTML = meeting.risks
      .map((r) => `<li class="risk-item">${sanitize(r)}</li>`)
      .join("");
  } else {
    risksSection.classList.add("hidden");
  }

  // Transcript
  const transcriptEl = document.getElementById("detail-transcript");
  if (meeting.transcript?.length) {
    transcriptEl.innerHTML = meeting.transcript
      .map(
        (chunk) =>
          `<p class="transcript-line"><span class="transcript-time">${formatTime(chunk.timestamp)}</span>${sanitize(chunk.text)}</p>`
      )
      .join("");
  } else if (meeting.transcriptText) {
    transcriptEl.innerHTML = `<p class="transcript-line">${sanitize(meeting.transcriptText)}</p>`;
  } else {
    transcriptEl.innerHTML = `<p class="empty-state">No transcript recorded.</p>`;
  }

  // Show detail, hide list
  listView.classList.add("hidden");
  searchInput.parentElement.classList.add("hidden");
  detailView.classList.remove("hidden");
}

function closeDetail() {
  currentMeeting = null;
  detailView.classList.add("hidden");
  listView.classList.remove("hidden");
  searchInput.parentElement.classList.remove("hidden");
}

// ──────────────────────────────────────────
// 4. Actions
// ──────────────────────────────────────────

btnBack.addEventListener("click", () => {
  window.close();
});

btnDetailBack.addEventListener("click", closeDetail);

btnDeleteMeeting.addEventListener("click", async () => {
  if (!currentMeeting) return;
  if (!confirm("Delete this meeting from history? This cannot be undone.")) return;
  await chrome.runtime.sendMessage({
    type: "DELETE_MEETING",
    meetingId: currentMeeting.id,
  });
  closeDetail();
  await loadHistory();
});

btnClearAll.addEventListener("click", async () => {
  if (!confirm("Delete ALL meeting history? This cannot be undone.")) return;
  await chrome.runtime.sendMessage({ type: "CLEAR_ALL_HISTORY" });
  await loadHistory();
});

btnCopyTranscript.addEventListener("click", () => {
  if (!currentMeeting) return;
  const text = currentMeeting.transcriptText || currentMeeting.transcript?.map((c) => c.text).join("\n") || "";
  navigator.clipboard.writeText(text).then(() => {
    btnCopyTranscript.textContent = "✅ Copied!";
    setTimeout(() => (btnCopyTranscript.textContent = "📋 Copy"), 2000);
  });
});

btnCopyJson.addEventListener("click", () => {
  if (!currentMeeting) return;
  const json = JSON.stringify(currentMeeting, null, 2);
  navigator.clipboard.writeText(json).then(() => {
    btnCopyJson.textContent = "✅ Copied!";
    setTimeout(() => (btnCopyJson.textContent = "📋 Copy Full JSON"), 2000);
  });
});

btnCopyMd.addEventListener("click", () => {
  if (!currentMeeting) return;
  const md = meetingToMarkdown(currentMeeting);
  navigator.clipboard.writeText(md).then(() => {
    btnCopyMd.textContent = "✅ Copied!";
    setTimeout(() => (btnCopyMd.textContent = "📝 Copy Markdown"), 2000);
  });
});

function meetingToMarkdown(m) {
  let md = `# Meeting — ${formatDate(m.startTime)} at ${formatTime(m.startTime)}\n\n`;
  md += `**Duration:** ${formatDuration(m.durationMs)}\n\n`;

  if (m.summary?.summary) {
    md += `## Summary\n\n${m.summary.summary}\n\n`;
  }

  if (m.tasks?.length) {
    md += `## Tasks\n`;
    m.tasks.forEach(
      (t) =>
        (md += `- [ ] **${t.task}** — ${t.owner || "Unassigned"} — ${t.deadline || "TBD"} [${t.status || "Pending"}]\n`)
    );
    md += "\n";
  }

  if (m.decisions?.length) {
    md += `## Decisions\n`;
    m.decisions.forEach((d) => (md += `- ${d}\n`));
    md += "\n";
  }

  if (m.risks?.length) {
    md += `## Risks\n`;
    m.risks.forEach((r) => (md += `- ${r}\n`));
    md += "\n";
  }

  if (m.transcriptText) {
    md += `## Transcript\n\n${m.transcriptText}\n`;
  }

  return md;
}

// ──────────────────────────────────────────
// 5. Helpers
// ──────────────────────────────────────────

function formatDate(ts) {
  return new Date(ts).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(ms) {
  if (!ms) return "0m";
  const totalMin = Math.floor(ms / 60000);
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function sanitize(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ── Listen for history updates from background ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "HISTORY_UPDATED") {
    loadHistory();
  }
});

// ── Boot ──
loadHistory();
