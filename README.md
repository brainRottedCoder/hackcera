# MeetSense AI — Real-Time Meeting Intelligence System

> _A real-time intelligence layer that transforms live conversations into structured execution data — before the meeting even ends._

✅ **Live Production Deployment Available**: https://hackcera.onrender.com

---

## The Problem

Meetings are where decisions happen, tasks are born, and risks surface. But the moment the call ends, **60-70% of what was discussed is lost**. Teams rely on:

- Manual note-taking (incomplete, distracting)
- Post-meeting summarizers like Otter.ai / Fireflies (too late — the moment has passed)
- Nobody remembering who was assigned what

**The result?** $37 billion lost annually to unproductive meetings in the US alone (Harvard Business Review). Tasks are assigned verbally and forgotten. Decisions are made with no owner or deadline. Risks are mentioned but never tracked.

---

## The MeetSense Difference

MeetSense AI is **not** a meeting summarizer. It is an **active execution intelligence layer** that operates **live during the meeting**, not after.

| Traditional Tools | MeetSense AI |
|---|---|
| Record the meeting, summarize after | Analyze the meeting **in real-time** |
| "Here's what was said" | "Here's what you need to do" |
| Passive transcript | Active task/decision/risk extraction |
| Post-meeting action items | Live action dashboard during the call |
| One summary at the end | Continuous insights every ~15 seconds |

**The shift is fundamental:** from _documentation_ to _execution intelligence_.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        GOOGLE MEET TAB                              │
│                                                                     │
│  ┌─────────────────────────────┐  ┌──────────────────────────────┐ │
│  │  TRACK A: Web Speech API    │  │  TRACK B: Tab Audio Capture  │ │
│  │  (webkitSpeechRecognition)  │  │  (chrome.tabCapture)         │ │
│  │  Mic → Real-time transcript │  │  Tab audio → MediaRecorder   │ │
│  │  Interim + Final results    │  │  → Offscreen Doc             │ │
│  └──────────┬──────────────────┘  └──────────┬───────────────────┘ │
│             │                                │                      │
│             ▼                                ▼                      │
│        contentScript.js           offscreen.js                     │
│             │                                │                      │
│             ▼                                ▼                      │
│        background.js (Service Worker)                               │
│        - Session management    - Audio forwarding                  │
│        - WebSocket client      - Meeting auto-save                 │
│        - Tab capture lifecycle - History storage                   │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
                    WebSocket stream
                          │
┌─────────────────────────▼───────────────────────────────────────────┐
│                       NODE.JS BACKEND                                │
│                                                                     │
│  WebSocket Server ──► ContextManager (sliding window)              │
│                    ──► LLM Orchestrator (Gemini 3.1 Flash)          │
│                    ──► Transcriber (Deepgram Nova-3 — Track B)      │
│                    ──► Prompt Builder                                │
│                    ──► Response Validator                           │
│                    ──► WebSocket push to side panel                │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
                    WebSocket push
                          │
┌─────────────────────────▼───────────────────────────────────────────┐
│                   CHROME EXTENSION SIDE PANEL                       │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  🎙️ Live Transcription (interim + final)                      │ │
│  ├────────────────────────────────────────────────────────────────┤ │
│  │  ⚡ AI Insights: Tasks | Decisions | Risks                    │ │
│  ├────────────────────────────────────────────────────────────────┤ │
│  │  📋 Action Dashboard (Task / Owner / Deadline / Status)      │ │
│  ├────────────────────────────────────────────────────────────────┤ │
│  │  📄 Generate Summary | Copy JSON | Copy Markdown             │ │
│  ├────────────────────────────────────────────────────────────────┤ │
│  │  📁 Meeting History (searchable, persistent)                  │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Dual-Track Transcription Engine

MeetSense uses a **dual-track approach** for maximum accuracy and coverage:

### Track A — Web Speech API (Real-Time, Zero Cost)
- Uses Chrome's native `webkitSpeechRecognition` API
- Runs directly in the content script inside the Meet tab
- Provides **interim** results (live preview as you speak) and **final** results (confirmed transcription)
- Auto-restarts after silence — continuous transcription throughout the meeting
- Zero API cost — runs entirely in the browser
- Persists final transcripts to `chrome.storage.local` for session continuity

