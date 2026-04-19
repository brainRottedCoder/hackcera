# 📋 MeetSense AI — Product Requirements Document (PRD)

> **Version:** 1.1 | **Date:** April 2026 | **Status:** Updated for Gemini 3.1 Flash

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Problem & Opportunity](#2-problem--opportunity)
3. [Target Users](#3-target-users)
4. [Core Features & Acceptance Criteria](#4-core-features--acceptance-criteria)
5. [System Architecture](#5-system-architecture)
6. [Technical Implementation Plan](#6-technical-implementation-plan)
7. [Phased Execution Roadmap](#7-phased-execution-roadmap)
8. [Edge Cases & Failure Modes](#8-edge-cases--failure-modes)
9. [Security & Privacy](#9-security--privacy)
10. [Testing Strategy](#10-testing-strategy)
11. [Cost Model](#11-cost-model)
12. [Success Metrics & KPIs](#12-success-metrics--kpis)
13. [Future Enhancements](#13-future-enhancements)

---

## 1. Product Overview

### 1.1 Product Name
**MeetSense AI** — Real-Time Meeting Intelligence System

### 1.2 Tagline
> *A real-time intelligence layer that transforms conversations into structured execution data instantly.*

### 1.3 One-Line Summary
A Chrome Extension + Side Panel Web App that ingests live meeting captions from Google Meet / Zoom, processes them through an LLM pipeline in **< 3 seconds**, and surfaces structured **Tasks**, **Decisions**, **Risks**, and **Summaries** in real-time.

### 1.4 Positioning
MeetSense AI is **not** a meeting summarizer. It is an **active execution intelligence layer** that operates live during the meeting, not after it.

---

## 2. Problem & Opportunity

### 2.1 The Problem
| Pain Point | Impact |
|---|---|
| Meetings lack structure | Critical information is lost in noise |
| No real-time action tracking | Tasks are assigned verbally and forgotten |
| Post-meeting notes are manual | High effort, low accuracy |
| No accountability loop | Decisions made with no owner or deadline |
| Context switches mid-meeting | Participants lose track of what was decided |

### 2.2 Market Opportunity
- Every knowledge worker attends an average of 15–20 meetings/week.
- $37 billion is lost annually in the US alone due to unproductive meetings (Harvard Business Review).
- Existing tools (Otter.ai, Fireflies) focus on **post-meeting** transcripts, not **real-time intelligence**.

---

## 3. Target Users

| Persona | Description | Use Case |
|---|---|---|
| **Engineering Leads** | Tech leads managing sprints | Capture action items during standups |
| **Product Managers** | Running roadmap discussions | Extract decisions and risks in real-time |
| **Founders / Executives** | High-stakes investor/strategy calls | Never miss a commitment or risk |
| **Consultants** | Client-facing calls | Auto-generate post-call deliverables |

---

## 4. Core Features & Acceptance Criteria

### 4.1 Real-Time Transcript Capture

**Description:** Ingest live captions from Google Meet's DOM and stream them to the backend.

| Criterion | Expected Behavior |
|---|---|
| Caption polling interval | Every 1 second via `setInterval` |
| Deduplication | Only new, changed captions are forwarded |
| Timestamp accuracy | UTC timestamp attached to every caption chunk |
| Graceful degradation | If captions are off, display a prompt to enable them |

---

### 4.2 AI Insights Panel *(Core Differentiator)*

**Description:** Process caption chunks through an LLM and return structured insights.

| Criterion | Expected Behavior |
|---|---|
| Latency | < 3 seconds from caption input to UI update |
| Extraction categories | Tasks (owner + deadline), Decisions, Risks/Blockers |
| Output format | Strict JSON (validated before rendering) |
| Trigger condition | Every 3+ new caption chunks OR 5-second timeout |
| Fallback | If LLM fails, display last successful extraction |

---

### 4.3 Action Dashboard

**Description:** A dynamically updating table of extracted tasks.

| Column | Source |
|---|---|
| Task | LLM `tasks[].task` |
| Owner | LLM `tasks[].owner` (or "Unassigned" if missing) |
| Deadline | LLM `tasks[].deadline` (or "TBD" if missing) |
| Status | Default: `Pending`; manually editable |

- Auto-refreshes on every new LLM response.
- Row must not flash/reorder on update; use ID-based reconciliation.

---

### 4.4 One-Click Summary

**Description:** On meeting end, generate a full meeting summary with one click.

- Sends full transcript buffer to LLM with a summarization prompt.
- Output includes: Summary paragraph, full task list, decision list, risk list.
- Export as JSON and copy-to-clipboard functionality.

---

### 4.5 Context Memory Manager

**Description:** Maintain a rolling context window for the LLM.

- Sliding window of last 20–40 seconds of transcript text.
- Previously extracted tasks and decisions are injected into prompt for continuity.
- Context is cleared on meeting end.

---

## 5. System Architecture

### 5.1 High-Level Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        GOOGLE MEET TAB                          │
│                                                                 │
│   [DOM: aria-live captions]  ──► contentScript.js              │
│                                         │                       │
│                                    NEW_CAPTION msg              │
│                                         │                       │
│                                  background.js                  │
│                                         │                       │
│                               WebSocket client                  │
└─────────────────────────────────────────────────────────────────┘
                                          │
                              ws:// or wss:// stream
                                          │
┌─────────────────────────────────────────────────────────────────┐
│                       NODE.JS BACKEND                           │
│                                                                 │
│   WebSocket Server                                              │
│        │                                                        │
│   Context Buffer Manager                                        │
│        │                                                        │
│   LLM Trigger Scheduler  (buffer ≥ 3 chunks OR 5s timeout)     │
│        │                                                        │
│   LLM Orchestrator  ──► OpenAI GPT-4o-mini / Gemini Flash      │
│        │                                                        │
│   Response Validator & Broadcaster                              │
│        │                                                        │
│   WebSocket → sidepanel.js                                      │
└─────────────────────────────────────────────────────────────────┘
                                          │
                              WebSocket push
                                          │
┌─────────────────────────────────────────────────────────────────┐
│                   CHROME EXTENSION SIDE PANEL                   │
│                                                                 │
│   sidepanel.html + sidepanel.js                                 │
│                                                                 │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │  📝 Live Transcript Feed                                │  │
│   ├──────────────────────────────────────────────────────────┤  │
│   │  ✅ Tasks | 🟡 Decisions | 🔴 Risks                    │  │
│   ├──────────────────────────────────────────────────────────┤  │
│   │  📊 Action Table (Task / Owner / Deadline / Status)    │  │
│   ├──────────────────────────────────────────────────────────┤  │
│   │  [📋 Generate Summary]  [💾 Export JSON]               │  │
│   └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| Extension | Chrome MV3 (Manifest v3) | Current standard; background service workers |
| Backend runtime | Node.js (Express + `ws`) | Fast, non-blocking, WebSocket native |
| LLM Primary | Google Gemini 3.1 Flash | 28% faster than 2.5 Flash, GA status, native JSON mode, 1M token context |
| LLM Fallback | Google Gemini 3.1 Flash Lite | 64% faster throughput, developer preview, lowest total latency |
| Frontend UI | Vanilla JS + Tailwind CSS | Lightweight, fast load in side panel |
| Deployment | Railway / Render | Easy WebSocket support, free tier available |

---

## 6. Technical Implementation Plan

### 6.1 Chrome Extension Structure

```
/extension
  manifest.json
  /icons
  contentScript.js       ← Caption scraper
  background.js          ← Message router + WS client
  sidepanel.html         ← UI shell
  sidepanel.js           ← UI logic + WS event handler
  /styles
    sidepanel.css
```

#### `manifest.json` Key Permissions
```json
{
  "manifest_version": 3,
  "permissions": ["tabs", "activeTab", "scripting", "sidePanel", "storage"],
  "host_permissions": ["https://meet.google.com/*"],
  "background": { "service_worker": "background.js" },
  "side_panel": { "default_path": "sidepanel.html" },
  "content_scripts": [{
    "matches": ["https://meet.google.com/*"],
    "js": ["contentScript.js"]
  }]
}
```

#### Caption Scraper Logic (`contentScript.js`)
```javascript
let lastCaption = "";

setInterval(() => {
  // Primary selector for Google Meet captions
  const el = document.querySelector('[aria-live="polite"]') ||
             document.querySelector('.a4cQT');
  const text = el?.innerText?.trim();

  if (text && text !== lastCaption) {
    lastCaption = text;
    chrome.runtime.sendMessage({
      type: "NEW_CAPTION",
      payload: { text, timestamp: Date.now() }
    });
  }
}, 1000);
```

> ⚠️ **Note:** Google Meet's DOM selectors are subject to change with UI updates. Implement a selector resilience layer with 2–3 fallback selectors.

---

### 6.2 Background Service Worker (`background.js`)

Responsibilities:
- Maintain a single persistent WebSocket connection to the backend.
- Route `NEW_CAPTION` messages from content script → WebSocket server.
- Route WebSocket server responses → side panel UI.
- Handle reconnection logic (exponential backoff).

```javascript
let socket;
let reconnectDelay = 1000;

function connectWebSocket() {
  socket = new WebSocket("wss://your-backend.onrender.com");

  socket.onopen = () => { reconnectDelay = 1000; };

  socket.onmessage = (event) => {
    chrome.runtime.sendMessage({ type: "LLM_RESPONSE", payload: JSON.parse(event.data) });
  };

  socket.onclose = () => {
    setTimeout(connectWebSocket, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000); // cap at 30s
  };
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "NEW_CAPTION" && socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "chunk", ...msg.payload }));
  }
});

connectWebSocket();
```

---

### 6.3 Node.js Backend

#### Project Structure
```
/backend
  server.js              ← Express + WS server entry
  contextManager.js      ← Sliding window context
  llmOrchestrator.js     ← LLM call + fallback logic
  promptBuilder.js       ← Prompt template engine
  responseValidator.js   ← JSON schema validation
  scheduler.js           ← Trigger logic (buffer count + timeout)
```

#### Context Manager (`contextManager.js`)
```javascript
class ContextManager {
  constructor(windowSize = 10) {
    this.buffer = [];         // incoming caption chunks
    this.tasks = [];          // accumulated tasks
    this.decisions = [];      // accumulated decisions
    this.windowSize = windowSize;
  }

  addChunk(text) {
    this.buffer.push(text);
    if (this.buffer.length > this.windowSize) this.buffer.shift();
  }

  getContext() {
    return this.buffer.join(" ");
  }

  updateFromLLM({ tasks, decisions, risks }) {
    // Merge without duplicates — use task text as dedup key
    tasks?.forEach(t => {
      if (!this.tasks.find(x => x.task === t.task)) this.tasks.push(t);
    });
    decisions?.forEach(d => {
      if (!this.decisions.includes(d)) this.decisions.push(d);
    });
  }
}
```

#### LLM Trigger Scheduler (`scheduler.js`)
```javascript
const CHUNK_TRIGGER = 3;   // call LLM every N chunks
const TIME_TRIGGER = 5000; // or every 5 seconds

let chunkCount = 0;
let triggerTimer = null;

function onNewChunk(ctx, llmCallback) {
  chunkCount++;
  ctx.addChunk(text);

  if (chunkCount >= CHUNK_TRIGGER) {
    chunkCount = 0;
    clearTimeout(triggerTimer);
    llmCallback(ctx.getContext());
  } else if (!triggerTimer) {
    triggerTimer = setTimeout(() => {
      triggerTimer = null;
      chunkCount = 0;
      llmCallback(ctx.getContext());
    }, TIME_TRIGGER);
  }
}
```

#### LLM Orchestrator with Fallback (`llmOrchestrator.js`)
```javascript
async function callLLM(context, previousTasks, previousDecisions) {
  const prompt = buildPrompt(context, previousTasks, previousDecisions);

  try {
    // Primary: Gemini 3.1 Flash (GA, lowest production latency)
    const model = genAI.getGenerativeModel({ 
      model: "gemini-3.1-flash",
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 500,
        temperature: 0.1
      }
    });
    const result = await model.generateContent(prompt);
    return validateJSON(result.response.text());
  } catch (primaryErr) {
    console.warn("Primary LLM failed, trying fallback:", primaryErr.message);
    try {
      // Fallback: Gemini 3.1 Flash Lite (preview, 64% faster throughput)
      const model = genAI.getGenerativeModel({ 
        model: "gemini-3.1-flash-lite",
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: 500,
          temperature: 0.1
        }
      });
      const result = await model.generateContent(prompt);
      return validateJSON(result.response.text());
    } catch (fallbackErr) {
      console.error("All LLMs failed:", fallbackErr.message);
      return null; // UI will retain last state
    }
  }
}
```

---

### 6.4 Prompt Template

```
You are an AI meeting assistant analyzing a live business meeting.

## Live Transcript (last ~30 seconds):
{CONTEXT}

## Previously Extracted (for continuity, do not repeat unless updated):
Tasks: {PREV_TASKS_JSON}
Decisions: {PREV_DECISIONS_JSON}

## Your Task:
Extract NEW or UPDATED items from the current transcript:
1. Tasks — each must have: task (string), owner (string or "Unassigned"), deadline (string or "TBD")
2. Decisions — clear commitments made (strings)
3. Risks — blockers or risks mentioned (strings)

## Rules:
- Only return items explicitly discussed. Do NOT hallucinate.
- Return ONLY valid JSON. No explanation, no markdown.
- If nothing new, return: {"tasks":[],"decisions":[],"risks":[]}

## Output Format:
{"tasks":[{"task":"...","owner":"...","deadline":"..."}],"decisions":["..."],"risks":["..."]}
```

---

### 6.5 Response Validator (`responseValidator.js`)

```javascript
const Ajv = require("ajv");
const ajv = new Ajv();

const schema = {
  type: "object",
  required: ["tasks", "decisions", "risks"],
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        required: ["task"],
        properties: {
          task: { type: "string" },
          owner: { type: "string" },
          deadline: { type: "string" }
        }
      }
    },
    decisions: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } }
  }
};

const validate = ajv.compile(schema);

function validateJSON(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (validate(parsed)) return parsed;
    console.warn("Schema validation failed:", validate.errors);
    return null;
  } catch {
    return null;
  }
}
```

---

### 6.6 Side Panel UI (`sidepanel.js`)

```javascript
let allTasks = [];

// Connect to extension background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "LLM_RESPONSE") updateUI(msg.payload);
  if (msg.type === "CAPTION_UPDATE") appendTranscript(msg.payload);
});

function updateUI({ tasks, decisions, risks }) {
  if (!tasks && !decisions && !risks) return; // null-safe

  // Reconcile tasks by task text (no full re-render)
  tasks?.forEach(newTask => {
    const idx = allTasks.findIndex(t => t.task === newTask.task);
    if (idx === -1) allTasks.push({ ...newTask, status: "Pending" });
    else allTasks[idx] = { ...allTasks[idx], ...newTask };
  });

  renderTaskTable(allTasks);
  renderList("decisions-list", decisions);
  renderList("risks-list", risks);
}
```

---

## 7. Phased Execution Roadmap

### Phase 0 — Setup (Day 1, ~2 hours)
- [ ] Init Node.js backend project with Express + `ws`
- [ ] Create Chrome Extension scaffold with MV3 manifest
- [ ] Set up WebSocket server (local `ws://localhost:3000`)
- [ ] Verify end-to-end message passing: content script → background → WS server

### Phase 1 — Caption Pipeline (Day 1–2, ~3 hours)
- [ ] Implement `contentScript.js` caption scraper
- [ ] Test on live Google Meet with captions enabled
- [ ] Implement deduplication and timestamp injection
- [ ] Validate messages arrive at backend

### Phase 2 — LLM Integration (Day 2, ~3 hours)
- [ ] Implement `contextManager.js` with sliding window
- [ ] Implement `promptBuilder.js` with template
- [ ] Connect to OpenAI API, validate JSON output
- [ ] Add Gemini Flash fallback
- [ ] Add `responseValidator.js` with Ajv schema

### Phase 3 — Side Panel UI (Day 2–3, ~4 hours)
- [ ] Build `sidepanel.html` layout (transcript + tabs + table)
- [ ] Implement `sidepanel.js` with WebSocket listener
- [ ] Connect to background service worker
- [ ] Implement task table reconciliation (no re-render flashing)
- [ ] Add status badge & manual edit on tasks

### Phase 4 — End-to-End Integration (Day 3, ~2 hours)
- [ ] Full flow test: Meet captions → backend → UI update
- [ ] Verify latency < 5 seconds consistently
- [ ] Fix edge cases discovered (see Section 8)

### Phase 5 — Polish & Summary Feature (Day 3–4, ~2 hours)
- [ ] Implement "Generate Summary" button
- [ ] Implement JSON export
- [ ] UI polish (loading states, error banners, empty states)
- [ ] Add reconnection status indicator in UI

### Phase 6 — Deployment (Day 4, ~1 hour)
- [ ] Deploy Node.js backend to Railway or Render
- [ ] Update extension WS URL to production endpoint
- [ ] Test with production WebSocket over `wss://`
- [ ] Package extension for manual installation

---

## 8. Edge Cases & Failure Modes

This section is the most critical for production reliability.

---

### 8.1 Caption Capture Layer

| # | Edge Case | How It Fails | Mitigation |
|---|---|---|---|
| EC-01 | **User has captions disabled** | `aria-live` element doesn't exist; scraper returns null | Detect missing element, show persistent banner: *"Enable captions in Google Meet to activate MeetSense"* |
| EC-02 | **Google Meet DOM update** | CSS class or `aria-live` selector changes with a Meet UI update; scraper silently stops | Maintain 3 fallback selectors; add health-check ping every 5s; alert user if no captions received in 15s |
| EC-03 | **Duplicate captions** | Meet sometimes renders the same caption multiple times before finalizing | String equality check on `lastCaption`; additional normalization (trim, lowercase) for fuzzy dedup |
| EC-04 | **Rapid speaker switching** | Captions update faster than 1s poll; early parts of sentence lost | Reduce poll to 500ms; consider MutationObserver instead of setInterval for zero-latency detection |
| EC-05 | **Silence / no speech** | Empty transcript; LLM call triggered with no content | Guard: only trigger LLM if `context.trim().length > 20` characters |
| EC-06 | **Non-English speech** | LLM prompt/extraction assumes English | Add language detection; pass detected language to LLM prompt; document as known limitation for hackathon |

---

### 8.2 WebSocket Communication Layer

| # | Edge Case | How It Fails | Mitigation |
|---|---|---|---|
| EC-07 | **Connection drops mid-meeting** | User loses all real-time updates silently | Exponential backoff reconnect (1s → 2s → 4s → max 30s); show "Reconnecting..." spinner in UI |
| EC-08 | **Network latency spike** | Message queues up; multiple LLM calls stack | Implement message queue with max size 20; drop oldest on overflow |
| EC-09 | **Backend cold start (Render/Railway)** | First connection takes 10–30s on free tier | Implement WS keep-alive ping every 25s; warn user if connection takes > 5s |
| EC-10 | **Multiple tabs open** | Two content scripts sending captions; backend receives duplicates | Session ID per extension instance; backend deduplicates by session |
| EC-11 | **Extension service worker sleep (MV3)** | Background service workers can be killed by Chrome after 5 min of inactivity | Use `chrome.alarms` API to ping service worker and keep it alive; reconnect WS on wake |

---

### 8.3 LLM Processing Layer

| # | Edge Case | How It Fails | Mitigation |
|---|---|---|---|
| EC-12 | **LLM returns malformed JSON** | `JSON.parse()` throws; app crashes | Wrap all parses in try/catch; run through `responseValidator.js`; discard invalid responses |
| EC-13 | **LLM hallucinates tasks** | Confident-sounding but fabricated owners or deadlines | Strict prompt instruction: *"Only extract explicitly stated items"*; use low temperature (0.2) |
| EC-14 | **LLM timeout (>2.5 seconds)** | Total latency exceeds 3s target | Set hard 2500ms timeout on API call; on timeout, skip this cycle, retry next |
| EC-15 | **OpenAI API rate limit** | HTTP 429; primary LLM unavailable | Automatic fallback to Gemini Flash; implement token-bucket rate limiter on backend |
| EC-16 | **OpenAI API key exhausted / billing** | HTTP 401/402 | Failover to Gemini; alert developer via log; UI shows "AI temporarily unavailable" |
| EC-17 | **Context window overflow** | 10-chunk window produces a very long prompt | Limit total context to 800 tokens max; truncate oldest chunks first |
| EC-18 | **Empty LLM response** | Model returns `{"tasks":[],"decisions":[],"risks":[]}` for every cycle | Normal behavior; don't show a "no data" error — simply retain last state |

---

### 8.4 Frontend / UI Layer

| # | Edge Case | How It Fails | Mitigation |
|---|---|---|---|
| EC-19 | **Side panel not opening** | User doesn't know to click the extension icon | Auto-open side panel when Meet tab is detected active (`chrome.sidePanel.open`) |
| EC-20 | **Task table flickers on update** | Full re-render on each LLM response causes visual noise | ID-based reconciliation — only add/update rows, never re-render entire table |
| EC-21 | **Very long meetings (2+ hours)** | Task list grows unbounded; UI becomes slow | Paginate task list; cap visible tasks at 50 (archive older ones) |
| EC-22 | **Owner name parsing fails** | LLM says "Rahul will do it" → owner field is "Rahul will do it" | Post-process owner field: extract first proper noun via regex or secondary mini-prompt |
| EC-23 | **Export JSON contains PII** | Task names or owners contain sensitive info | Add warning before export: "This file contains meeting content. Handle with care." |

---

### 8.5 Deployment & Operational

| # | Edge Case | How It Fails | Mitigation |
|---|---|---|---|
| EC-24 | **CORS / CSP blocking** | Backend WS URL blocked by Chrome's Content Security Policy | Use `wss://` in production; declare CSP in manifest correctly |
| EC-25 | **Backend server restart** | All active WebSocket sessions are dropped | Grace-shutdown handler; clients auto-reconnect; buffer unsent chunks during downtime |
| EC-26 | **High concurrent users** | Multiple users connecting; backend becomes bottleneck | Implement per-session context isolation; plan for horizontal scaling with session affinity |
| EC-27 | **Extension update breaks session** | Chrome kills old content script on extension reload | Content script sends a re-init ping on injection; backend resets session |

---

## 9. Security & Privacy

### 9.1 Data Handling Principles
- **No audio recording** — only text captions from DOM are captured.
- **Ephemeral processing** — transcript data lives in-memory only; not persisted to any database.
- **Session isolation** — each meeting session has an isolated context buffer that is cleared on disconnect.
- **Minimal permissions** — extension only requests access to `meet.google.com` domain.

### 9.2 Threat Model

| Threat | Risk | Mitigation |
|---|---|---|
| Man-in-the-middle on WS | Caption data intercepted | Use `wss://` (TLS) exclusively in production |
| Prompt injection via captions | Malicious speaker injects LLM commands | Sanitize caption input; wrap in strict JSON-only prompt |
| API key exposure | Key hardcoded in extension | Store keys in backend only; never expose in extension bundle |
| Side panel XSS | Rendered LLM text contains scripts | Sanitize all LLM output before DOM insertion (use `textContent`, not `innerHTML`) |

### 9.3 GDPR Considerations
- No user data is stored server-side beyond the active session.
- Provide clear in-extension notice: *"Your meeting captions are processed temporarily and never stored."*
- Allow user to clear session data with one click.

---

## 10. Testing Strategy

### 10.1 Unit Tests
| Test | What to Validate |
|---|---|
| `contextManager.addChunk()` | Sliding window size enforcement |
| `responseValidator.validateJSON()` | Valid/invalid/null/malformed inputs |
| Caption deduplication logic | Same string doesn't trigger twice |
| Scheduler trigger logic | Fires at N chunks AND at timeout |

### 10.2 Integration Tests
| Flow | Test |
|---|---|
| Caption → WS → Backend | Mock Meet DOM; verify message arrives at WS server |
| Backend → LLM → Response | Use LLM API in test mode; verify JSON extraction |
| Backend → Side Panel | Verify UI updates within 5s of caption injection |

### 10.3 End-to-End Test
- Open a Google Meet call with Test Account A and Test Account B.
- Enable Google Meet captions.
- Speak scripted phrases that should produce tasks, decisions, and risks.
- Validate that expected items appear in side panel within 5 seconds.
- Validate that the same item doesn't appear twice (dedup test).

### 10.4 Latency Benchmarking
```
Measurement Points:
  T0: Caption detected in DOM
  T1: Message received at WS server
  T2: LLM API call initiated
  T3: LLM response received
  T4: UI updated in side panel

Target: T4 - T0 < 3000ms
Acceptable: T4 - T0 < 4500ms (with fallback path)
```

### 10.5 Stress Tests
- Rapid speech: 200 words per minute for 5 minutes.
- Speaker switching: Alternate every 3 seconds.
- 2-hour session: Verify no memory leak in context buffer or task list.

---

## 11. Cost Model

### 11.1 LLM Costs (Per Meeting — 30 min)

| Model | Input tokens | Input cost | Output tokens | Output cost | Total/meeting |
|---|---|---|---|---|---|
| Gemini 3.1 Flash | ~45,000 | $0.00135 | ~5,000 | $0.0018 | **~$0.0032** |
| Gemini 3.1 Flash Lite | ~45,000 | $0.00113 | ~5,000 | $0.00075 | **~$0.0019** |

> At 100 meetings/month: **~$1–5/month** in LLM costs.

### 11.2 Infrastructure

| Component | Provider | Cost |
|---|---|---|
| Backend (Node.js + WS) | Railway Starter | $5/month |
| Domain (optional) | Namecheap | ~$10/year |
| Chrome Extension hosting | Chrome Web Store | $5 one-time |
| **Total MVP** | | **~$10–15/month** |

---

## 12. Success Metrics & KPIs

| Metric | Target | Measurement Method |
|---|---|---|
| End-to-end latency | < 3 seconds (P95) | T4 − T0 timestamps in logs |
| Task extraction accuracy | > 80% match on test scripts | Defined test meeting scripts with expected outputs |
| Real-time update reliability | 0 dropped updates in 30-min session | WS message sequence numbers |
| Caption capture rate | > 95% of captions captured | Compare DOM reads vs. server receives |
| UI flicker rate | 0 full re-renders per session | Manual observation + JS profiler |
| Session reconnect time | < 10 seconds after drop | Simulate network interruption |

---

## 13. Future Enhancements

### Priority 1 (Post-Hackathon)
- **Speaker Identification** — Correlate DOM avatar/name with caption block; include speaker in task owner field.
- **Zoom Support** — Adapt content script for Zoom Web client's caption DOM.
- **Microsoft Teams Support** — Extend to Teams Web.

### Priority 2
- **Meeting Memory (Embeddings)** — Store past meeting context in a vector DB; query across meeting history.
- **Slack Integration** — Push tasks to a Slack channel at meeting end.
- **Notion Integration** — Auto-create action items as Notion database entries.

### Priority 3
- **AI Intervention Suggestions** — If AI detects the meeting is going off-track, suggest refocusing questions.
- **Multi-language Support** — Extend prompts for French, Spanish, Hindi, etc.
- **Risk Escalation Alerts** — Auto-ping relevant stakeholders when a critical risk is mentioned.

---

## Appendix A — Directory Structure (Full)

```
meetsense-ai/
├── extension/
│   ├── manifest.json
│   ├── contentScript.js
│   ├── background.js
│   ├── sidepanel.html
│   ├── sidepanel.js
│   ├── sidepanel.css
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
│
└── backend/
    ├── package.json
    ├── server.js
    ├── contextManager.js
    ├── scheduler.js
    ├── llmOrchestrator.js
    ├── promptBuilder.js
    ├── responseValidator.js
    └── .env
```

---

## Appendix B — Environment Variables

```env
# backend/.env
GEMINI_API_KEY=AIza...
PORT=3000
MAX_CONTEXT_WINDOW=10
LLM_TIMEOUT_MS=2500
CHUNK_TRIGGER_COUNT=3
TIME_TRIGGER_MS=4000
```

---

*Document Owner: MeetSense AI Team | Last Updated: April 2026*
