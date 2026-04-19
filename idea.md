# 📄 Product Requirements Document (PRD)

# 🧠 Product Name

**MeetSense AI — Real-Time Meeting Intelligence System**

---

# 🚀 1. Vision

Build a **real-time AI system** that converts live meeting conversations into:

* Structured tasks
* Decisions
* Risks
* Summaries

Within **<5 seconds latency**, directly from platforms like Google Meet, Zoom, etc.

---

# 🎯 2. Problem Statement

Meetings today are:

* Unstructured
* Hard to track
* Forgettable
* Non-actionable

Users struggle with:

* Missing action items
* Forgetting decisions
* No accountability

---

# 💡 3. Solution

A **Chrome Extension + Embedded Web App** that:

1. Captures live meeting captions
2. Streams them to backend
3. Processes with AI in real-time
4. Displays structured outputs instantly

---

# 🧩 4. Core Features

## 4.1 Real-Time Transcript

* Live caption ingestion
* Deduplicated streaming
* Timestamped messages

---

## 4.2 AI Insights Panel (Core Differentiator)

Extract in real-time:

* Tasks (with owner + deadline)
* Decisions
* Risks / blockers

Latency target: **<5 seconds**

---

## 4.3 Action Dashboard

Structured UI:

| Task | Owner | Deadline | Status |
| ---- | ----- | -------- | ------ |

Auto-updates dynamically.

---

## 4.4 One-Click Summary

After meeting:

* Generate full summary
* Export structured data (JSON)

---

## 4.5 Context Memory

Maintain:

* Last 20–40 seconds context window
* Previously extracted tasks/decisions

---

# 🏗️ 5. System Architecture

## 5.1 High-Level Flow

```
Google Meet (Captions)
        ↓
Chrome Extension (Content Script)
        ↓
Background Service Worker
        ↓
WebSocket Stream
        ↓
Node.js Backend
        ↓
LLM Processing
        ↓
Extension Side Panel UI
```

---

# ⚙️ 6. Technical Implementation

---

## 6.1 Chrome Extension (Manifest v3)

### Components:

* `contentScript.js` → Captures captions
* `background.js` → Handles communication
* `sidepanel.html/js` → UI (your web app)

---

### Caption Extraction

```javascript
setInterval(() => {
  const el = document.querySelector('[aria-live]');
  const text = el?.innerText;

  if (text && text !== lastCaption) {
    lastCaption = text;

    chrome.runtime.sendMessage({
      type: "NEW_CAPTION",
      payload: text
    });
  }
}, 1000);
```

---

## 6.2 WebSocket Communication

### Why:

* Low latency
* Real-time bidirectional updates

---

### Client → Server

```json
{
  "type": "chunk",
  "text": "We should deploy tomorrow",
  "timestamp": 1710000000
}
```

---

## 6.3 Backend (Node.js)

### Responsibilities:

* Context management
* LLM orchestration
* Streaming responses

---

### Context Window

```javascript
let context = [];

function updateContext(text) {
  context.push(text);
  if (context.length > 10) context.shift();
}
```

---

### LLM Trigger Logic

```javascript
if (buffer.length >= 3) {
  callLLM(context);
}
```

---

## 6.4 LLM Integration

### Models:

* OpenAI GPT-4o-mini
* Google Gemini Flash

---

### Prompt Template

```
You are an AI meeting assistant.

Context:
{last_30_seconds}

Extract:
1. Tasks (with owner + deadline)
2. Decisions
3. Risks

Return strictly in JSON.
```

---

### Output Format

```json
{
  "tasks": [
    {
      "task": "Deploy API",
      "owner": "Rahul",
      "deadline": "Tomorrow"
    }
  ],
  "decisions": ["Launch Friday"],
  "risks": ["Testing incomplete"]
}
```

---

## 6.5 Frontend (Extension Side Panel)

### Stack:

* React (optional) or Vanilla JS
* Tailwind CSS

---

### UI Layout

```
----------------------------------
| Transcript                    |
----------------------------------
| Tasks | Decisions | Risks     |
----------------------------------
| Action Table                 |
----------------------------------
```

---

## 6.6 Real-Time Updates

```javascript
socket.onmessage = (event) => {
  const data = JSON.parse(event.data);
  updateUI(data);
};
```

---

# ⚡ 7. Latency Optimization Strategy

## Required for <5 sec:

* Chunk input every 2–3 sec
* Call LLM every 4–5 sec
* Use fast inference models
* Maintain small context window

---

## Advanced Optimizations:

* Parallel LLM calls
* Debouncing
* Incremental UI updates
* Edge deployment (Vercel / Cloudflare)

---

# 💰 8. Cost Estimation

## 8.1 LLM Cost

Using GPT-4o-mini:

* ~$0.15 / 1M tokens (input)
* ~$0.60 / 1M tokens (output)

### Per meeting (~30 mins):

* ~50K tokens
* Cost ≈ $0.03 – $0.07

---

## 8.2 Infrastructure

| Component                    | Cost        |
| ---------------------------- | ----------- |
| Vercel (frontend)            | Free        |
| Node server (Railway/Render) | $5–10/month |
| WebSocket infra              | Included    |
| Domain                       | ~$10/year   |

---

## 8.3 Total MVP Cost

👉 ~$10–20/month

---

# 🔐 9. Security & Permissions

* Chrome permissions limited to:

  * Meet domain
* No audio storage
* Temporary processing only
* GDPR-friendly design possible

---

# 🧪 10. Testing Strategy

## Unit Tests:

* Context manager
* LLM output parsing

## Integration:

* Extension → backend → UI flow

## Edge Cases:

* Duplicate captions
* No speech
* Rapid speaker switching

---

# 🚀 11. Deployment Plan

## Frontend:

* Chrome Extension (manual install or store)

## Backend:

* Deploy on:

  * Railway / Render / AWS

---

# 🧠 12. Future Enhancements

* Speaker identification
* Meeting memory (embeddings)
* Slack / Notion integration
* AI intervention suggestions
* Multi-language support

---

# 🏆 13. Success Metrics

* <5 sec response latency
* > 80% task extraction accuracy
* Real-time UI updates
* User engagement during meeting

---

# 🔥 Final Positioning

**MeetSense AI is not a meeting summarizer.**

It is:

> A real-time intelligence layer that transforms conversations into structured execution data instantly.

---