### Track B — Tab Capture + Deepgram Streaming STT (Real-Time, Free Tier Available)
- Uses `chrome.tabCapture` API to capture the **tab's audio stream** (all participants, not just mic)
- Streams audio to an **offscreen document** where `MediaRecorder` records in webm/opus at 32kbps
- Audio chunks (**1s intervals**) are base64-encoded and sent via WebSocket to the backend
- Backend `DeepgramManager` handles real-time WebSocket connection to Deepgram Nova-3 — audio is streamed directly, no batching
- Transcription results arrive within **~300ms** (vs 25s with batch Whisper)
- Supports **interim + final results** — live preview appears in the side panel during transcription
- **Direct LLM pipeline integration**: Final transcripts feed directly into insights extraction without extra WebSocket roundtrips
- **100 hours/month free tier** — covers ~300 thirty-minute meetings at zero cost
- Falls back gracefully if `DEEPGRAM_API_KEY` is not configured — Track A still works independently

Both tracks merge into the same LLM insights pipeline, so nothing is missed.

---

## Core Features

### 1. Real-Time Transcription
Live speech-to-text running inside the meeting. Shows interim text (gray italic) as you speak and final text (white) once confirmed. No more "what did they just say?" moments.

### 2. AI Insights Extraction
Every ~15 seconds, accumulated transcript is sent to the LLM pipeline which extracts:

| Category | Fields |
|---|---|
| **Tasks** | Task description, Owner (or "Unassigned"), Deadline (or "TBD") |
| **Decisions** | Clear commitments made during the call |
| **Risks** | Blockers, concerns, or risks mentioned |

The LLM uses a strict JSON output mode with schema validation. Previously extracted items are injected into each prompt for continuity — no repeats unless updated.

### 3. Action Dashboard
A live-updating task table with **status management** (Pending → In Progress → Done). New tasks flash in with a purple highlight animation. Rows are reconciled by task text — no full re-render flicker on updates.

### 4. One-Click Meeting Summary
At any point, click "Generate Summary" to get a comprehensive AI-generated summary including:
- Narrative paragraph (3-5 sentences)
- Complete task list with owners and deadlines
- All decisions and risks flagged

Export as JSON or Markdown — paste directly into Slack, Notion, or email.

### 5. Meeting History
Every meeting is **automatically saved** when the Meet tab closes. The history page provides:
- Searchable list of all past meetings (full-text search across transcript, tasks, decisions, risks, summary)
- Detail view with timestamped transcript, extracted insights, and summary
- Export options (JSON, Markdown, plain transcript)
- Individual delete or clear all
- Persists up to 50 meetings in `chrome.storage.local`

### 6. Live Status Indicators
- Speech status banner (listening / mic denied / error)
- Tab capture status indicator
- WebSocket connection badge (Live / Reconnecting)
- AI processing animation

### 7. ✅ **NEW: Deployed Backend Support**
- Production-ready backend deployed on Render
- User-configurable backend URL via `chrome.storage.sync` (no extension reload needed)
- Automatic URL normalization (http → ws, https → wss)
- Health check endpoint `/health` for deployment verification
- CORS enabled for all origins
- Environment-based configuration (production/development modes)

### 8. ✅ **NEW: Robust Backend Architecture**
- DeepgramManager for isolated per-client Deepgram connections
- ContextManager sliding window with in-memory session storage
- LLM Orchestrator with model cascade and exponential backoff
- Automatic reconnect handling
- Session isolation per WebSocket connection

---

## Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| Chrome Extension | Manifest V3 | Current standard; service workers, side panel, tab capture |
| Speech Recognition | `webkitSpeechRecognition` API | Built into Chrome, zero cost, real-time interim results |
| Audio Capture | `chrome.tabCapture` + Offscreen Doc | Captures all tab audio (all speakers), not just mic |
| STT (Track B) | Deepgram Nova-3 (streaming WebSocket) | Real-time results (~300ms), 100 hrs/mo free, speaker diarization |
| LLM | Google Gemini 3.1 Flash / Flash Lite | Fastest inference, native JSON mode, $0.003/meeting |
| Frontend | Vanilla JS + Tailwind-inspired CSS | Lightweight, fast load in side panel |
| Backend | Node.js (Express + `ws`) | Non-blocking, native WebSocket support |
| Data Persistence | `chrome.storage.local` + `chrome.storage.sync` | Local storage for meetings, sync for user preferences |
| Deployment | Render / Railway | Automatic HTTPS, WebSocket support, zero-config deployment |
| SDK | @google/genai, @deepgram/sdk | Official SDKs for reliable API communication |

