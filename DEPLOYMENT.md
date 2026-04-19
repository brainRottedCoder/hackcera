# MeetSense AI Backend Deployment Guide

This guide walks you through deploying the MeetSense AI backend to **Railway** (recommended — free tier, automatic HTTPS, WebSocket support).

---

## Prerequisites

- A [Railway](https://railway.app) account (free)
- A [GitHub](https://github.com) account
- Your `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/apikey)
- Your `DEEPGRAM_API_KEY` from [Deepgram Console](https://console.deepgram.com) (optional)

---

## Step 1 — Push your code to GitHub

If you haven't already, push the project to a GitHub repository:

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/meetsense-ai.git
git push -u origin main
```

---

## Step 2 — Deploy on Railway

1. Go to [railway.app](https://railway.app) and sign in
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Select your `meetsense-ai` repository
4. Railway will auto-detect the Node.js backend in the `/backend` folder

   > If Railway doesn't detect the right root, click **Settings** → set **Root Directory** to `backend`

5. Click **Deploy**

---

## Step 3 — Set Environment Variables

In Railway's project dashboard → **Variables** tab, add:

| Variable | Value |
|---|---|
| `GEMINI_API_KEY` | Your Google AI Studio key |
| `DEEPGRAM_API_KEY` | Your Deepgram key |
| `NODE_ENV` | `production` |

> **Do NOT set `PORT`** — Railway injects it automatically.

---

## Step 4 — Get Your Public URL

After the first successful deploy:

1. Go to your Railway project dashboard
2. Click **Settings** → **Networking** → **Generate Domain**
3. Copy the domain, e.g. `meetsense-ai.railway.app`
4. Your WebSocket URL is: `wss://meetsense-ai.railway.app`

---

## Step 5 — Update the Chrome Extension

Open `extension/config.js` and update the `DEPLOYMENT_WS_URL`:

```js
// extension/config.js
const DEPLOYMENT_WS_URL = "wss://meetsense-ai.railway.app";
```

Then reload the extension in Chrome:

1. Go to `chrome://extensions`
2. Find **MeetSense AI** → click **"Reload"** (🔄 icon)

Done! The extension now connects to your deployed backend.

---

## Step 6 — Verify Deployment

Open your browser and visit:
```
https://meetsense-ai.railway.app/health
```

You should see:
```json
{ "status": "ok", "env": "production", "deepgram": true }
```

---

## Alternative Platforms

### Render.com
1. Create a new **Web Service**
2. Connect your GitHub repo
3. Set **Root Directory** to `backend`
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Add environment variables in the dashboard

### Fly.io
```bash
cd backend
fly launch
fly secrets set GEMINI_API_KEY=... DEEPGRAM_API_KEY=...
fly deploy
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Extension shows "Reconnecting…" | Check Railway logs; verify the WS URL starts with `wss://` not `ws://` |
| `INSIGHTS_ERROR: API key` | Verify `GEMINI_API_KEY` is set in Railway environment variables |
| Deepgram not transcribing | Verify `DEEPGRAM_API_KEY` is set; check `/health` response |
| Railway deploy failing | Check build logs; ensure `backend/package.json` has `"start": "node server.js"` |