---

## Project Structure

```
meetsense-ai/
├── extension/
│   ├── manifest.json           # MV3 manifest (permissions, content scripts)
│   ├── background.js           # Service worker (WS, tab capture, history)
│   ├── contentScript.js        # Web Speech API transcription engine
│   ├── offscreen.html          # Offscreen document shell
│   ├── offscreen.js            # MediaRecorder for tab audio capture
│   ├── sidepanel.html          # Live session UI (ARIA-compliant)
│   ├── sidepanel.js            # UI logic (transcript, insights, summary)
│   ├── sidepanel.css           # Dark theme styles
│   ├── history.html            # Meeting history page
│   ├── history.js              # History list + detail view logic
│   ├── history.css             # History page styles
│   ├── config.js               # Backend URL configuration + runtime override
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
│
└── backend/
    ├── server.js               # Express + WebSocket server + health checks
    ├── contextManager.js       # Sliding window context buffer
    ├── llmOrchestrator.js      # Gemini API with model cascade + backoff
    ├── promptBuilder.js        # Insights + Summary prompt templates
    ├── deepgramManager.js      # Deepgram streaming STT connection manager
    ├── diagnose.js             # Diagnostic utilities
    ├── scan-models.js          # LLM model availability scanner
    ├── test.js               # Test utilities
    ├── create-icons.js         # Icon generation script
    ├── package.json
    ├── .env.example
    ├── .env
    ├── Procfile               # Railway/Render deployment config
    └── railway.toml           # Railway deployment configuration
```

---

## Quick Start

### Prerequisites
- Node.js 18+
- Chrome 116+ (for `chrome.tabCapture` and offscreen API)
- Google Gemini API key (free tier: 15 RPM, 1500 RPD)
- _(Optional)_ Deepgram API key for streaming tab-capture STT (Track B) — 100 hrs/mo free

### 1. Backend Setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env — add your GEMINI_API_KEY (required) and DEEPGRAM_API_KEY (optional)
npm start
```

Server starts at `ws://localhost:3001`.

### 2. Extension Installation

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `extension/` folder
4. Pin the MeetSense AI extension to your toolbar

### 3. Use It

1. Open [Google Meet](https://meet.google.com) and join a call
2. Click the MeetSense AI icon — the side panel opens automatically
3. Grant microphone access when prompted
4. Start talking — transcription and AI insights appear live
5. Click **Generate Summary** anytime during or after the meeting
6. Click **History** to browse past meetings

### 4. Configure Custom Backend (Optional)

To use your own deployed backend:
```javascript
// Run this in Chrome DevTools on the extension page
chrome.storage.sync.set({ backendUrl: "wss://your-backend-url.com" })
```

The extension will automatically use your custom URL without requiring a reload.

---

## Environment Variables

```env
# Required — Gemini API for real-time insights + summaries
# Get your key at https://aistudio.google.com/apikey
GEMINI_API_KEY=AIza...

# Optional — Deepgram streaming STT for tab-captured audio
# Free tier: 100 hours/month. If not set, only Web Speech API (Track A) is used
# Get your key at https://console.deepgram.com
DEEPGRAM_API_KEY=...

# Server port (default: 3001)
PORT=3001
```

---

## Deployment

The backend is production-ready and can be deployed to any Node.js hosting platform that supports WebSockets.

### ✅ Production Deployment
The official production instance is running at:
```
wss://hackcera.onrender.com
```

Check health status: https://hackcera.onrender.com/health

### Supported Platforms:
- **Render** (Recommended) - Zero-config deployment, automatic HTTPS
- **Railway** - Free tier available, built-in domain
- **Fly.io** - Custom deployments
- Any Node.js hosting with WebSocket support

See [DEPLOYMENT.md](DEPLOYMENT.md) for complete step-by-step deployment instructions.

---

## LLM Pipeline

### Model Cascade with Auto-Fallback

```
gemini-3.1-flash-lite-preview  ──►  gemini-2.5-flash-lite  ──►  gemini-2.5-flash
     (primary — fastest)            (fallback #1)               (fallback #2)
```

Each model is tried with up to 3 retries. On HTTP 429 (rate limit), exponential backoff kicks in (2s → 4s → 8s → 16s max). On timeout, the cycle is skipped gracefully.

### Prompt Engineering

**Real-time insights** use a lean prompt (~2400 chars context) with:
- Last ~30 seconds of transcript
- Previously extracted tasks/decisions (last 5 each) for continuity
- Strict "no hallucination" and "no repeat" rules
- Enforced JSON output format via `responseMimeType: "application/json"`

**Full summary** uses a heavier prompt (~12000 chars context) with:
- Entire meeting transcript (truncated to last 12K chars)
- All accumulated tasks and decisions for verification
- Comprehensive extraction instructions

### Response Validation

All LLM output goes through a multi-step validator:
1. Strip markdown code fences if present
2. Extract JSON object between first `{` and last `}`
3. Parse and verify required fields (`tasks`, `decisions`, `risks`)
4. Graceful partial recovery — if some fields exist, return them with empty defaults for missing ones

### Deepgram Streaming Pipeline (Track B)

Unlike batch STT services, Deepgram streams audio and returns results in real-time. **DeepgramManager** handles isolated per-client connections:

```
Extension offscreen.js (1s audio chunks)
    │
    ▼  base64 via chrome.runtime.sendMessage
background.js
    │
    ▼  AUDIO_CHUNK via WebSocket
server.js → DeepgramManager.sendAudio(base64)
    │
    ▼  Binary audio forwarded instantly
Deepgram WebSocket (Nova-3, live mode)
    │
    ▼  ~300ms later
onTranscript callback
    ├── interim → forward to side panel (live preview)
    └── final   → DIRECT ContextManager + LLM insights pipeline
```

Key configuration:
- **Model**: `nova-3` (Deepgram's most accurate general-purpose model)
- **Punctuation**: enabled (smart formatting)
- **Interim results**: enabled (live preview in side panel)
- **Endpointing**: 500ms (detects end of utterance quickly)
- **Utterance end**: 1000ms (triggers final result)
- **Zero roundtrip**: Final transcripts feed directly into LLM pipeline with no extra WebSocket hops

Each client WebSocket connection gets its own `DeepgramManager` instance — full session isolation.

---

## Cost Model

### Per Meeting (30 minutes)

| Component | Cost |
|---|---|
| Gemini 3.1 Flash (insights, ~120 calls) | ~$0.003 |
| Deepgram Nova-3 (Track B, optional, 30 min streaming) | **Free** (within 100 hrs/mo) |
| **Total with Track A only** | **~$0.003** |
| **Total with Track A + B** | **~$0.003** (free tier) |

### Monthly (100 meetings)

| Tier | Cost |
|---|---|
| Track A only (Web Speech API) | **< $1/month** in LLM costs |
| Track A + B (with Deepgram free tier) | **< $1/month** (100 hrs free) |
| Infrastructure (Railway/Render) | ~$5/month |
| **Total MVP** | **~$5-6/month** |

---

## Security & Privacy

| Principle | Implementation |
|---|---|
| No audio recording | Only text transcripts are captured — no audio is stored |
| Ephemeral processing | Backend ContextManager is in-memory only — cleared on disconnect |
| Session isolation | Each WebSocket connection gets an independent ContextManager |
| Minimal permissions | Extension only requests access to `meet.google.com` |
| No server-side persistence | Meeting data lives in the user's `chrome.storage.local` only |
| XSS prevention | All LLM output is rendered via `textContent`, never `innerHTML` |
| TLS in production | Use `wss://` for production WebSocket connections |

---

## Why This Is a Startup — Not Just a Hackathon Project

### The Market Gap

The meeting intelligence market is dominated by tools that operate **after the fact**:

| Competitor | What They Do | What They Miss |
|---|---|---|
| Otter.ai | Post-meeting transcription | No real-time extraction |
| Fireflies.ai | Post-meeting summary | No live action tracking |
| Fathom | AI meeting recorder | Reactive, not proactive |
| Notion AI | Summarize notes | Doesn't listen to the meeting |

**None of them operate live.** They're all historians. MeetSense is a **command center**.

### The Startup Thesis

1. **Real-time > After-the-fact.** The value of knowing "Rahul was assigned the API deploy, due Friday" _during the meeting_ is 10x higher than knowing it an hour later. You can correct it, clarify it, or hold Rahul accountable — right then.

2. **Execution intelligence > Documentation.** Nobody reads meeting notes. But everyone checks their task list. MeetSense converts conversation into action items that follow you into your workflow (Slack, Notion, Jira — future integrations).

3. **Meeting memory becomes organizational knowledge.** With persistent history + search, every past decision, risk, and commitment is retrievable. This is the foundation of an **organizational brain** — a single source of truth for "what did we decide and who owns what."

4. **Platform-agnostic capture.** Starting with Google Meet, the tab-capture + Speech API approach works on any web-based meeting platform (Zoom Web, Teams Web, etc.) — no platform-specific integrations needed.

### Revenue Model Path

| Phase | Product | Pricing |
|---|---|---|
| **MVP** | Chrome extension + local backend | Free (self-hosted) |
| **V1** | Chrome extension + managed cloud backend | Freemium — 10 meetings/mo free, $8/mo Pro |
| **V2** | Cross-platform (Zoom, Teams, Slack Huddles) | $12/mo per user |
| **V3** | Team plan + integrations (Jira, Notion, Slack, Asana) | $15/user/mo (team) |
| **V4** | Enterprise — meeting memory across organization, compliance, analytics | Custom pricing |

### The Moat

- **Real-time extraction** is technically hard (low-latency LLM pipeline, context window management, deduplication). Most competitors don't even try.
- **Dual-track transcription** (browser Speech API + Deepgram streaming STT on tab audio) is a novel approach that no competitor uses. It provides both zero-cost baseline and real-time high-accuracy streaming — with Deepgram's free tier covering most users entirely.
- **Meeting history as organizational knowledge** creates a data network effect — the more your team uses it, the more valuable the searchable history becomes.
- **Integration moat** — once MeetSense auto-pushes tasks to your Jira board and decisions to your Notion database, switching costs are enormous.

### TAM / SAM / SOM

| | Size |
|---|---|
| **TAM** — Global meeting software market (2026) | $12B+ |
| **SAM** — AI meeting intelligence tools | $2B+ |
| **SOM** — Early adopters (tech teams, startups, agencies) | $50M ARR achievable in 3 years |

---

## Future Roadmap

### Phase 1 — Core Polish (Post-Hackathon)
- Speaker identification (parse Meet's avatar DOM)
- Zoom Web + Teams Web support
- Better task deduplication (fuzzy matching)
- WebSocket authentication

### Phase 2 — Integrations
- Slack integration (auto-push tasks to channel)
- Notion integration (auto-create database entries)
- Jira integration (create tickets from tasks)
- Calendar integration (auto-detect meeting start)

### Phase 3 — Team Features
- Multi-user sync (shared meeting insights)
- Meeting memory across organization (vector DB + embeddings)
- Cross-meeting analytics ("How many times was the API deploy delayed?")
- Risk escalation alerts (auto-ping stakeholders on critical risks)

### Phase 4 — Enterprise
- SSO + SAML
- SOC 2 compliance
- On-premise deployment option
- Custom LLM fine-tuning on your meeting patterns
- Meeting effectiveness scoring

---

## Performance Targets

| Metric | Target |
|---|---|
| End-to-end latency (Track A → Insights) | < 5 seconds (P95) |
| Tab-capture STT latency (Track B, Deepgram) | < 1.5 seconds (P95) |
| Task extraction accuracy | > 80% match on scripted test meetings |
| Real-time update reliability | 0 dropped updates in 30-min session |
| Caption capture rate (Track A) | > 95% of speech captured |
| UI re-render rate | 0 full re-renders per session |
| Session reconnect time | < 10 seconds after network drop |
| LLM cost per meeting | < $0.01 |

---

## Built With

- [Chrome Extensions MV3](https://developer.chrome.com/docs/extensions/mv3/) — Service workers, side panel, tab capture, offscreen documents
- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) — Real-time browser-native speech recognition
- [Google Gemini 3.1 Flash](https://ai.google.dev/) — Fastest production LLM with native JSON mode
- [Deepgram Nova-3](https://developers.deepgram.com/docs/models) — Real-time streaming speech-to-text with ~300ms latency, 100 hrs/mo free
- [Node.js](https://nodejs.org/) + [ws](https://github.com/websockets/ws) — Lightweight WebSocket server
- [Express](https://expressjs.com/) — HTTP health check endpoint

---

## License

This project is proprietary and confidential. All rights reserved.

---

_MeetSense AI — because the most expensive part of a meeting isn't the time spent in it. It's what you forget after._
